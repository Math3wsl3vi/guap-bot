import WebSocket from 'ws';
import { Candle } from '../models/Candle';
import {
  AccountInfo,
  BrokerPosition,
  IBrokerAdapter,
  PlaceOrderParams,
  PlaceOrderResult,
  TickData,
} from './IBrokerAdapter';
import { logger } from '../utils/logger';

export interface DerivConfig {
  /** App ID from https://developers.deriv.com — use 1089 for quick testing */
  appId: string;
  /** API token from app.deriv.com/account/api-token (needs Read + Trade + Payments scopes) */
  apiToken: string;
  /** Use demo account (differentiated by API token, not by URL) */
  isDemo: boolean;
  /**
   * Leverage multiplier for Multiplier contracts.
   * Higher = more exposure per dollar staked.
   * Typical values for XAU/USD on Deriv: 5, 10, 20, 50, 100.
   * Default: 100.
   */
  multiplier?: number;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface ContractCache {
  stake: number;
  entryPrice: number;
  multiplier: number;
  direction: 'BUY' | 'SELL';
}

// Same WebSocket URL for demo and live — the API token determines the account type
const WS_URL = 'wss://ws.binaryws.com/websockets/v3';

// Internal timeframe string → granularity in seconds
const TIMEFRAME_MAP: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

// Internal symbol → Deriv symbol (frx prefix for real forex/metals)
const DERIV_SYMBOL_MAP: Record<string, string> = {
  XAU_USD: 'frxXAUUSD',
  XAUUSD:  'frxXAUUSD',
  XAG_USD: 'frxXAGUSD',
  EURUSD:  'frxEURUSD',
  EUR_USD: 'frxEURUSD',
  GBPUSD:  'frxGBPUSD',
  GBP_USD: 'frxGBPUSD',
  USDJPY:  'frxUSDJPY',
  USD_JPY: 'frxUSDJPY',
  USDCHF:  'frxUSDCHF',
  USD_CHF: 'frxUSDCHF',
  AUDUSD:  'frxAUDUSD',
  AUD_USD: 'frxAUDUSD',
  USDCAD:  'frxUSDCAD',
  USD_CAD: 'frxUSDCAD',
  NZDUSD:  'frxNZDUSD',
  NZD_USD: 'frxNZDUSD',
  EURGBP:  'frxEURGBP',
  EUR_GBP: 'frxEURGBP',
  EURJPY:  'frxEURJPY',
  EUR_JPY: 'frxEURJPY',
  GBPJPY:  'frxGBPJPY',
  GBP_JPY: 'frxGBPJPY',
};

export class DerivAdapter implements IBrokerAdapter {
  private readonly config: DerivConfig;
  private ws: WebSocket | null = null;
  private _connected = false;
  private _intentionalDisconnect = false;

  // One-shot request/response correlation
  private reqIdCounter = 0;
  private pendingRequests = new Map<number, PendingRequest>();

  // Tick subscription state
  private tickCallback: ((tick: TickData) => void) | null = null;
  private subscribedSymbol: string | null = null;
  private tickSubscriptionReqId: number | null = null;
  private tickSubscriptionResolver: (() => void) | null = null;
  private tickSubscriptionRejector: ((err: Error) => void) | null = null;
  private tickSubscriptionTimer: NodeJS.Timeout | null = null;

  // Local cache of contracts we opened — needed for updateStopLoss conversion
  private contractCache = new Map<string, ContractCache>();

  // Reconnect state
  private wsReconnectAttempts = 0;
  private wsReconnecting = false;
  private readonly maxWsReconnectAttempts = 10;
  private wsReconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: DerivConfig) {
    this.config = config;
  }

