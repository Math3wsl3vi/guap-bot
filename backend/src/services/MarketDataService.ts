import EventEmitter from 'events';
import { Candle, Timeframe } from '../models/Candle';
import { IBrokerAdapter, TickData } from './IBrokerAdapter';
import { TimeframeAggregator } from './TimeframeAggregator';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';

// Rolling window size — enough for the slowest indicator (EMA21) plus buffer
const CANDLE_WINDOW = 200;
// How many historical candles to fetch on startup for indicator warmup
const WARMUP_CANDLES = 100;

interface CandleBuilder {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Unix timestamp of the minute this bar belongs to (floor to nearest minute) */
  minuteTs: number;
  tickCount: number;
}

/**
 * MarketDataService
 *
 * Responsibilities:
 *  - Connects to the broker via an IBrokerAdapter
 *  - Fetches historical candles on startup so indicators have warm data
 *  - Aggregates live tick data into 1-minute OHLCV candles
 *  - Emits `candle:close` events with the completed Candle when a bar closes
 *  - Auto-reconnects with exponential backoff on connection drops
 *
 * Events:
 *  - `candle:close`  (candle: Candle)  — emitted when a 1-minute bar closes
 *  - `fatal`         (err: Error)      — emitted when reconnect limit is exceeded
 */
export class MarketDataService extends EventEmitter {
  private readonly adapter: IBrokerAdapter;
  private candles: Candle[] = [];
  private currentBar: CandleBuilder | null = null;
  private lastTick: TickData | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly aggregator: TimeframeAggregator;

