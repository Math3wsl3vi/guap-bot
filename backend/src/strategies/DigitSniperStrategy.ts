import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Digit Sniper Strategy — DIGITMATCH with multi-digit coverage
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * Bets on multiple digits simultaneously for higher hit rate.
 * DIGITMATCH pays ~900% on 10% probability per digit.
 * Covering N digits = N×10% hit rate but N× stake cost per round.
 */
export class DigitSniperStrategy extends BaseStrategy {
  readonly name = 'Digit Sniper';
  readonly type: StrategyType = 'DIGIT_SNIPER';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Digit Sniper ready',
      strategyType: this.type,
    };
  }
}
