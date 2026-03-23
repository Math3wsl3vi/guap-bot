import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Martingale Recovery Strategy — Rise/Fall with doubling stakes
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * After every loss, double the stake. One win recovers all losses + original stake profit.
 * Optionally uses EMA/RSI signal filter to bias direction above 50%.
 */
export class MartingaleStrategy extends BaseStrategy {
  readonly name = 'Martingale Recovery';
  readonly type: StrategyType = 'MARTINGALE';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Martingale ready',
      strategyType: this.type,
    };
  }
}
