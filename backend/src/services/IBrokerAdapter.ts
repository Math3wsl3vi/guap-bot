import { Candle } from '../models/Candle';

export interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  /** Midpoint price: (bid + ask) / 2 */
  mid: number;
  timestamp: Date;
}

/**
 * Broker-agnostic interface for market data access.
 * Swap brokers by providing a different implementation — nothing else changes.
 */
export interface IBrokerAdapter {
  /** Authenticate and open the WebSocket connection. */
  connect(): Promise<void>;

  /** Gracefully close the connection and clean up timers. */
  disconnect(): Promise<void>;

  /**
   * Subscribe to real-time bid/ask price updates.
   * The callback is invoked on every price tick from the broker.
   */
  subscribeToTicks(symbol: string, onTick: (tick: TickData) => void): Promise<void>;

  /**
   * Fetch completed historical OHLCV candles for indicator warmup.
   * @param count  Number of bars to fetch (most recent first).
   */
  getHistoricalCandles(symbol: string, timeframe: string, count: number): Promise<Candle[]>;

  /** True only when the WebSocket connection is open and authenticated. */
  isConnected(): boolean;
}
