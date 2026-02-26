import 'dotenv/config';
import { logger } from './utils/logger';
import { brokerConfig } from './config/broker.config';
import { strategyConfig } from './config/strategy.config';
import { riskConfig } from './config/risk.config';

async function main(): Promise<void> {
  logger.info('=== GUAP-BOT Starting ===', { component: 'Bot' });

  logger.info('Broker config loaded', {
    component: 'Bot',
    accountId: brokerConfig.accountId,
    baseUrl: brokerConfig.baseUrl,
    isDemo: brokerConfig.isDemo,
  });

  logger.info('Strategy config loaded', {
    component: 'Bot',
    symbol: strategyConfig.symbol,
    timeframe: strategyConfig.timeframe,
    emaFast: strategyConfig.emaFastPeriod,
    emaSlow: strategyConfig.emaSlowPeriod,
    rsiPeriod: strategyConfig.rsiPeriod,
    takeProfitPips: strategyConfig.takeProfitPips,
    stopLossPips: strategyConfig.stopLossPips,
  });

  logger.info('Risk config loaded', {
    component: 'Bot',
    maxRiskPerTrade: `${riskConfig.maxRiskPerTrade * 100}%`,
    maxDailyLoss: `${riskConfig.maxDailyLoss * 100}%`,
    maxDrawdown: `${riskConfig.maxDrawdown * 100}%`,
    maxOpenPositions: riskConfig.maxOpenPositions,
  });

  if (!brokerConfig.isDemo) {
    logger.warn('*** LIVE TRADING MODE ENABLED ***', { component: 'Bot' });
  }

  logger.info('Phase 1 complete — config validated, logger operational', { component: 'Bot' });
  logger.info('Awaiting Phase 2 implementation (MarketDataService)...', { component: 'Bot' });
}

main().catch((err) => {
  logger.error('Fatal startup error', { component: 'Bot', error: err.message, stack: err.stack });
  process.exit(1);
});
