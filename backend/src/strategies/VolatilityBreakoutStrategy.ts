import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Volatility Breakout Strategy — Turbos on Crash/Boom indices
 *
 * Dummy strategy — the real logic lives in bot.ts as a tick-driven loop.
 * Tracks consecutive down-ticks on Boom (or up-ticks on Crash) indices.
 * After N consecutive ticks in the bleed direction, buys Turbos betting on the spike.
 * Boom 500: TURBOSLONG after consecutive drops. Crash 500: TURBOSSHORT after consecutive rises.
 */
export class VolatilityBreakoutStrategy extends BaseStrategy {
  readonly name = 'Volatility Breakout';
  readonly type: StrategyType = 'VOLATILITY_BREAKOUT';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Volatility Breakout ready',
      strategyType: this.type,
    };
  }
}
