import 'dotenv/config';
import { logger } from './utils/logger';
import { brokerConfig } from './config/broker.config';
import { strategyConfig } from './config/strategy.config';
import { riskConfig } from './config/risk.config';
import { CapitalComAdapter } from './services/CapitalComAdapter';
import { MarketDataService } from './services/MarketDataService';
import { Candle } from './models/Candle';

async function main(): Promise<void> {
  logger.info('=== GUAP-BOT Starting ===', { component: 'Bot' });

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

  // ─── Phase 2: Market data pipeline ───────────────────────────────────────

  const adapter = new CapitalComAdapter({
    apiKey: brokerConfig.apiKey,
    identifier: brokerConfig.identifier,
    password: brokerConfig.password,
    isDemo: brokerConfig.isDemo,
  });

  const marketData = new MarketDataService(adapter);

  marketData.on('candle:close', (candle: Candle) => {
    const candles = marketData.getCandles();
    logger.info('Candle closed', {
      component: 'Bot',
      timestamp: candle.timestamp,
      close: candle.close,
      windowSize: candles.length,
    });
    // Phase 3 hook: strategy.evaluate(candles) → riskManager.check() → orderService.place()
  });

  marketData.on('fatal', (err: Error) => {
    logger.error('Fatal market data error — shutting down', {
      component: 'Bot',
      error: err.message,
    });
    process.exit(1);
  });

  await marketData.start();

  logger.info('Market data pipeline running — waiting for candles', { component: 'Bot' });

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`, { component: 'Bot' });
    await marketData.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', {
    component: 'Bot',
    error: (err as Error).message,
    stack: (err as Error).stack,
  });
  process.exit(1);
});
