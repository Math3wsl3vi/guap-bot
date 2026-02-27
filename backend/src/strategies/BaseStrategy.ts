import { Candle } from '../models/Candle';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

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
}

export abstract class BaseStrategy {
  abstract readonly name: string;

  /**
   * Evaluate the candle history and return a trading signal.
   * Implementations must always return a Signal (never throw for normal cases).
   */
  abstract evaluate(candles: readonly Candle[]): Signal;
}
