import { Candle } from '../models/Candle';
import { strategyConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import { BaseStrategy, HTFCandleMap, Signal } from './BaseStrategy';
import { StrategyType } from './StrategyType';
import { LondonBreakoutStrategy } from './LondonBreakoutStrategy';
import { AggressiveScalpStrategy } from './AggressiveScalpStrategy';

const COMPONENT = 'HybridStrategy';

export class HybridStrategy extends BaseStrategy {
  readonly name = 'Hybrid (Time-Switched)';
  readonly type: StrategyType = 'HYBRID';

  private readonly londonEndHour: number;
  private readonly scalpingEndHour: number;
  private readonly londonStrategy: LondonBreakoutStrategy;
  private readonly aggressiveStrategy: AggressiveScalpStrategy;

  constructor() {
    super();
    this.londonEndHour = strategyConfig.hybrid.londonEndHour;
    this.scalpingEndHour = strategyConfig.hybrid.scalpingEndHour;
    this.londonStrategy = new LondonBreakoutStrategy();
    this.aggressiveStrategy = new AggressiveScalpStrategy();
  }

  evaluate(candles: readonly Candle[], htfCandles?: HTFCandleMap): Signal {
    if (candles.length < 2) {
      return { action: 'HOLD', reason: 'Insufficient candles for Hybrid strategy' };
    }

    const lastCandle = candles[candles.length - 1];
    const utcHour = lastCandle.timestamp.getUTCHours();

    let signal: Signal;

    if (utcHour < this.londonEndHour) {
      // 00:00 - londonEndHour: London Breakout phase
      signal = this.londonStrategy.evaluate(candles, htfCandles);
      logger.debug(`Hybrid → London Breakout: ${signal.reason}`, { component: COMPONENT });
    } else if (utcHour < this.scalpingEndHour) {
      // londonEndHour - scalpingEndHour: Aggressive Scalping phase
      signal = this.aggressiveStrategy.evaluate(candles, htfCandles);
      logger.debug(`Hybrid → Aggressive Scalping: ${signal.reason}`, { component: COMPONENT });
    } else {
      // Off hours
      return { action: 'HOLD', reason: 'Outside Hybrid trading hours (off-hours)' };
    }

    // Override strategy type for audit trail
    if (signal.action !== 'HOLD') {
      signal = { ...signal, strategyType: this.type };
    }

    return signal;
  }
}
