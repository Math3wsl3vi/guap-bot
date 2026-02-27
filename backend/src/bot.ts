import 'dotenv/config';
import { logger } from './utils/logger';
import { brokerConfig } from './config/broker.config';
import { strategyConfig } from './config/strategy.config';
import { riskConfig } from './config/risk.config';
import { getInstrumentConfig } from './config/instruments.config';
import { DerivAdapter } from './services/DerivAdapter';
import { MarketDataService } from './services/MarketDataService';
import { OrderService } from './services/OrderService';
import { DatabaseService } from './services/DatabaseService';
import { RiskManager } from './services/RiskManager';
import { ApiServer, BotState } from './services/ApiServer';
import { EMAScalpStrategy } from './strategies/EMAScalpStrategy';
import { Candle } from './models/Candle';
const API_PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001');

// ─── Bot state (shared with ApiServer) ────────────────────────────────────────

const botState: BotState = {
  isRunning: false,
  isPaused: false,
  startedAt: null,
};

// ─── Strategy is re-created when config is updated via API ─────────────────────

let strategy: EMAScalpStrategy = new EMAScalpStrategy();

function recreateStrategy(): void {
  strategy = new EMAScalpStrategy();
  logger.info('EMAScalpStrategy re-instantiated with updated config', { component: 'Bot' });
}

