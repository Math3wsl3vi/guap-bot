import axios, { AxiosError, AxiosInstance } from 'axios';
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
import { SYMBOL_MAP } from '../config/instruments.config';
import { logger } from '../utils/logger';

export interface CapitalComConfig {
  /** API key from your Capital.com account (My Account → API access) */
  apiKey: string;
  /** Login email */
  identifier: string;
  /** Login password */
  password: string;
  isDemo: boolean;
}

interface Session {
  cst: string;
  securityToken: string;
}

// Capital.com demo and live endpoints
const REST_BASE = {
  demo: 'https://demo-api-capital.backend-capital.com/api/v1',
  live: 'https://api-capital.backend-capital.com/api/v1',
};
const WS_BASE = {
  demo: 'wss://demo-api-streaming-capital.backend-capital.com/connect',
  live: 'wss://api-streaming-capital.backend-capital.com/connect',
};

// Timeframe map: internal → Capital.com resolution string
const TIMEFRAME_MAP: Record<string, string> = {
  '1m': 'MINUTE',
  '5m': 'MINUTE_5',
  '15m': 'MINUTE_15',
  '30m': 'MINUTE_30',
  '1h': 'HOUR',
  '4h': 'HOUR_4',
  '1d': 'DAY',
};

export class CapitalComAdapter implements IBrokerAdapter {
  private readonly config: CapitalComConfig;
  private readonly http: AxiosInstance;
  private session: Session | null = null;
  private ws: WebSocket | null = null;
  private _connected = false;
  private _intentionalDisconnect = false;
  private tickCallback: ((tick: TickData) => void) | null = null;
  private subscribedSymbol: string | null = null;
  private sessionRefreshTimer: NodeJS.Timeout | null = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private wsReconnectAttempts = 0;
  private wsReconnecting = false;
  private readonly maxWsReconnectAttempts = 10;

