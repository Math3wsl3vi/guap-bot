import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Momentum Rise/Fall Strategy — EMA-filtered rapid-fire Rise/Fall contracts
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * Uses EMA crossover to pick direction, then spam CALL/PUT contracts in that
 * direction until the signal flips. Stops when EMAs are flat/crossed against.
 */
export class MomentumRiseFallStrategy extends BaseStrategy {
  readonly name = 'Momentum Rise/Fall';
  readonly type: StrategyType = 'MOMENTUM_RISE_FALL';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Momentum Rise/Fall ready',
      strategyType: this.type,
    };
  }
}
