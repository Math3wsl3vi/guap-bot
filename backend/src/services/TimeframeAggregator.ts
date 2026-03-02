import EventEmitter from 'events';
import { Candle, Timeframe } from '../models/Candle';
import { logger } from '../utils/logger';

const COMPONENT = 'TimeframeAggregator';

/** Timeframe durations in milliseconds. */
const TF_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** All timeframes above 1m that we aggregate. */
const HIGHER_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

/** Rolling window size per timeframe. */
const WINDOW_SIZE = 200;

interface BarBuilder {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Start of the interval this bar covers (floor of first candle timestamp). */
  intervalStart: number;
}

/**
 * TimeframeAggregator
 *
 * Receives closed 1m candles and rolls them up into higher timeframes (5m, 15m, 1h, 4h).
 * Maintains a rolling window of completed candles per timeframe.
 *
 * Events:
 *  - `candle:close:<timeframe>` (candle: Candle) — emitted when a higher-TF bar closes.
 *    e.g. `candle:close:15m` fires every 15 minutes.
 */
export class TimeframeAggregator extends EventEmitter {
  private readonly windows: Map<Timeframe, Candle[]> = new Map();
  private readonly builders: Map<Timeframe, BarBuilder | null> = new Map();

  constructor() {
    super();
    for (const tf of HIGHER_TIMEFRAMES) {
      this.windows.set(tf, []);
      this.builders.set(tf, null);
    }
  }

  /**
   * Feed a closed 1m candle into all higher-timeframe aggregators.
   * If a higher-TF bar completes, it is pushed to the window and the event is emitted.
   */
  onCandleClose(candle: Candle): void {
    const candleTs = candle.timestamp.getTime();

    for (const tf of HIGHER_TIMEFRAMES) {
      const intervalMs = TF_MS[tf];
      const intervalStart = Math.floor(candleTs / intervalMs) * intervalMs;
      const builder = this.builders.get(tf)!;

      if (!builder) {
        // First candle — start a new bar
        this.builders.set(tf, this.startBuilder(candle, intervalStart));
        continue;
      }

      if (intervalStart > builder.intervalStart) {
        // New interval: close the completed bar, then start a new one
        this.closeBuilder(tf, builder);
        this.builders.set(tf, this.startBuilder(candle, intervalStart));
      } else {
        // Same interval: merge candle into running bar
        builder.high = Math.max(builder.high, candle.high);
        builder.low = Math.min(builder.low, candle.low);
        builder.close = candle.close;
        builder.volume += candle.volume;
      }
    }
  }

  /** Returns the rolling candle window for a given timeframe. */
  getCandles(tf: Timeframe): readonly Candle[] {
    if (tf === '1m') return []; // 1m is managed by MarketDataService
    return this.windows.get(tf) ?? [];
  }

  /** Seed a timeframe window with historical candles (e.g. from broker API). */
  seedHistorical(tf: Timeframe, candles: Candle[]): void {
    if (tf === '1m') return;
    const window = this.windows.get(tf);
    if (!window) return;

    window.length = 0;
    window.push(...candles.slice(-WINDOW_SIZE));

    logger.info(`Seeded ${tf} window with ${window.length} historical candles`, {
      component: COMPONENT,
    });
  }

  /**
   * Build higher-TF candles from an array of 1m candles (used for warmup).
   * This replays historical 1m candles through the aggregator without emitting events.
   */
  buildFromHistory(candles1m: readonly Candle[]): void {
    // Temporarily remove all listeners to avoid emitting during warmup
    const savedListeners = new Map<string, ((...args: unknown[]) => void)[]>();
    for (const tf of HIGHER_TIMEFRAMES) {
      const eventName = `candle:close:${tf}`;
      const listeners = this.listeners(eventName) as ((...args: unknown[]) => void)[];
      if (listeners.length > 0) {
        savedListeners.set(eventName, [...listeners]);
        this.removeAllListeners(eventName);
      }
    }

    // Reset state
    for (const tf of HIGHER_TIMEFRAMES) {
      this.windows.set(tf, []);
      this.builders.set(tf, null);
    }

    // Replay all 1m candles
    for (const candle of candles1m) {
      this.onCandleClose(candle);
    }

    // Restore listeners
    for (const [eventName, listeners] of savedListeners) {
      for (const listener of listeners) {
        this.on(eventName, listener);
      }
    }

    for (const tf of HIGHER_TIMEFRAMES) {
      const window = this.windows.get(tf)!;
      logger.info(`Built ${tf} window from 1m history: ${window.length} candles`, {
        component: COMPONENT,
      });
    }
  }

  /** Returns all supported higher timeframes. */
  static get timeframes(): readonly Timeframe[] {
    return HIGHER_TIMEFRAMES;
  }

  /** Returns the duration in ms for a given timeframe. */
  static durationMs(tf: Timeframe): number {
    return TF_MS[tf];
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private startBuilder(candle: Candle, intervalStart: number): BarBuilder {
    return {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      intervalStart,
    };
  }

  private closeBuilder(tf: Timeframe, builder: BarBuilder): void {
    const candle: Candle = {
      timestamp: new Date(builder.intervalStart),
      open: builder.open,
      high: builder.high,
      low: builder.low,
      close: builder.close,
      volume: builder.volume,
    };

    const window = this.windows.get(tf)!;
    window.push(candle);
    if (window.length > WINDOW_SIZE) {
      window.shift();
    }

    logger.debug(`${tf} candle closed`, {
      component: COMPONENT,
      timestamp: candle.timestamp,
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      windowSize: window.length,
    });

    this.emit(`candle:close:${tf}`, candle);
  }
}