  constructor(adapter: IBrokerAdapter) {
    super();
    this.adapter = adapter;
    this.aggregator = new TimeframeAggregator();

    // Forward higher-TF candle events so consumers can listen on MarketDataService directly
    for (const tf of TimeframeAggregator.timeframes) {
      this.aggregator.on(`candle:close:${tf}`, (candle: Candle) => {
        this.emit(`candle:close:${tf}`, candle);
      });
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    logger.info('MarketDataService starting', { component: 'MarketDataService' });
    const connected = await this.connectWithRetry();
    // Only fetch historical candles if we actually subscribed to ticks
    if (connected) {
      await this.warmup();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.adapter.disconnect();
    logger.info('MarketDataService stopped', { component: 'MarketDataService' });
  }

  /**
   * Returns a snapshot of the rolling candle window for a given timeframe (oldest → newest).
   * Defaults to 1m if no timeframe specified (backward compatible).
   */
  getCandles(timeframe?: Timeframe): readonly Candle[] {
    if (!timeframe || timeframe === '1m') {
      return this.candles;
    }
    return this.aggregator.getCandles(timeframe);
  }

  /** Returns the timeframe aggregator (used by bot.ts for HTF candle maps). */
  getAggregator(): TimeframeAggregator {
    return this.aggregator;
  }

  /** Returns the most recent tick (bid/ask/mid) for spread checking. */
  getLastTick(): TickData | null {
    return this.lastTick;
  }

  // ─── Private: connection ─────────────────────────────────────────────────

  private async connectWithRetry(): Promise<boolean> {
    try {
      // Reuse existing connection if adapter is already connected (bot.ts connects first)
      if (!this.adapter.isConnected()) {
        await this.adapter.connect();
      }
      this.reconnectAttempts = 0;

      await this.adapter.subscribeToTicks(strategyConfig.symbol, (tick) => this.onTick(tick));

      logger.info('Subscribed to live tick stream', {
        component: 'MarketDataService',
        symbol: strategyConfig.symbol,
      });
      return true;
    } catch (err) {
      const errMsg = (err as Error).message;
      const isMarketClosed = errMsg.includes('MarketIsClosed');

      logger.error(isMarketClosed ? 'Market is closed' : 'Connection attempt failed', {
        component: 'MarketDataService',
        error: errMsg,
        attempt: this.reconnectAttempts + 1,
      });

      this.scheduleReconnect(isMarketClosed);
      return false;
    }
  }

  private scheduleReconnect(marketClosed = false): void {
    if (this.stopped) return;

    // Market-closed retries are infinite (market will eventually open) but use long backoff
    if (!marketClosed && this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached — giving up', { component: 'MarketDataService' });
      this.emit('fatal', new Error('Max WebSocket reconnect attempts exceeded'));
      return;
    }

    // Market closed → 5 min polling. Connection error → exponential backoff capped at 60s.
    const delayMs = marketClosed
      ? 5 * 60_000
      : Math.min(1000 * 2 ** this.reconnectAttempts, 60_000);
    this.reconnectAttempts++;

    logger.info(
      marketClosed
        ? `Market closed — will retry in ${delayMs / 60_000} min`
        : `Reconnecting in ${delayMs}ms`,
      {
        component: 'MarketDataService',
        attempt: this.reconnectAttempts,
      },
    );

    this.reconnectTimer = setTimeout(() => this.connectWithRetry(), delayMs);
  }

  // ─── Private: warmup ─────────────────────────────────────────────────────

  private async warmup(): Promise<void> {
    logger.info('Fetching historical candles for indicator warmup', {
      component: 'MarketDataService',
      count: WARMUP_CANDLES,
    });

    try {
      const historical = await this.adapter.getHistoricalCandles(
        strategyConfig.symbol,
        strategyConfig.timeframe,
        WARMUP_CANDLES,
      );

      // Keep only the most recent CANDLE_WINDOW candles
      this.candles = historical.slice(-CANDLE_WINDOW);

      // Build higher-timeframe candles from historical 1m data
      this.aggregator.buildFromHistory(this.candles);

      logger.info('Warmup complete', {
        component: 'MarketDataService',
        candleCount: this.candles.length,
        oldest: this.candles.at(0)?.timestamp,
        newest: this.candles.at(-1)?.timestamp,
      });
    } catch (err) {
      logger.warn('Could not load historical candles — starting with empty window', {
        component: 'MarketDataService',
        error: (err as Error).message,
      });
    }
  }

  // ─── Private: tick processing ────────────────────────────────────────────

  private onTick(tick: TickData): void {
    this.lastTick = tick;

    // Floor the tick timestamp to the nearest minute
    const minuteTs = Math.floor(tick.timestamp.getTime() / 60_000) * 60_000;

    if (!this.currentBar) {
      this.currentBar = this.startBar(tick, minuteTs);
      return;
    }

    if (minuteTs > this.currentBar.minuteTs) {
      // A new minute has started — close the completed bar and open a new one
      this.closeBar();
      this.currentBar = this.startBar(tick, minuteTs);
    } else {
      // Same minute — update the running bar
      this.currentBar.high = Math.max(this.currentBar.high, tick.mid);
      this.currentBar.low = Math.min(this.currentBar.low, tick.mid);
      this.currentBar.close = tick.mid;
      this.currentBar.volume++;
      this.currentBar.tickCount++;
    }
  }

  private startBar(tick: TickData, minuteTs: number): CandleBuilder {
    return {
      open: tick.mid,
      high: tick.mid,
      low: tick.mid,
      close: tick.mid,
      volume: 1,
      minuteTs,
      tickCount: 1,
    };
  }

  private closeBar(): void {
    if (!this.currentBar) return;

    const candle: Candle = {
      timestamp: new Date(this.currentBar.minuteTs),
      open: this.currentBar.open,
      high: this.currentBar.high,
      low: this.currentBar.low,
      close: this.currentBar.close,
      volume: this.currentBar.volume,
    };

    this.candles.push(candle);
    if (this.candles.length > CANDLE_WINDOW) {
      this.candles.shift();
    }

    logger.debug('Candle closed', {
      component: 'MarketDataService',
      timestamp: candle.timestamp,
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      ticks: this.currentBar.tickCount,
      windowSize: this.candles.length,
    });

    this.emit('candle:close', candle);

    // Feed the closed 1m candle into the higher-timeframe aggregator
    this.aggregator.onCandleClose(candle);
  }
}
