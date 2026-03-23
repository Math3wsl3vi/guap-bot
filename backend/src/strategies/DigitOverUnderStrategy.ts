import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Digit Over/Under Strategy — Digit Options (DIGITOVER / DIGITUNDER)
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 */
export class DigitOverUnderStrategy extends BaseStrategy {
  readonly name = 'Digit Over/Under';
  readonly type: StrategyType = 'DIGIT_OVER_UNDER';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Digit Over/Under ready',
      strategyType: this.type,
    };
  }
}
