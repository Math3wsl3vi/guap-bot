import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { Candle } from '../models/Candle';
import { IBrokerAdapter, TickData } from './IBrokerAdapter';
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
const WS_URL = 'wss://streaming.capital.com/connect';

// Symbol map: internal name → Capital.com epic
const SYMBOL_MAP: Record<string, string> = {
  XAU_USD: 'GOLD',
  XAUUSD: 'GOLD',
  EUR_USD: 'EURUSD',
  EURUSD: 'EURUSD',
  GBP_USD: 'GBPUSD',
  GBPUSD: 'GBPUSD',
  USD_JPY: 'USDJPY',
  USDJPY: 'USDJPY',
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
  private tickCallback: ((tick: TickData) => void) | null = null;
  private subscribedSymbol: string | null = null;
  private sessionRefreshTimer: NodeJS.Timeout | null = null;

  constructor(config: CapitalComConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.isDemo ? REST_BASE.demo : REST_BASE.live,
      timeout: 10_000,
    });
  }

  // ─── IBrokerAdapter ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.authenticate();
    await this.openWebSocket();
    this.scheduleSessionRefresh();
    logger.info('Capital.com adapter connected', {
      component: 'CapitalComAdapter',
      isDemo: this.config.isDemo,
    });
  }

  async disconnect(): Promise<void> {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
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
      destination: 'quote.subscribe',
      correlationId: 'quote-1',
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

  // ─── Private: auth ───────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    logger.info('Authenticating with Capital.com...', { component: 'CapitalComAdapter' });

    const response = await this.http.post(
      '/session',
      { identifier: this.config.identifier, password: this.config.password, encryptedPassword: false },
      { headers: { 'X-CAP-API-KEY': this.config.apiKey } },
    );

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
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
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

      ws.on('close', () => {
        this._connected = false;
        logger.warn('WebSocket closed', { component: 'CapitalComAdapter' });
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
        timestamp: p.updateTime ? new Date(p.updateTime as string) : new Date(),
      };
      this.tickCallback(tick);
    }
  }

  // ─── Private: session refresh ────────────────────────────────────────────

  /**
   * Capital.com sessions last 24 hours but we refresh every 22h to be safe.
   * After re-auth we re-subscribe so the new tokens are in effect.
   */
  private scheduleSessionRefresh(): void {
    const REFRESH_MS = 22 * 60 * 60 * 1000;
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
