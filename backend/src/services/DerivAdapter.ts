import WebSocket from 'ws';
import { Candle } from '../models/Candle';
import {
  AccountInfo,
  BrokerOrder,
  BrokerPosition,
  IBrokerAdapter,
  PlaceLimitOrderParams,
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
  // ── Forex / Metals ──────────────────────────────────────────────────────────
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

  // ── Crypto ─────────────────────────────────────────────────────────────────
  BTCUSD:  'cryBTCUSD',
  BTC_USD: 'cryBTCUSD',
  ETHUSD:  'cryETHUSD',
  ETH_USD: 'cryETHUSD',
  LTCUSD:  'cryLTCUSD',
  LTC_USD: 'cryLTCUSD',

  // ── Synthetic Indices (1-second tick) ───────────────────────────────────────
  V10_1S:  '1HZ10V',
  V25_1S:  '1HZ25V',
  V50_1S:  '1HZ50V',
  V75_1S:  '1HZ75V',
  V100_1S: '1HZ100V',

  // ── Synthetic Indices (2-second tick / standard) ────────────────────────────
  V10:  'R_10',
  V25:  'R_25',
  V50:  'R_50',
  V75:  'R_75',
  V100: 'R_100',
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

  // Heartbeat
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly pingIntervalMs = 30_000;

  constructor(config: DerivConfig) {
    this.config = config;
  }

  // ─── IBrokerAdapter ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._intentionalDisconnect = false;
    this.wsReconnectAttempts = 0;
    await this.openWebSocket();
    await this.authorize();
    this.startHeartbeat();
    logger.info('Deriv adapter connected', {
      component: 'DerivAdapter',
      isDemo: this.config.isDemo,
      multiplier: this.config.multiplier ?? 100,
    });
  }

  async disconnect(): Promise<void> {
    this._intentionalDisconnect = true;

    this.stopHeartbeat();

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

    // When a MULT contract is open, Deriv immediately deducts the stake from balance.
    // This makes `balance` look like a drawdown to the RiskManager, tripping the
    // circuit breaker on a profitable open position. Fix: add back locked stakes so
    // equity = true portfolio value (available balance + locked capital).
    let lockedStakes = 0;
    try {
      const pfResp = await this.send({
        portfolio: 1,
        contract_type: ['MULTUP', 'MULTDOWN'],
      });
      const pf = pfResp.portfolio as Record<string, unknown>;
      const contracts = (pf.contracts as Record<string, unknown>[]) ?? [];
      for (const c of contracts) {
        const contractId = String(c.contract_id);
        const cached = this.contractCache.get(contractId);
        if (cached) lockedStakes += cached.stake;
      }
    } catch {
      // Non-fatal — fall back to balance only
    }

    return {
      balance,
      equity: balance + lockedStakes,
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

        let pocMultiplier = 0;
        try {
          const detail = await this.send({
            proposal_open_contract: 1,
            contract_id: parseInt(contractId),
          });
          const poc = detail.proposal_open_contract as Record<string, unknown>;
          currentSpot = parseFloat(poc.current_spot as string) || 0;
          entrySpot = parseFloat(poc.entry_spot as string) || entrySpot;
          pnl = parseFloat(poc.profit as string) || 0;
          pocMultiplier = parseFloat(poc.multiplier as string) || 0;
        } catch {
          // Non-fatal — return what we have
        }

        const direction: 'BUY' | 'SELL' = c.contract_type === 'MULTUP' ? 'BUY' : 'SELL';
        const stake = parseFloat(c.buy_price as string) || 0;

        // Seed contractCache for positions from previous sessions so
        // updateStopLoss / trailing stop can work on them.
        if (!this.contractCache.has(contractId) && entrySpot > 0 && stake > 0) {
          this.contractCache.set(contractId, {
            stake,
            entryPrice: entrySpot,
            multiplier: pocMultiplier || (this.config.multiplier ?? 100),
            direction,
          });
          logger.info('Seeded contract cache from open position', {
            component: 'DerivAdapter',
            contractId,
            stake,
            entryPrice: entrySpot,
            multiplier: pocMultiplier || (this.config.multiplier ?? 100),
            direction,
          });
        }
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

    // Filter out dead/expired contracts that Deriv still lists in the portfolio
    // but can't be resolved (all price fields are zero)
    return enriched.filter((p) => p.entryLevel > 0 || p.currentLevel > 0);
  }

  /**
   * Place a Multiplier contract on Deriv.
   *
   * Position sizing note: `params.size` is the stake in USD as calculated by
   * RiskManager (or clamped to the broker minimum). It is passed directly to
   * Deriv as the contract amount — no unit conversion is needed.
   */
  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const derivSymbol = this.toDerivSymbol(params.symbol);
    const multiplier = this.config.multiplier ?? 100;
    const contractType = params.direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';

    // ── Step 1: probe proposal to get current spot price & min stake ────────
    const probeResp = await this.send({
      proposal: 1,
      amount: 1000,  // Use a high amount so the probe succeeds even with high min_stake
      basis: 'stake',
      contract_type: contractType,
      currency: 'USD',
      symbol: derivSymbol,
      multiplier,
    });
    const probeData = probeResp.proposal as Record<string, unknown>;
    const spotPrice = parseFloat(probeData.spot as string) || 0;
    const probeId = probeData.id as string;
    // Deriv returns per-contract stake bounds
    const derivMinStake = parseFloat(String(probeData.min_stake ?? '')) || 1;
    const parsedDerivMaxStake = parseFloat(String(probeData.max_stake ?? ''));
    const derivMaxStake = Number.isFinite(parsedDerivMaxStake) && parsedDerivMaxStake > 0
      ? parsedDerivMaxStake
      : null;

    // Forget probe proposal (fire-and-forget, ignore errors)
    this.ws?.send(JSON.stringify({ forget: probeId, req_id: ++this.reqIdCounter }));

    // ── Step 2: compute stake and limit order amounts ────────────────────────
    // params.size is already the stake in USD (from RiskManager / minPositionSize).
    // Deriv enforces a $0.10 minimum on limit_order amounts (stop_loss / take_profit).
    // Back-calculate the minimum stake needed to satisfy this:
    //   minStake = 0.10 × spot / (multiplier × slDelta)
    const DERIV_MIN_LIMIT = 0.10;
    const rawStake = params.size;
    let minStake = derivMinStake; // Use Deriv's reported minimum
    if (params.stopLevel !== undefined && spotPrice > 0) {
      const slDelta = Math.abs(spotPrice - params.stopLevel);
      if (slDelta > 0) {
        minStake = Math.max(minStake, parseFloat((DERIV_MIN_LIMIT * spotPrice / (multiplier * slDelta)).toFixed(2)));
      }
    }
    const requestedStake = Math.max(minStake, parseFloat(rawStake.toFixed(2)));
    let stake = requestedStake;

    if (derivMaxStake !== null && requestedStake > derivMaxStake) {
      stake = parseFloat(derivMaxStake.toFixed(2));
      logger.warn('Requested stake exceeds Deriv max_stake — clamped to broker limit', {
        component: 'DerivAdapter',
        symbol: params.symbol,
        requestedStake,
        derivMaxStake,
        derivMinStake,
        multiplier,
      });
    }

    if (stake < derivMinStake) {
      throw new Error(
        `Deriv stake constraints invalid for ${params.symbol}: computed stake ${stake.toFixed(2)} is below min_stake ${derivMinStake.toFixed(2)}.`,
      );
    }

    const limitOrder: Record<string, number> = {};
    const clampLimitAmount = (label: 'stop_loss' | 'take_profit', value: number): number => {
      const clamped = Math.min(stake, Math.max(DERIV_MIN_LIMIT, value));
      const rounded = parseFloat(clamped.toFixed(2));
      if (Math.abs(rounded - value) >= 0.01) {
        logger.warn(`Deriv ${label} clamped to valid range`, {
          component: 'DerivAdapter',
          symbol: params.symbol,
          requested: parseFloat(value.toFixed(2)),
          clamped: rounded,
          min: DERIV_MIN_LIMIT,
          max: parseFloat(stake.toFixed(2)),
          stake,
          multiplier,
        });
      }
      return rounded;
    };

    if (params.stopLevel !== undefined && Number.isFinite(params.stopLevel) && spotPrice > 0) {
      const delta = Math.abs(spotPrice - params.stopLevel);
      // stop_loss is the max loss in account currency (USD)
      const rawStopLoss = stake * multiplier * delta / spotPrice;
      limitOrder.stop_loss = clampLimitAmount('stop_loss', rawStopLoss);
    }
    if (params.profitLevel !== undefined && Number.isFinite(params.profitLevel) && spotPrice > 0) {
      const delta = Math.abs(params.profitLevel - spotPrice);
      const rawTakeProfit = stake * multiplier * delta / spotPrice;
      limitOrder.take_profit = clampLimitAmount('take_profit', rawTakeProfit);
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
      derivMinStake,
      derivMaxStake,
      rawStake: parseFloat(rawStake.toFixed(2)),
      requestedStake,
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

  async closePosition(dealId: string): Promise<{ pnl?: number }> {
    // price: 0 = accept market price (immediate close)
    const resp = await this.send({ sell: parseInt(dealId), price: 0 });
    const sellData = resp.sell as Record<string, unknown> | undefined;
    const soldFor = parseFloat(sellData?.sold_for as string) || 0;
    const cached = this.contractCache.get(dealId);
    const pnl = cached ? soldFor - cached.stake : undefined;
    this.contractCache.delete(dealId);
    logger.info('Position closed', { component: 'DerivAdapter', dealId, soldFor, pnl });
    return { pnl };
  }

  // ─── Accumulator (ACCU) contracts ────────────────────────────────────────

  async placeAccumulator(params: {
    symbol: string;
    stake: number;
    growthRate: number;
    takeProfitUSD?: number;
  }): Promise<{ dealId: string; stake: number; symbol: string; openedAt: Date }> {
    const derivSymbol = this.toDerivSymbol(params.symbol);

    // Step 1: get proposal
    const proposalPayload: Record<string, unknown> = {
      proposal: 1,
      amount: params.stake,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: 'USD',
      symbol: derivSymbol,
      growth_rate: params.growthRate,
    };
    if (params.takeProfitUSD && params.takeProfitUSD > 0) {
      proposalPayload.limit_order = { take_profit: params.takeProfitUSD };
    }

    const proposalResp = await this.send(proposalPayload);
    const proposalData = proposalResp.proposal as Record<string, unknown>;
    const proposalId = proposalData.id as string;

    // Step 2: buy the proposal
    const buyResp = await this.send({ buy: proposalId, price: params.stake });
    const buyData = buyResp.buy as Record<string, unknown>;
    const contractId = String(buyData.contract_id);

    // Cache for closePosition (sell)
    this.contractCache.set(contractId, {
      stake: params.stake,
      entryPrice: 0, // accumulators don't have a directional entry
      multiplier: 0,
      direction: 'BUY', // placeholder — ACCU is non-directional
    });

    logger.info('Accumulator contract placed', {
      component: 'DerivAdapter',
      contractId,
      stake: params.stake,
      growthRate: params.growthRate,
      takeProfitUSD: params.takeProfitUSD,
      symbol: derivSymbol,
    });

    return {
      dealId: contractId,
      stake: params.stake,
      symbol: params.symbol,
      openedAt: new Date(),
    };
  }

  /**
   * Check the live status of an open contract (accumulator or multiplier).
   * Returns current payout, profit, and whether the contract is still open.
   */
  async getContractStatus(contractId: string): Promise<{
    isOpen: boolean;
    profit: number;
    currentPayout: number;
    isSold: boolean;
  }> {
    try {
      const resp = await this.send({
        proposal_open_contract: 1,
        contract_id: parseInt(contractId),
      });
      const poc = resp.proposal_open_contract as Record<string, unknown>;
      const status = poc.status as string | undefined;
      const profit = parseFloat(poc.profit as string) || 0;
      const bidPrice = parseFloat(poc.bid_price as string) || 0;
      const isSold = status === 'sold';
      const isOpen = status === 'open';

      return { isOpen, profit, currentPayout: bidPrice, isSold };
    } catch {
      return { isOpen: false, profit: 0, currentPayout: 0, isSold: false };
    }
  }

  // ─── Binary Options (Rise/Fall, Even/Odd, Digit Over/Under) ────────────

  /**
   * Query Deriv for available contract types and durations for a symbol.
   * Useful for diagnosing which contract_type + duration_unit combos work.
   */
  async getContractsFor(symbol: string): Promise<Record<string, unknown>> {
    const derivSymbol = this.toDerivSymbol(symbol);
    return this.send({ contracts_for: derivSymbol, currency: 'USD' });
  }

  async placeBinaryOption(params: {
    symbol: string;
    stake: number;
    contractType: string;
    durationTicks: number;
    barrier?: number;
  }): Promise<{ dealId: string; stake: number; symbol: string; payout: number; openedAt: Date }> {
    const derivSymbol = this.toDerivSymbol(params.symbol);

    const buildPayload = (durationUnit: string, duration: number): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        proposal: 1,
        amount: params.stake,
        basis: 'stake',
        contract_type: params.contractType,
        currency: 'USD',
        duration,
        duration_unit: durationUnit,
        symbol: derivSymbol,
      };
      // Barrier is required for DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF
      if (params.barrier !== undefined) {
        payload.barrier = String(params.barrier);
      }
      return payload;
    };

    // Try multiple duration unit + value combos until one works.
    // Deriv supports: t (ticks), s (seconds), m (minutes).
    // Not all combos are valid for all symbols and contract types.
    const tickInterval = derivSymbol.startsWith('1HZ') ? 1 : 2;
    const attempts: Array<{ unit: string; duration: number }> = [
      { unit: 't', duration: params.durationTicks },
      { unit: 's', duration: Math.max(15, params.durationTicks * tickInterval) }, // Deriv min is often 15s
      { unit: 's', duration: 30 },
      { unit: 'm', duration: 1 },
    ];

    let proposalResp: Record<string, unknown> | null = null;
    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        proposalResp = await this.send(buildPayload(attempt.unit, attempt.duration));
        if (proposalResp) {
          logger.debug('Binary option proposal accepted', {
            component: 'DerivAdapter',
            contractType: params.contractType,
            symbol: derivSymbol,
            durationUnit: attempt.unit,
            duration: attempt.duration,
          });
          break;
        }
      } catch (err) {
        lastError = err as Error;
        const msg = lastError.message;
        if (msg.includes('OfferingsValidationError')) {
          // This combo doesn't work — try next
          continue;
        }
        // Non-duration error — don't retry
        throw err;
      }
    }

    if (!proposalResp) {
      throw lastError ?? new Error(`No valid duration found for ${params.contractType} on ${derivSymbol}`);
    }
    const proposalData = proposalResp.proposal as Record<string, unknown>;
    const proposalId = proposalData.id as string;
    const payout = parseFloat(proposalData.payout as string) || 0;

    // Buy the proposal
    const buyResp = await this.send({ buy: proposalId, price: params.stake });
    const buyData = buyResp.buy as Record<string, unknown>;
    const contractId = String(buyData.contract_id);
    const buyPayout = parseFloat(buyData.payout as string) || payout;

    logger.info('Binary option contract placed', {
      component: 'DerivAdapter',
      contractId,
      contractType: params.contractType,
      stake: params.stake,
      durationTicks: params.durationTicks,
      barrier: params.barrier,
      payout: buyPayout,
      symbol: derivSymbol,
    });

    return {
      dealId: contractId,
      stake: params.stake,
      symbol: params.symbol,
      payout: buyPayout,
      openedAt: new Date(),
    };
  }

  /**
   * Check the status of a binary option contract.
   * Binary options auto-settle — once duration ends, profit is determined.
   */
  async getBinaryOptionStatus(contractId: string): Promise<{
    isOpen: boolean;
    profit: number;
    payout: number;
  }> {
    try {
      const resp = await this.send({
        proposal_open_contract: 1,
        contract_id: parseInt(contractId),
      });
      const poc = resp.proposal_open_contract as Record<string, unknown>;
      const status = poc.status as string | undefined;
      const profit = parseFloat(poc.profit as string) || 0;
      const payout = parseFloat(poc.payout as string) || 0;
      const isOpen = status === 'open';

      return { isOpen, profit, payout };
    } catch {
      return { isOpen: false, profit: 0, payout: 0 };
    }
  }

  // ─── Pending Orders (not supported on Deriv Multipliers) ─────────────────

  async placeLimitOrder(_params: PlaceLimitOrderParams): Promise<never> {
    throw new Error('Deriv does not support pending/limit orders. Switch to MT5 broker for grid trading.');
  }

  async placeStopOrder(_params: PlaceLimitOrderParams): Promise<never> {
    throw new Error('Deriv does not support pending/stop orders. Switch to MT5 broker for grid trading.');
  }

  async cancelOrder(_orderId: string): Promise<never> {
    throw new Error('Deriv does not support pending orders. Switch to MT5 broker for grid trading.');
  }

  async getOpenOrders(): Promise<BrokerOrder[]> {
    throw new Error('Deriv does not support pending orders. Switch to MT5 broker for grid trading.');
  }

  async updateStopLoss(dealId: string, stopLevel: number): Promise<void> {
    const cached = this.contractCache.get(dealId);
    if (!cached) {
      throw new Error(
        `Cannot update stop loss for contract ${dealId}: entry data not in local cache. ` +
        `Only positions opened in this session can have their stop loss updated.`,
      );
    }

    // Deriv stop_loss represents the maximum loss from ENTRY PRICE (not current price).
    // Trailing a SL closer to entry reduces priceDelta, which can drop below Deriv's
    // minimum of $0.10. We check before sending to avoid spamming broker errors.
    const DERIV_MIN_SL_USD = 0.10;

    const priceDelta = Math.abs(cached.entryPrice - stopLevel);
    let newStopLossUSD = parseFloat(
      (cached.stake * cached.multiplier * priceDelta / cached.entryPrice).toFixed(2),
    );

    if (newStopLossUSD < DERIV_MIN_SL_USD) {
      logger.debug('SL update skipped — computed USD below Deriv minimum (trailing too close to entry)', {
        component: 'DerivAdapter',
        dealId,
        stopLevel,
        computedSLusd: newStopLossUSD,
        minimumSLusd: DERIV_MIN_SL_USD,
        entryPrice: cached.entryPrice,
        stake: cached.stake,
        hint: 'Disable TRAILING_STOP_ENABLED or increase stake to support trailing on Deriv',
      });
      return;
    }

    // Deriv caps stop loss at the stake (max loss = buy_price)
    if (newStopLossUSD > cached.stake) {
      logger.warn('Stop loss USD clamped to stake (Deriv max)', {
        component: 'DerivAdapter',
        dealId,
        computed: newStopLossUSD,
        stake: cached.stake,
      });
      newStopLossUSD = parseFloat(cached.stake.toFixed(2));
    }

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
        // Don't auto-reconnect here — MarketDataService manages reconnection.
        // DerivAdapter reconnect only triggers for mid-session unexpected drops
        // (e.g. network blip while actively trading), not during startup/subscribe failures.
        logger.warn('Deriv WebSocket closed unexpectedly', {
          component: 'DerivAdapter',
          code,
          reason: reason.toString(),
        });
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

    // ── Log account type (safety check disabled) ──────
    const isVirtual = auth.is_virtual === 1;
    logger.info(`Deriv account type: ${isVirtual ? 'DEMO' : 'REAL'} (loginid=${auth.loginid})`, {
      component: 'DerivAdapter',
    });
  }

  // ─── Private: heartbeat ──────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1, req_id: ++this.reqIdCounter }));
      }
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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
        this.startHeartbeat();
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
