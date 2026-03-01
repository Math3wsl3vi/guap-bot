import { Candle } from '../models/Candle';

export interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  /** Midpoint price: (bid + ask) / 2 */
  mid: number;
  timestamp: Date;
}

export interface PlaceOrderParams {
  symbol: string;
  direction: 'BUY' | 'SELL';
  size: number;
  /** Absolute price level for stop loss */
  stopLevel?: number;
  /** Absolute price level for take profit */
  profitLevel?: number;
}

export interface PlaceOrderResult {
  dealId: string;
  executedPrice: number;
  size: number;
  direction: 'BUY' | 'SELL';
  symbol: string;
  openedAt: Date;
}

export interface AccountInfo {
  balance: number;
  equity: number;
  margin: number;
  currency: string;
}

export interface BrokerPosition {
  dealId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  size: number;
  entryLevel: number;
  currentLevel: number;
  stopLevel?: number;
  profitLevel?: number;
  pnl: number;
  openedAt: Date;
}

export interface PlaceLimitOrderParams {
  symbol: string;
  direction: 'BUY' | 'SELL';
  size: number;
  /** Limit or stop price */
  price: number;
  /** Absolute price level for stop loss */
  stopLevel?: number;
  /** Absolute price level for take profit */
  profitLevel?: number;
}

export interface BrokerOrder {
  orderId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  type: 'LIMIT' | 'STOP';
  size: number;
  price: number;
  stopLevel?: number;
  profitLevel?: number;
  openedAt: Date;
}

/**
 * Broker-agnostic interface for market data access and order execution.
 * Swap brokers by providing a different implementation — nothing else changes.
 */
export interface IBrokerAdapter {
  // ─── Connection ────────────────────────────────────────────────────────────

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

  // ─── Account ───────────────────────────────────────────────────────────────

  /** Fetch current account balance, equity, and margin. */
  getAccountInfo(): Promise<AccountInfo>;

  /** Fetch all currently open positions on the broker. */
  getOpenPositions(): Promise<BrokerPosition[]>;

  // ─── Orders ────────────────────────────────────────────────────────────────

  /** Place a market order and return the broker-confirmed fill details. */
  placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult>;

  /**
   * Close an open position by its broker deal ID.
   * @param dealId  The broker's deal identifier returned when the order was placed.
   */
  closePosition(dealId: string): Promise<{ pnl?: number }>;

  /**
   * Update the stop-loss level on an open position (used for trailing stops).
   * @param dealId     The broker's deal identifier.
   * @param stopLevel  New absolute stop-loss price level.
   */
  updateStopLoss(dealId: string, stopLevel: number): Promise<void>;

  // ─── Pending Orders (optional — only MT5 supports these) ─────────────────

  /** Place a limit order (buy below / sell above current price). */
  placeLimitOrder?(params: PlaceLimitOrderParams): Promise<PlaceOrderResult>;

  /** Place a stop order (buy above / sell below current price). */
  placeStopOrder?(params: PlaceLimitOrderParams): Promise<PlaceOrderResult>;

  /** Cancel a pending order by its broker order ID. */
  cancelOrder?(orderId: string): Promise<void>;

  /** Fetch all pending (unfilled) orders on the broker. */
  getOpenOrders?(): Promise<BrokerOrder[]>;
}