async function main(): Promise<void> {
  logger.info('=== GUAP-BOT Starting ===', { component: 'Bot' });

  const startInstrument = getInstrumentConfig(strategyConfig.symbol);
  logger.info('Strategy config loaded', {
    component: 'Bot',
    symbol: strategyConfig.symbol,
    instrumentLabel: startInstrument.label,
    timeframe: strategyConfig.timeframe,
    emaFast: strategyConfig.emaFastPeriod,
    emaSlow: strategyConfig.emaSlowPeriod,
    rsiPeriod: strategyConfig.rsiPeriod,
    takeProfitPips: strategyConfig.takeProfitPips,
    stopLossPips: strategyConfig.stopLossPips,
    pipSize: startInstrument.pipSize,
    minPositionSize: startInstrument.minPositionSize,
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

  // ─── Services ──────────────────────────────────────────────────────────────

  const adapter = new DerivAdapter({
    appId:      brokerConfig.appId,
    apiToken:   brokerConfig.apiToken,
    isDemo:     brokerConfig.isDemo,
    multiplier: brokerConfig.multiplier,
  });

  const marketData = new MarketDataService(adapter);
  const orderService = new OrderService(adapter);
  const dbService = new DatabaseService();

  // ─── Database init ──────────────────────────────────────────────────────────

  await dbService.init();

  // ─── Seed RiskManager from current account equity ──────────────────────────

  await adapter.connect();
  const accountOnStart = await adapter.getAccountInfo();
  const riskManager = new RiskManager(accountOnStart.equity);

  logger.info('RiskManager initialised', {
    component: 'Bot',
    initialEquity: accountOnStart.equity,
    currency: accountOnStart.currency,
  });

  // ─── API server ─────────────────────────────────────────────────────────────

  const apiServer = new ApiServer({
    adapter,
    marketData,
    orderService,
    dbService,
    riskManager,
    botState,
    onStart: async () => {
      await marketData.start();
      botState.isRunning = true;
      botState.startedAt = new Date();
      logger.info('Bot started via API', { component: 'Bot' });
    },
    onStop: async () => {
      await marketData.stop();
      botState.isRunning = false;
      logger.info('Bot stopped via API', { component: 'Bot' });
    },
    onPause: () => {
      botState.isPaused = !botState.isPaused;
      logger.info(botState.isPaused ? 'Bot paused via API' : 'Bot resumed via API', {
        component: 'Bot',
      });
    },
    onStrategyUpdate: recreateStrategy,
  });

  apiServer.start(API_PORT);

  // ─── Main event loop ────────────────────────────────────────────────────────

  marketData.on('candle:close', async (candle: Candle) => {
    // Broadcast the closed candle to all WebSocket clients
    apiServer.broadcast({
      type: 'candle',
      data: {
        time: candle.timestamp.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
    });

    // Don't execute trades while paused
    if (botState.isPaused) return;

    const candles = marketData.getCandles();

    // 1. Evaluate strategy
    const signal = strategy.evaluate(candles);
    logger.info('Candle evaluated', {
      component: 'Bot',
      candles: candles.length,
      close: candle.close,
      action: signal.action,
      reason: signal.reason,
    });
    if (signal.action === 'HOLD') return;

    logger.info('Signal received', {
      component: 'Bot',
      action: signal.action,
      reason: signal.reason,
    });

    try {
      // 2. Fetch live account state
      const account = await adapter.getAccountInfo();

      // 3. Fetch open positions for risk gate
      const openPositions = await orderService.getOpenPositions();

      // 4. Risk gate
      if (!riskManager.canOpenTrade(openPositions, account.equity)) {
        logger.info('Trade blocked by risk manager', { component: 'Bot', signal: signal.action });
        return;
      }

      // 5. Position sizing — use ATR-based SL if the strategy provided it
      const effectiveSlPips = signal.stopLossPips ?? strategyConfig.stopLossPips;
      const effectiveTpPips = signal.takeProfitPips ?? strategyConfig.takeProfitPips;

      const instrument = getInstrumentConfig(strategyConfig.symbol);
      const pipSize = instrument.pipSize;
      const minPositionSize = Math.max(instrument.minPositionSize, riskConfig.minPositionSize);

      const size = riskManager.calculatePositionSize(
        account.balance,
        riskConfig.maxRiskPerTrade,
        effectiveSlPips,
        pipSize,
      );

      if (size <= 0) {
        logger.warn('Calculated position size is zero — skipping', { component: 'Bot' });
        return;
      }

      if (size < minPositionSize) {
        logger.warn(
          `Calculated size ${size} is below broker minimum ${minPositionSize} for ${strategyConfig.symbol} — ` +
          `account balance ($${account.balance.toFixed(2)}) is too low to open a position. Skipping.`,
          { component: 'Bot', size, minPositionSize, symbol: strategyConfig.symbol, balance: account.balance },
        );
        return;
      }

      // 6. SL/TP as absolute price levels
      const entry = candle.close;
      const slDistance = effectiveSlPips * pipSize;
      const tpDistance = effectiveTpPips * pipSize;

      const stopLoss =
        signal.action === 'BUY' ? entry - slDistance : entry + slDistance;
      const takeProfit =
        signal.action === 'BUY' ? entry + tpDistance : entry - tpDistance;

      // 7. Place order
      const trade = await orderService.placeMarketOrder(
        strategyConfig.symbol,
        signal.action as 'BUY' | 'SELL',
        size,
        stopLoss,
        takeProfit,
        signal.reason,
      );

      // 8. Persist
      await dbService.saveTrade(trade);

      logger.info('Trade opened', {
        component: 'Bot',
        tradeId: trade.id,
        brokerId: trade.brokerId,
        type: trade.type,
        entryPrice: trade.entryPrice,
        stopLoss,
        takeProfit,
        size,
      });

      // 9. Broadcast new trade to WebSocket clients
      apiServer.broadcast({ type: 'trade', data: trade });
    } catch (err) {
      logger.error('Error during trade execution', {
        component: 'Bot',
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }
  });

  marketData.on('fatal', (err: Error) => {
    logger.error('Fatal market data error — shutting down', {
      component: 'Bot',
      error: err.message,
    });
    process.exit(1);
  });

  // ─── Daily loss reset at midnight UTC ─────────────────────────────────────

  scheduleDailyReset(riskManager);

  // ─── Start market data pipeline ────────────────────────────────────────────

  botState.isRunning = true;
  botState.startedAt = new Date();
  await marketData.start();

  logger.info('Market data pipeline running — waiting for candles', { component: 'Bot' });

  // ─── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`, { component: 'Bot' });
    botState.isRunning = false;
    await marketData.stop();
    await apiServer.close();
    await dbService.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** Schedule the RiskManager daily-loss reset to fire at the next UTC midnight. */
function scheduleDailyReset(riskManager: RiskManager): void {
  const msUntilMidnight = (): number => {
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return midnight.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    setTimeout(() => {
      riskManager.resetDailyLoss();
      logger.info('Daily loss counter reset at UTC midnight', { component: 'Bot' });
      scheduleNext();
    }, msUntilMidnight());
  };

  scheduleNext();
}

main().catch((err) => {
  logger.error('Fatal startup error', {
    component: 'Bot',
    error: (err as Error).message,
    stack: (err as Error).stack,
  });
  process.exit(1);
});
