import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Accumulator Ladder Strategy — variable growth rate, duration-based exits
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * Uses lower growth rates (1-3%) for wider barriers and longer survival.
 * Instead of fixed TP, monitors running profit and closes at percentage target or max duration.
 */
export class AccumulatorLadderStrategy extends BaseStrategy {
  readonly name = 'Accumulator Ladder';
  readonly type: StrategyType = 'ACCUMULATOR_LADDER';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Accumulator Ladder ready',
      strategyType: this.type,
    };
  }
}
