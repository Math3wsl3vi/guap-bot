import { Candle } from '../models/Candle';
import { BaseStrategy, Signal, HTFCandleMap } from './BaseStrategy';
import { StrategyType } from './StrategyType';

/**
 * Coin Flip Strategy — Accumulator Options (ACCU)
 *
 * This is a dummy strategy — the real logic lives in bot.ts as a tick-driven
 * state machine: open accumulator → monitor payout → sell at target → cooldown → repeat.
 *
 * The evaluate() method always returns BUY to signal "ready to open a new contract".
 * Bot.ts decides whether to act on it based on the coin flip state (cooldown, max contracts, etc.).
 */
export class CoinFlipStrategy extends BaseStrategy {
  readonly name = 'Coin Flip (Accumulator)';
  readonly type: StrategyType = 'COIN_FLIP';

  evaluate(_candles: readonly Candle[], _htfCandles?: HTFCandleMap): Signal {
    return {
      action: 'BUY',
      reason: 'Accumulator ready',
      strategyType: this.type,
    };
  }
}
