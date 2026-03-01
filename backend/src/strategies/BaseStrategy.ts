import { Candle } from '../models/Candle';
import { StrategyType } from './StrategyType';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

// ─── Grid-specific types ──────────────────────────────────────────────────────

export type GridAction = 'INIT' | 'REBALANCE' | 'SHUTDOWN' | 'MONITOR';

export interface GridOrder {
  symbol: string;
  direction: 'BUY' | 'SELL';
  size: number;
  price: number;
  profitLevel: number;
}

// ─── Signal ───────────────────────────────────────────────────────────────────

export interface Signal {
  action: SignalAction;
  reason: string;
  /**
   * ATR-computed stop loss distance in pips.
   * When set, overrides strategyConfig.stopLossPips in bot.ts and the backtest runner.
   */
  stopLossPips?: number;
  /**
   * ATR-computed take profit distance in pips.
   * When set, overrides strategyConfig.takeProfitPips in bot.ts and the backtest runner.
   */
  takeProfitPips?: number;
  /** Strategy type that generated this signal (for audit trail / DB persistence). */
  strategyType?: StrategyType;
  /** When true, bot.ts should track this position for a breakeven SL move. */
  breakevenMove?: boolean;
  /** Pips in profit after which to activate trailing stop. */
  trailingActivationPips?: number;

  // ── Grid strategy fields (only present when strategyType is GRID_TRADING) ──

  /** Grid lifecycle action. Undefined for non-grid strategies. */
  gridAction?: GridAction;
  /** Limit orders to place (INIT / REBALANCE). */
  gridOrders?: GridOrder[];
  /** Order IDs to cancel (REBALANCE / SHUTDOWN). */
  cancelOrderIds?: string[];
}

// ─── Lifecycle interface for stateful strategies (grid trading) ───────────────

export interface LifecycleStrategy {
  /** Place initial grid orders around the given price. */
  initialize(currentPrice: number): Signal;
  /** Cancel all grid orders and reset state. */
  shutdown(): Signal;
  /** Whether the grid has been initialized with orders. */
  isGridInitialized(): boolean;
  /** Update internal tracking after a limit order is confirmed placed. */
  confirmOrderPlaced(price: number, direction: 'BUY' | 'SELL', orderId: string): void;
  /** Update internal tracking after an order fills on the broker. */
  confirmOrderFilled(orderId: string): void;
  /** Update internal tracking after orders are cancelled. */
  confirmOrdersCancelled(orderIds: string[]): void;
}

/** Type guard: check if a strategy implements the LifecycleStrategy interface. */
export function hasLifecycle(s: BaseStrategy): s is BaseStrategy & LifecycleStrategy {
  return 'initialize' in s && 'shutdown' in s && 'isGridInitialized' in s;
}

// ─── Base class ───────────────────────────────────────────────────────────────

export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly type: StrategyType;

  /**
   * Evaluate the candle history and return a trading signal.
   * Implementations must always return a Signal (never throw for normal cases).
   */
  abstract evaluate(candles: readonly Candle[]): Signal;
}
