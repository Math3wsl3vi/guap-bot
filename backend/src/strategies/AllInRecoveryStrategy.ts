import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * All-In Recovery Strategy — aggressive recovery mode after losing streaks
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * When balance drops below a threshold, switches to larger stakes and higher
 * growth rates, aiming to recover in 3-5 trades or blow up trying.
 * Pure degenerate mode for demo testing.
 */
export class AllInRecoveryStrategy extends BaseStrategy {
  readonly name = 'All-In Recovery';
  readonly type: StrategyType = 'ALL_IN_RECOVERY';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'All-In Recovery ready',
      strategyType: this.type,
    };
  }
}
