import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Even/Odd Strategy — Digit Options (DIGITEVEN / DIGITODD)
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 */
export class EvenOddStrategy extends BaseStrategy {
  readonly name = 'Even/Odd';
  readonly type: StrategyType = 'EVEN_ODD';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Even/Odd ready',
      strategyType: this.type,
    };
  }
}
