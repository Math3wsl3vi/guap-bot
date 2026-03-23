import { BaseStrategy } from './BaseStrategy';
import { StrategyType } from './StrategyType';
import { EMAScalpStrategy } from './EMAScalpStrategy';
import { GridTradingStrategy } from './GridTradingStrategy';
import { AggressiveScalpStrategy } from './AggressiveScalpStrategy';
import { LondonBreakoutStrategy } from './LondonBreakoutStrategy';
import { MeanReversionStrategy } from './MeanReversionStrategy';
import { NewsEventStrategy } from './NewsEventStrategy';
import { HybridStrategy } from './HybridStrategy';
import { CoinFlipStrategy } from './CoinFlipStrategy';
import { RiseFallStrategy } from './RiseFallStrategy';
import { EvenOddStrategy } from './EvenOddStrategy';
import { DigitOverUnderStrategy } from './DigitOverUnderStrategy';
import { MartingaleStrategy } from './MartingaleStrategy';
import { AccumulatorLadderStrategy } from './AccumulatorLadderStrategy';
import { MomentumRiseFallStrategy } from './MomentumRiseFallStrategy';
import { DigitSniperStrategy } from './DigitSniperStrategy';
import { VolatilityBreakoutStrategy } from './VolatilityBreakoutStrategy';
import { HedgedAccumulatorStrategy } from './HedgedAccumulatorStrategy';
import { AllInRecoveryStrategy } from './AllInRecoveryStrategy';
import { logger } from '../utils/logger';

const COMPONENT = 'StrategyFactory';

/**
 * Create a strategy instance by type.
 */
export function createStrategy(type: StrategyType): BaseStrategy {
  let strategy: BaseStrategy;

  switch (type) {
    case 'CONSERVATIVE':
      strategy = new EMAScalpStrategy();
      break;

    case 'GRID_TRADING':
      strategy = new GridTradingStrategy();
      break;

    case 'AGGRESSIVE_SCALPING':
      strategy = new AggressiveScalpStrategy();
      break;

    case 'LONDON_BREAKOUT':
      strategy = new LondonBreakoutStrategy();
      break;

    case 'MEAN_REVERSION':
      strategy = new MeanReversionStrategy();
      break;

    case 'NEWS_EVENT':
      strategy = new NewsEventStrategy();
      break;

    case 'HYBRID':
      strategy = new HybridStrategy();
      break;

    case 'COIN_FLIP':
      strategy = new CoinFlipStrategy();
      break;

    case 'RISE_FALL':
      strategy = new RiseFallStrategy();
      break;

    case 'EVEN_ODD':
      strategy = new EvenOddStrategy();
      break;

    case 'DIGIT_OVER_UNDER':
      strategy = new DigitOverUnderStrategy();
      break;

    case 'MARTINGALE':
      strategy = new MartingaleStrategy();
      break;

    case 'ACCUMULATOR_LADDER':
      strategy = new AccumulatorLadderStrategy();
      break;

    case 'MOMENTUM_RISE_FALL':
      strategy = new MomentumRiseFallStrategy();
      break;

    case 'DIGIT_SNIPER':
      strategy = new DigitSniperStrategy();
      break;

    case 'VOLATILITY_BREAKOUT':
      strategy = new VolatilityBreakoutStrategy();
      break;

    case 'HEDGED_ACCUMULATOR':
      strategy = new HedgedAccumulatorStrategy();
      break;

    case 'ALL_IN_RECOVERY':
      strategy = new AllInRecoveryStrategy();
      break;

    default:
      logger.warn(`Strategy type "${type}" not recognized, falling back to CONSERVATIVE`, {
        component: COMPONENT,
      });
      strategy = new EMAScalpStrategy();
  }

  logger.info(`Strategy created: ${strategy.name} (${strategy.type})`, { component: COMPONENT });
  return strategy;
}
