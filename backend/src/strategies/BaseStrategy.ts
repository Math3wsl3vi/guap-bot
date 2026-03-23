import { Candle, Timeframe } from '../models/Candle';
import { StrategyType } from './StrategyType';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

// ─── Grid-specific types ──────────────────────────────────────────────────────

export type GridAction = 'INIT' | 'REBALANCE' | 'SHUTDOWN' | 'MONITOR' | 'VIRTUAL_FILL';

export type GridMode = 'VIRTUAL' | 'LIMIT';

export interface VirtualFill {
  /** Grid level price that was crossed. */
  levelPrice: number;
  direction: 'BUY' | 'SELL';
  size: number;
  /** Take profit absolute price. */
  profitLevel: number;
  /** Stop loss absolute price. */
  stopLevel: number;
}

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
  /** Virtual grid fills — bot.ts places market orders for each. */
  virtualFills?: VirtualFill[];
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

  // ── Virtual grid methods (Deriv — market orders instead of limit orders) ──

  /** Returns the grid execution mode. */
  getGridMode(): GridMode;
  /** Check candle against virtual grid levels. Only used in VIRTUAL mode. */
  checkPriceCrossings?(candle: Candle, maxFills: number): Signal;
  /** Confirm a virtual grid fill after market order succeeds. */
  confirmVirtualFill?(levelPrice: number, direction: 'BUY' | 'SELL', orderId: string): void;
  /** Revert a triggered level back to WATCHING after market order fails. */
  revertTriggeredLevel?(levelPrice: number, direction: 'BUY' | 'SELL'): void;
}

/** Type guard: check if a strategy implements the LifecycleStrategy interface. */
export function hasLifecycle(s: BaseStrategy): s is BaseStrategy & LifecycleStrategy {
  return 'initialize' in s && 'shutdown' in s && 'isGridInitialized' in s;
}

// ─── Higher-timeframe candle map ──────────────────────────────────────────────

/**
 * Map of timeframe → candle history for higher-timeframe data.
 * Strategies that need HTF confirmation (e.g., 15m trend filter on a 1m entry)
 * can read from this map. Strategies that don't need HTF data simply ignore it.
 */
export type HTFCandleMap = ReadonlyMap<Timeframe, readonly Candle[]>;

// ─── Base class ───────────────────────────────────────────────────────────────

export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly type: StrategyType;

  /**
   * Evaluate the candle history and return a trading signal.
   * Implementations must always return a Signal (never throw for normal cases).
   *
   * @param candles — primary timeframe candle history (e.g. 1m)
   * @param htfCandles — optional higher-timeframe candle data for multi-TF strategies
   */
  abstract evaluate(candles: readonly Candle[], htfCandles?: HTFCandleMap): Signal;
}
