import { BaseStrategy } from './BaseStrategy';
import { StrategyType } from './StrategyType';
import { EMAScalpStrategy } from './EMAScalpStrategy';
import { GridTradingStrategy } from './GridTradingStrategy';
import { logger } from '../utils/logger';

const COMPONENT = 'StrategyFactory';

/**
 * Create a strategy instance by type.
 *
 * Phase 1 only supports CONSERVATIVE. Additional strategies (AGGRESSIVE_SCALPING,
 * LONDON_BREAKOUT, MEAN_REVERSION, GRID_TRADING, NEWS_EVENT, HYBRID) are added
 * in Phase 2.
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

    // Phase 2 strategies — uncomment as they are implemented:
    // case 'AGGRESSIVE_SCALPING':
    //   strategy = new AggressiveScalpStrategy();
    //   break;
    // case 'LONDON_BREAKOUT':
    //   strategy = new LondonBreakoutStrategy();
    //   break;
    // case 'MEAN_REVERSION':
    //   strategy = new MeanReversionStrategy();
    //   break;
    // case 'NEWS_EVENT':
    //   strategy = new NewsEventStrategy();
    //   break;
    // case 'HYBRID':
    //   strategy = new HybridStrategy();
    //   break;

    default:
      logger.warn(`Strategy type "${type}" not yet implemented, falling back to CONSERVATIVE`, {
        component: COMPONENT,
      });
      strategy = new EMAScalpStrategy();
  }

  logger.info(`Strategy created: ${strategy.name} (${strategy.type})`, { component: COMPONENT });
  return strategy;
}