  // ─── IBrokerAdapter ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._intentionalDisconnect = false;
    this.wsReconnectAttempts = 0;
    await this.openWebSocket();
    await this.authorize();
    logger.info('Deriv adapter connected', {
      component: 'DerivAdapter',
      isDemo: this.config.isDemo,
      multiplier: this.config.multiplier ?? 100,
    });
  }

  async disconnect(): Promise<void> {
    this._intentionalDisconnect = true;

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.tickSubscriptionTimer) {
      clearTimeout(this.tickSubscriptionTimer);
      this.tickSubscriptionTimer = null;
    }

    // Reject all in-flight requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Deriv adapter disconnected'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this._connected = false;
    logger.info('Deriv adapter disconnected', { component: 'DerivAdapter' });
  }

  async subscribeToTicks(symbol: string, onTick: (tick: TickData) => void): Promise<void> {
    if (!this._connected) throw new Error('Not connected — call connect() first');

    this.tickCallback = onTick;
    this.subscribedSymbol = symbol;

    const derivSymbol = this.toDerivSymbol(symbol);
    const id = ++this.reqIdCounter;
    this.tickSubscriptionReqId = id;

    return new Promise((resolve, reject) => {
      this.tickSubscriptionResolver = resolve;
      this.tickSubscriptionRejector = reject;
      this.tickSubscriptionTimer = setTimeout(() => {
        this.tickSubscriptionTimer = null;
        reject(new Error('Tick subscription timeout'));
      }, 15_000);

      this.ws!.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1, req_id: id }));
      logger.info('Subscribing to tick stream', { component: 'DerivAdapter', symbol, derivSymbol });
    });
  }

  async getHistoricalCandles(symbol: string, timeframe: string, count: number): Promise<Candle[]> {
    const derivSymbol = this.toDerivSymbol(symbol);
    const granularity = TIMEFRAME_MAP[timeframe] ?? 60;

    const resp = await this.send({
      ticks_history: derivSymbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      style: 'candles',
      granularity,
    });

    const candles = this.parseCandles(resp);
    logger.info('Fetched historical candles', {
      component: 'DerivAdapter',
      symbol,
      count: candles.length,
    });
    return candles;
  }

  isConnected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const resp = await this.send({ balance: 1 });
    const bal = resp.balance as Record<string, unknown>;
    const balance = bal.balance as number;
    const currency = bal.currency as string;

    return {
      balance,
      // Deriv balance reflects realized P&L; unrealized is in open contracts
      equity: balance,
      // Multiplier contracts don't use margin — you stake, not borrow
      margin: 0,
      currency,
    };
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    const resp = await this.send({
      portfolio: 1,
      contract_type: ['MULTUP', 'MULTDOWN'],
    });

    const portfolio = resp.portfolio as Record<string, unknown>;
    const contracts = (portfolio.contracts as Record<string, unknown>[]) ?? [];

    // Enrich each contract with live data from proposal_open_contract
    const enriched = await Promise.all(
      contracts.map(async (c) => {
        const contractId = String(c.contract_id);
        let currentSpot = 0;
        let entrySpot = 0;
        let pnl = 0;

        // Prefer cached entry data (from placeOrder in this session)
        const cached = this.contractCache.get(contractId);
        if (cached) {
          entrySpot = cached.entryPrice;
        }

        try {
          const detail = await this.send({
            proposal_open_contract: 1,
            contract_id: parseInt(contractId),
          });
          const poc = detail.proposal_open_contract as Record<string, unknown>;
          currentSpot = parseFloat(poc.current_spot as string) || 0;
          entrySpot = parseFloat(poc.entry_spot as string) || entrySpot;
          pnl = parseFloat(poc.profit as string) || 0;
        } catch {
          // Non-fatal — return what we have
        }

        const direction: 'BUY' | 'SELL' = c.contract_type === 'MULTUP' ? 'BUY' : 'SELL';
        const stake = parseFloat(c.buy_price as string) || 0;
        const openedAt = new Date((c.date_start as number ?? c.purchase_time as number) * 1000);

        return {
          dealId: contractId,
          symbol: this.fromDerivSymbol(c.symbol as string),
          direction,
          size: stake,
          entryLevel: entrySpot,
          currentLevel: currentSpot,
          pnl,
          openedAt,
        } satisfies BrokerPosition;
      }),
    );

    return enriched;
  }

  /**
   * Place a Multiplier contract on Deriv.
   *
   * Position sizing note: `params.size` is the position size in instrument units
   * (e.g. oz for XAU/USD) as calculated by RiskManager. For Deriv multiplier
   * contracts this is used directly as the stake in USD — the numbers are
   * numerically equivalent given the standard position sizing formula:
   *   units = (balance × riskPct) / (slPips × pipSize)
   * which, for XAU/USD (pipSize=0.01), produces the correct USD stake.
   */
  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const derivSymbol = this.toDerivSymbol(params.symbol);
    const multiplier = this.config.multiplier ?? 100;
    const contractType = params.direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';

    // ── Step 1: probe proposal to get current spot price ────────────────────
    const probeResp = await this.send({
      proposal: 1,
      amount: 1,
      basis: 'stake',
      contract_type: contractType,
      currency: 'USD',
      symbol: derivSymbol,
      multiplier,
    });
    const probeData = probeResp.proposal as Record<string, unknown>;
    const spotPrice = parseFloat(probeData.spot as string) || 0;
    const probeId = probeData.id as string;

    // Forget probe proposal (fire-and-forget, ignore errors)
    this.ws?.send(JSON.stringify({ forget: probeId, req_id: ++this.reqIdCounter }));

    // ── Step 2: compute stake and limit order amounts ────────────────────────
    // Convert instrument units → USD stake:
    //   stake = units × spotPrice / multiplier
    // This is derived from: riskAmount = stake × multiplier × delta / spot
    // and: units = riskAmount / (slPips × pipSize) = riskAmount / delta
    // Therefore: stake = riskAmount × spot / (multiplier × delta) = units × spot / multiplier
    // Minimum stake on Deriv is $1.
    const stake = Math.max(1, parseFloat((params.size * spotPrice / multiplier).toFixed(2)));

    const limitOrder: Record<string, number> = {};
    if (params.stopLevel !== undefined && spotPrice > 0) {
      const delta = Math.abs(spotPrice - params.stopLevel);
      // stop_loss is the max loss in account currency (USD)
      limitOrder.stop_loss = parseFloat((stake * multiplier * delta / spotPrice).toFixed(2));
    }
    if (params.profitLevel !== undefined && spotPrice > 0) {
      const delta = Math.abs(params.profitLevel - spotPrice);
      limitOrder.take_profit = parseFloat((stake * multiplier * delta / spotPrice).toFixed(2));
    }

    // ── Step 3: real proposal with correct stake and limits ──────────────────
    const realProposalPayload: Record<string, unknown> = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency: 'USD',
      symbol: derivSymbol,
      multiplier,
    };
    if (Object.keys(limitOrder).length > 0) {
      realProposalPayload.limit_order = limitOrder;
    }

    const proposalResp = await this.send(realProposalPayload);
    const proposalData = proposalResp.proposal as Record<string, unknown>;
    const proposalId = proposalData.id as string;

    // ── Step 4: buy the proposal ─────────────────────────────────────────────
    const buyResp = await this.send({ buy: proposalId, price: stake });
    const buyData = buyResp.buy as Record<string, unknown>;
    const contractId = String(buyData.contract_id);
    const executedPrice = parseFloat(buyData.start_spot as string) || spotPrice;

    // Cache for updateStopLoss
    this.contractCache.set(contractId, {
      stake,
      entryPrice: executedPrice,
      multiplier,
      direction: params.direction,
    });

    logger.info('Deriv order placed', {
      component: 'DerivAdapter',
      contractId,
      direction: params.direction,
      contractType,
      stake,
      multiplier,
      spotPrice,
      stopLossUSD: limitOrder.stop_loss,
      takeProfitUSD: limitOrder.take_profit,
    });

    return {
      dealId: contractId,
      executedPrice,
      size: stake,
      direction: params.direction,
      symbol: params.symbol,
      openedAt: new Date(),
    };
  }

  async closePosition(dealId: string): Promise<void> {
    // price: 0 = accept market price (immediate close)
    await this.send({ sell: parseInt(dealId), price: 0 });
    this.contractCache.delete(dealId);
    logger.info('Position closed', { component: 'DerivAdapter', dealId });
  }

  async updateStopLoss(dealId: string, stopLevel: number): Promise<void> {
    const cached = this.contractCache.get(dealId);
    if (!cached) {
      throw new Error(
        `Cannot update stop loss for contract ${dealId}: entry data not in local cache. ` +
        `Only positions opened in this session can have their stop loss updated.`,
      );
    }

    const priceDelta = Math.abs(cached.entryPrice - stopLevel);
    const newStopLossUSD = parseFloat(
      (cached.stake * cached.multiplier * priceDelta / cached.entryPrice).toFixed(2),
    );

    await this.send({
      contract_update: 1,
      contract_id: parseInt(dealId),
      limit_order: { stop_loss: newStopLossUSD },
    });

    logger.info('Stop loss updated', {
      component: 'DerivAdapter',
      dealId,
      stopLevel,
      stopLossUSD: newStopLossUSD,
    });
  }

  // ─── Private: WebSocket ──────────────────────────────────────────────────

  private openWebSocket(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      const url = `${WS_URL}?app_id=${this.config.appId}`;
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error('Deriv WebSocket connect timeout')), 15_000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        logger.error('Deriv WebSocket error', { component: 'DerivAdapter', error: err.message });
        if (!this._connected) reject(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this._connected = false;
        if (this._intentionalDisconnect) {
          logger.info('Deriv WebSocket closed (intentional)', { component: 'DerivAdapter' });
          return;
        }
        logger.warn('Deriv WebSocket closed unexpectedly — scheduling reconnect', {
          component: 'DerivAdapter',
          code,
          reason: reason.toString(),
        });
        this.scheduleReconnect();
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn('Unparseable Deriv message', { component: 'DerivAdapter', raw });
      return;
    }

    const reqId = msg.req_id as number | undefined;

    // ── Tick subscription stream ─────────────────────────────────────────────
    if (reqId !== undefined && reqId === this.tickSubscriptionReqId) {
      if (msg.error) {
        const err = msg.error as Record<string, unknown>;
        if (this.tickSubscriptionRejector) {
          clearTimeout(this.tickSubscriptionTimer!);
          this.tickSubscriptionRejector(new Error(`Tick subscription error [${err.code}]: ${err.message}`));
          this.tickSubscriptionRejector = null;
          this.tickSubscriptionResolver = null;
        }
        return;
      }

      // Resolve the subscribeToTicks() promise on the first message
      if (this.tickSubscriptionResolver) {
        clearTimeout(this.tickSubscriptionTimer!);
        this.tickSubscriptionTimer = null;
        this.tickSubscriptionResolver();
        this.tickSubscriptionResolver = null;
        this.tickSubscriptionRejector = null;
        logger.info('Tick subscription confirmed', { component: 'DerivAdapter', symbol: this.subscribedSymbol });
      }

      // Process tick data (present in every tick message including the first)
      if (msg.msg_type === 'tick' && this.tickCallback) {
        const tick = msg.tick as Record<string, unknown> | undefined;
        if (tick) {
          // Some instruments only stream `quote` (mid price); others stream bid/ask
          const quote = tick.quote as number | undefined;
          const bid = parseFloat(tick.bid as string) || quote || 0;
          const ask = parseFloat(tick.ask as string) || quote || 0;

          if (bid > 0 || ask > 0) {
            this.tickCallback({
              symbol: this.subscribedSymbol ?? this.fromDerivSymbol(tick.symbol as string),
              bid,
              ask,
              mid: (bid + ask) / 2,
              timestamp: new Date((tick.epoch as number) * 1000),
            });
          }
        }
      }
      return;
    }

    // ── One-shot request/response ─────────────────────────────────────────────
    if (reqId !== undefined && this.pendingRequests.has(reqId)) {
      const pending = this.pendingRequests.get(reqId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(reqId);

      if (msg.error) {
        const err = msg.error as Record<string, unknown>;
        pending.reject(new Error(`Deriv error [${err.code ?? 'unknown'}]: ${err.message}`));
      } else {
        pending.resolve(msg);
      }
      return;
    }
  }

  // ─── Private: request helper ─────────────────────────────────────────────

  private send(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Deriv WebSocket is not open'));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.reqIdCounter;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const type = Object.keys(payload)[0] ?? 'unknown';
        reject(new Error(`Deriv request timed out (req_id=${id}, type=${type})`));
      }, 15_000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  // ─── Private: auth ────────────────────────────────────────────────────────

  private async authorize(): Promise<void> {
    logger.info('Authorizing with Deriv...', { component: 'DerivAdapter' });
    const resp = await this.send({ authorize: this.config.apiToken });
    const auth = resp.authorize as Record<string, unknown>;
    this._connected = true;
    logger.info('Deriv authorization successful', {
      component: 'DerivAdapter',
      loginid: auth.loginid,
      currency: auth.currency,
      balance: auth.balance,
      isVirtual: auth.is_virtual,
    });
  }

  // ─── Private: reconnect ──────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this._intentionalDisconnect || this.wsReconnecting) return;
    this.wsReconnecting = true;

    if (this.wsReconnectAttempts >= this.maxWsReconnectAttempts) {
      logger.error('Max Deriv reconnect attempts reached — giving up', { component: 'DerivAdapter' });
      this.wsReconnecting = false;
      return;
    }

    const delayMs = Math.min(1000 * 2 ** this.wsReconnectAttempts, 60_000);
    this.wsReconnectAttempts++;

    logger.info(`Reconnecting to Deriv in ${delayMs}ms`, {
      component: 'DerivAdapter',
      attempt: this.wsReconnectAttempts,
    });

    this.wsReconnectTimer = setTimeout(async () => {
      this.wsReconnecting = false;
      try {
        await this.openWebSocket();
        await this.authorize();
        this.wsReconnectAttempts = 0;
        if (this.tickCallback && this.subscribedSymbol) {
          await this.subscribeToTicks(this.subscribedSymbol, this.tickCallback);
        }
        logger.info('Deriv reconnected successfully', { component: 'DerivAdapter' });
      } catch (err) {
        logger.error('Deriv reconnect failed', {
          component: 'DerivAdapter',
          error: (err as Error).message,
        });
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  // ─── Private: symbol helpers ─────────────────────────────────────────────

  private toDerivSymbol(symbol: string): string {
    return DERIV_SYMBOL_MAP[symbol] ?? symbol;
  }

  private fromDerivSymbol(derivSymbol: string): string {
    const entry = Object.entries(DERIV_SYMBOL_MAP).find(([, v]) => v === derivSymbol);
    return entry ? entry[0] : derivSymbol;
  }

  // ─── Private: candle parser ───────────────────────────────────────────────

  private parseCandles(resp: Record<string, unknown>): Candle[] {
    const candles = resp.candles as Record<string, unknown>[] | undefined;
    if (!candles || !Array.isArray(candles)) {
      logger.warn('Unexpected candle history shape from Deriv', { component: 'DerivAdapter' });
      return [];
    }

    return candles.map((c) => ({
      timestamp: new Date((c.epoch as number) * 1000),
      open:   parseFloat(c.open  as string),
      high:   parseFloat(c.high  as string),
      low:    parseFloat(c.low   as string),
      close:  parseFloat(c.close as string),
      volume: 0, // Deriv candles don't include volume
    }));
  }
}
