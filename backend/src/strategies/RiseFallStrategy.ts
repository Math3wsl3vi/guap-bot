import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Rise/Fall Strategy — Binary Options (CALL / PUT)
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop
 * (same pattern as CoinFlipStrategy).
 */
export class RiseFallStrategy extends BaseStrategy {
  readonly name = 'Rise/Fall';
  readonly type: StrategyType = 'RISE_FALL';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Rise/Fall ready',
      strategyType: this.type,
    };
  }
}
