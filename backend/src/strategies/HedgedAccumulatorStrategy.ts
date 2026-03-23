import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Hedged Accumulator Strategy — opposing ACCU contracts simultaneously
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * Opens two accumulators at once — one benefits from price up, one from down.
 * One gets knocked out quickly, the other survives and compounds.
 * In trending markets, the winning side can far exceed the losing stake.
 */
export class HedgedAccumulatorStrategy extends BaseStrategy {
  readonly name = 'Hedged Accumulator';
  readonly type: StrategyType = 'HEDGED_ACCUMULATOR';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Hedged Accumulator ready',
      strategyType: this.type,
    };
  }
}