  constructor(config: CapitalComConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.isDemo ? REST_BASE.demo : REST_BASE.live,
      timeout: 10_000,
    });
  }

  // ─── IBrokerAdapter ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._intentionalDisconnect = false;
    this.wsReconnectAttempts = 0;
    await this.authenticate();
    await this.openWebSocket();
    this.scheduleSessionRefresh();
    logger.info('Capital.com adapter connected', {
      component: 'CapitalComAdapter',
      isDemo: this.config.isDemo,
    });
  }

  async disconnect(): Promise<void> {
    this._intentionalDisconnect = true;
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    logger.info('Capital.com adapter disconnected', { component: 'CapitalComAdapter' });
  }

  async subscribeToTicks(symbol: string, onTick: (tick: TickData) => void): Promise<void> {
    if (!this._connected || !this.session) {
      throw new Error('Not connected — call connect() first');
    }
    this.tickCallback = onTick;
    this.subscribedSymbol = symbol;

    const epic = this.toEpic(symbol);
    const msg = {
      destination: 'marketData.subscribe',
      correlationId: '1',
      cst: this.session.cst,
      securityToken: this.session.securityToken,
      payload: { epics: [epic] },
    };
    this.ws!.send(JSON.stringify(msg));

    logger.info('Subscribed to tick stream', {
      component: 'CapitalComAdapter',
      symbol,
      epic,
    });
  }

  async getHistoricalCandles(symbol: string, timeframe: string, count: number): Promise<Candle[]> {
    if (!this.session) throw new Error('Not authenticated');

    const epic = this.toEpic(symbol);
    const resolution = this.toResolution(timeframe);

    const response = await this.http.get(`/prices/${epic}`, {
      params: { resolution, max: count, pageSize: count },
      headers: this.authHeaders(),
    });

    const candles = this.parsePrices(response.data);
    logger.info('Fetched historical candles', {
      component: 'CapitalComAdapter',
      symbol,
      count: candles.length,
    });
    return candles;
  }

  isConnected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    if (!this.session) throw new Error('Not authenticated');

    const response = await this.http.get('/accounts', {
      headers: this.authHeaders(),
    });

    const accounts = (response.data as Record<string, unknown>).accounts as Record<string, unknown>[];
    const preferred = accounts.find((a) => a.preferred) ?? accounts[0];
    if (!preferred) throw new Error('No accounts returned from Capital.com');

    const bal = preferred.balance as Record<string, number>;
    return {
      balance: bal.balance,
      equity: bal.balance + (bal.profitLoss ?? 0),
      margin: bal.deposit - (bal.available ?? 0),
      currency: preferred.currency as string,
    };
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    if (!this.session) throw new Error('Not authenticated');

    const response = await this.http.get('/positions', {
      headers: this.authHeaders(),
    });

    const positions = (response.data as Record<string, unknown>).positions as Record<string, unknown>[];
    return positions.map((entry) => {
      const pos = entry.position as Record<string, unknown>;
      const market = entry.market as Record<string, unknown>;
      return {
        dealId: pos.dealId as string,
        symbol: this.fromEpic(market.epic as string),
        direction: pos.direction as 'BUY' | 'SELL',
        size: pos.size as number,
        entryLevel: pos.level as number,
        currentLevel: (market.bid as number + (market.offer as number)) / 2,
        stopLevel: pos.stopLevel as number | undefined,
        profitLevel: pos.limitLevel as number | undefined,
        pnl: (pos.pnl as number) ?? 0,
        openedAt: new Date(pos.createdDateUTC as string),
      };
    });
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    if (!this.session) throw new Error('Not authenticated');

    const epic = this.toEpic(params.symbol);
    const body: Record<string, unknown> = {
      epic,
      direction: params.direction,
      size: params.size,
      guaranteedStop: false,
    };
    if (params.stopLevel !== undefined) body.stopLevel = params.stopLevel;
    if (params.profitLevel !== undefined) body.profitLevel = params.profitLevel;

    const orderResp = await this.http.post('/positions', body, {
      headers: this.authHeaders(),
    });
    const dealReference = (orderResp.data as Record<string, unknown>).dealReference as string;

    // Capital.com processes asynchronously — poll confirms up to 5 times
    let confirm: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      try {
        const confirmResp = await this.http.get(`/confirms/${dealReference}`, {
          headers: this.authHeaders(),
        });
        confirm = confirmResp.data as Record<string, unknown>;
        if (confirm.dealStatus === 'ACCEPTED') break;
        if (confirm.dealStatus === 'REJECTED') {
          throw new Error(`Order rejected by broker: ${confirm.reason as string}`);
        }
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }

    if (!confirm) throw new Error('Order confirmation timed out');

    logger.info('Order placed and confirmed', {
      component: 'CapitalComAdapter',
      dealId: confirm.dealId,
      direction: confirm.direction,
      size: confirm.size,
      level: confirm.level,
    });

    return {
      dealId: confirm.dealId as string,
      executedPrice: confirm.level as number,
      size: confirm.size as number,
      direction: confirm.direction as 'BUY' | 'SELL',
      symbol: params.symbol,
      openedAt: confirm.date ? new Date(confirm.date as string) : new Date(),
    };
  }

  async closePosition(dealId: string): Promise<void> {
    if (!this.session) throw new Error('Not authenticated');

    await this.http.delete(`/positions/${dealId}`, {
      headers: this.authHeaders(),
    });

    logger.info('Position closed', { component: 'CapitalComAdapter', dealId });
  }

  async updateStopLoss(dealId: string, stopLevel: number): Promise<void> {
    if (!this.session) throw new Error('Not authenticated');

    await this.http.put(
      `/positions/${dealId}`,
      { stopLevel, trailingStop: false },
      { headers: this.authHeaders() },
    );

    logger.info('Stop loss updated', { component: 'CapitalComAdapter', dealId, stopLevel });
  }

  // ─── Private: auth ───────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    logger.info('Authenticating with Capital.com...', { component: 'CapitalComAdapter' });

    let response;
    try {
      response = await this.http.post(
        '/session',
        { identifier: this.config.identifier, password: this.config.password, encryptedPassword: false },
        { headers: { 'X-CAP-API-KEY': this.config.apiKey } },
      );
    } catch (err) {
      const axiosErr = err as AxiosError;
      throw new Error(
        `Auth HTTP ${axiosErr.response?.status ?? 'unknown'}: ${JSON.stringify(axiosErr.response?.data ?? axiosErr.message)}`,
      );
    }

    const cst = response.headers['cst'] as string | undefined;
    const securityToken = response.headers['x-security-token'] as string | undefined;

    if (!cst || !securityToken) {
      throw new Error('Capital.com auth failed: CST or X-SECURITY-TOKEN missing from response headers');
    }

    this.session = { cst, securityToken };
    logger.info('Capital.com session created', { component: 'CapitalComAdapter' });
  }

  // ─── Private: WebSocket ──────────────────────────────────────────────────

  private openWebSocket(): Promise<void> {
    // Close any existing WebSocket before opening a new one (prevents leaking
    // the old connection when connect() is called more than once on the same instance)
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.isDemo ? WS_BASE.demo : WS_BASE.live;
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => reject(new Error('WebSocket connect timeout')), 15_000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this._connected = true;
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        logger.error('WebSocket error', { component: 'CapitalComAdapter', error: err.message });
        if (!this._connected) reject(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this._connected = false;
        if (this._intentionalDisconnect) {
          logger.info('WebSocket closed (intentional)', { component: 'CapitalComAdapter' });
          return;
        }
        logger.warn('WebSocket closed unexpectedly — scheduling reconnect', {
          component: 'CapitalComAdapter',
          code,
          reason: reason.toString(),
        });
        this.scheduleWsReconnect();
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn('Unparseable WebSocket message', { component: 'CapitalComAdapter', raw });
      return;
    }

    // Log every non-quote message so we can see exactly what the server is sending
    if (msg.destination !== 'quote') {
      logger.info('WS server message received', {
        component: 'CapitalComAdapter',
        destination: msg.destination,
        correlationId: msg.correlationId,
        status: msg.status,
        // log full message only when it's small (avoid flooding on tick data)
        raw: raw.length < 500 ? raw : raw.slice(0, 500) + '…',
      });
    }

    // Respond to application-level pings — include auth tokens as Capital.com may require them
    if (msg.destination === 'ping') {
      this.ws?.send(JSON.stringify({
        destination: 'pong',
        correlationId: msg.correlationId,
        cst: this.session?.cst,
        securityToken: this.session?.securityToken,
      }));
      return;
    }

    // Quote update — shape: { destination: 'quote', payload: { epic, bid, ofr, ... } }
    if (msg.destination === 'quote' && msg.payload && this.tickCallback) {
      const p = msg.payload as Record<string, unknown>;
      const bid = parseFloat(p.bid as string);
      const ask = parseFloat((p.ofr ?? p.ask) as string);

      if (isNaN(bid) || isNaN(ask)) return;

      const tick: TickData = {
        symbol: this.subscribedSymbol ?? (p.epic as string),
        bid,
        ask,
        mid: (bid + ask) / 2,
        timestamp: p.timestamp ? new Date(p.timestamp as string)
          : p.updateTime ? new Date(p.updateTime as string)
          : new Date(),
      };
      this.tickCallback(tick);
    }
  }

  // ─── Private: WebSocket reconnect ────────────────────────────────────────

  private scheduleWsReconnect(): void {
    if (this._intentionalDisconnect || this.wsReconnecting) return;
    this.wsReconnecting = true;

    if (this.wsReconnectAttempts >= this.maxWsReconnectAttempts) {
      logger.error('Max WebSocket reconnect attempts reached — giving up', {
        component: 'CapitalComAdapter',
      });
      this.wsReconnecting = false;
      return;
    }

    const delayMs = Math.min(1000 * 2 ** this.wsReconnectAttempts, 60_000);
    this.wsReconnectAttempts++;

    logger.info(`Reconnecting WebSocket in ${delayMs}ms`, {
      component: 'CapitalComAdapter',
      attempt: this.wsReconnectAttempts,
    });

    this.wsReconnectTimer = setTimeout(async () => {
      this.wsReconnecting = false;
      try {
        await this.openWebSocket();
        this.wsReconnectAttempts = 0;
        if (this.tickCallback && this.subscribedSymbol) {
          await this.subscribeToTicks(this.subscribedSymbol, this.tickCallback);
        }
        logger.info('WebSocket reconnected successfully', { component: 'CapitalComAdapter' });
      } catch (err) {
        logger.error('WebSocket reconnect failed', {
          component: 'CapitalComAdapter',
          error: (err as Error).message,
        });
        this.scheduleWsReconnect();
      }
    }, delayMs);
  }

  // ─── Private: session refresh ────────────────────────────────────────────

  /**
   * Capital.com sessions expire after 10 minutes of inactivity.
   * Refresh every 8 minutes to keep the session alive.
   * After re-auth we re-subscribe so the new tokens are in effect.
   */
  private scheduleSessionRefresh(): void {
    // Clear any existing timer so double-connect never spawns two intervals
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
    }
    const REFRESH_MS = 8 * 60 * 1000;
    this.sessionRefreshTimer = setInterval(async () => {
      try {
        await this.authenticate();
        if (this.tickCallback && this.subscribedSymbol) {
          await this.subscribeToTicks(this.subscribedSymbol, this.tickCallback);
        }
        logger.info('Capital.com session refreshed', { component: 'CapitalComAdapter' });
      } catch (err) {
        logger.error('Session refresh failed', {
          component: 'CapitalComAdapter',
          error: (err as Error).message,
        });
      }
    }, REFRESH_MS);
  }

  // ─── Private: helpers ────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    if (!this.session) throw new Error('Not authenticated');
    return {
      'X-CAP-API-KEY': this.config.apiKey,
      CST: this.session.cst,
      'X-SECURITY-TOKEN': this.session.securityToken,
    };
  }

  private toEpic(symbol: string): string {
    return SYMBOL_MAP[symbol] ?? symbol;
  }

  private toResolution(timeframe: string): string {
    return TIMEFRAME_MAP[timeframe] ?? 'MINUTE';
  }

  // Reverse map: epic → internal symbol (for parsing positions)
  private fromEpic(epic: string): string {
    const entry = Object.entries(SYMBOL_MAP).find(([, v]) => v === epic);
    return entry ? entry[0] : epic;
  }

  /**
   * Parse Capital.com /prices response.
   * Documented shape:
   * { prices: [{ snapshotTime, openPrice: { mid }, highPrice, lowPrice, closePrice, lastTradedVolume }] }
   */
  private parsePrices(data: unknown): Candle[] {
    const d = data as Record<string, unknown>;
    if (!d?.prices || !Array.isArray(d.prices)) {
      logger.warn('Unexpected price history shape', { component: 'CapitalComAdapter' });
      return [];
    }

    return (d.prices as Record<string, unknown>[]).map((p) => {
      // Capital.com returns OHLC as objects with bid/mid/ask — use mid
      const mid = (obj: unknown): number => {
        if (typeof obj === 'number') return obj;
        const o = obj as Record<string, unknown>;
        return parseFloat((o.mid ?? o.bid ?? o.ask ?? '0') as string);
      };

      return {
        timestamp: new Date(p.snapshotTime as string),
        open: mid(p.openPrice),
        high: mid(p.highPrice),
        low: mid(p.lowPrice),
        close: mid(p.closePrice),
        volume: parseInt((p.lastTradedVolume as string) ?? '0', 10),
      };
    });
  }
}
