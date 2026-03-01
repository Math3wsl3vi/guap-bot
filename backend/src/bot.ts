import 'dotenv/config';
import { logger } from './utils/logger';
import { brokerConfig, getMT5Config } from './config/broker.config';
import { strategyConfig } from './config/strategy.config';
import { riskConfig } from './config/risk.config';
import { getInstrumentConfig } from './config/instruments.config';
import { IBrokerAdapter } from './services/IBrokerAdapter';
import { DerivAdapter } from './services/DerivAdapter';
import { MarketDataService } from './services/MarketDataService';
import { OrderService } from './services/OrderService';
import { DatabaseService } from './services/DatabaseService';
import { RiskManager } from './services/RiskManager';
import { ApiServer, ApiServerConfig, BotState } from './services/ApiServer';
import { BaseStrategy, Signal, hasLifecycle, LifecycleStrategy } from './strategies/BaseStrategy';
import { createStrategy } from './strategies/StrategyFactory';
import { Candle } from './models/Candle';
const API_PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001');

// ─── Bot state (shared with ApiServer) ────────────────────────────────────────

const botState: BotState = {
  isRunning: false,
  isPaused: false,
  startedAt: null,
};

// ─── Strategy is re-created when config is updated via API ─────────────────────

let strategy: BaseStrategy = createStrategy(strategyConfig.strategyType);

// Assigned in main() — needed by recreateStrategy for grid shutdown.
let orderService: OrderService;

function recreateStrategy(): void {
  // If old strategy is a grid, shut it down and cancel pending orders
  if (hasLifecycle(strategy) && strategy.isGridInitialized()) {
    const shutdownSignal = strategy.shutdown();
    if (shutdownSignal.cancelOrderIds?.length && orderService) {
      cancelGridOrders(shutdownSignal.cancelOrderIds).catch((err) =>
        logger.error('Error cancelling grid orders during strategy switch', {
          component: 'Bot',
          error: (err as Error).message,
        }),
      );
    }
  }
  strategy = createStrategy(strategyConfig.strategyType);
  logger.info(`Strategy re-instantiated: ${strategy.name} (${strategy.type})`, { component: 'Bot' });
}

/** Returns the active strategy instance (used by ApiServer for grid state). */
function getStrategy(): BaseStrategy {
  return strategy;
}

// ─── Grid trading helpers ─────────────────────────────────────────────────────

async function cancelGridOrders(orderIds: string[]): Promise<void> {
  for (const id of orderIds) {
    try {
      await orderService.cancelOrder(id);
    } catch (err) {
      logger.warn(`Failed to cancel grid order ${id}`, {
        component: 'Bot',
        error: (err as Error).message,
      });
    }
  }
}

async function handleGridSignal(
  signal: Signal,
  svc: OrderService,
  server: ApiServer,
): Promise<void> {
  const gridStrategy = strategy as BaseStrategy & LifecycleStrategy;

  // 1. Cancel orders if requested (REBALANCE or SHUTDOWN)
  if (signal.cancelOrderIds?.length) {
    for (const orderId of signal.cancelOrderIds) {
      try {
        await svc.cancelOrder(orderId);
      } catch (err) {
        logger.warn(`Failed to cancel grid order ${orderId}`, {
          component: 'Bot',
          error: (err as Error).message,
        });
      }
    }
    gridStrategy.confirmOrdersCancelled(signal.cancelOrderIds);
  }

  // 2. Place new orders if requested (INIT or REBALANCE)
  if (signal.gridOrders?.length) {
    for (const gridOrder of signal.gridOrders) {
      try {
        const brokerOrder = await svc.placeLimitOrder({
          symbol: gridOrder.symbol,
          direction: gridOrder.direction,
          size: gridOrder.size,
          price: gridOrder.price,
          profitLevel: gridOrder.profitLevel,
        });
        gridStrategy.confirmOrderPlaced(
          gridOrder.price,
          gridOrder.direction,
          brokerOrder.orderId,
        );
        logger.info('Grid order placed', {
          component: 'Bot',
          orderId: brokerOrder.orderId,
          direction: gridOrder.direction,
          price: gridOrder.price,
          tp: gridOrder.profitLevel,
        });
      } catch (err) {
        logger.error('Failed to place grid order', {
          component: 'Bot',
          direction: gridOrder.direction,
          price: gridOrder.price,
          error: (err as Error).message,
        });
      }
    }
  }

  // 3. Broadcast grid state update
  server.broadcast({
    type: 'grid_update',
    data: {
      action: signal.gridAction,
      reason: signal.reason,
      orderCount: signal.gridOrders?.length ?? 0,
      cancelledCount: signal.cancelOrderIds?.length ?? 0,
    },
  });
}

// ─── Broker factory ──────────────────────────────────────────────────────────

function createBrokerAdapter(): IBrokerAdapter {
  if (strategyConfig.broker === 'mt5') {
    // MT5Adapter requires metaapi.cloud-sdk — see docs/MT5Implementation.md Phase 1
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MT5Adapter } = require('./services/MT5Adapter') as {
      MT5Adapter: new (cfg: { metaApiToken: string; accountId: string }) => IBrokerAdapter;
    };
    const mt5Cfg = getMT5Config();
    return new MT5Adapter(mt5Cfg);
  }

  return new DerivAdapter({
    appId: brokerConfig.appId,
    apiToken: brokerConfig.apiToken,
    isDemo: brokerConfig.isDemo,
    multiplier: brokerConfig.multiplier,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  // ─── Services (mutable — broker switch replaces adapter + dependents) ──────

  let adapter: IBrokerAdapter = createBrokerAdapter();
  let marketData = new MarketDataService(adapter);
  let orderServiceLocal = new OrderService(adapter);
  orderService = orderServiceLocal;
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

  // ─── API server config (mutable — broker switch updates adapter/services) ──

  const apiConfig: ApiServerConfig = {
    adapter,
    marketData,
    orderService: orderServiceLocal,
    dbService,
    riskManager,
    botState,
    getStrategy,
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

    onBrokerSwitch: async () => {
      const wasRunning = botState.isRunning;

      // 1. Stop market data & disconnect old adapter
      await marketData.stop();

      // 2. Create and connect new adapter
      adapter = createBrokerAdapter();
      await adapter.connect();

      const account = await adapter.getAccountInfo();
      riskManager.resetDailyLoss();

      logger.info('New broker adapter connected', {
        component: 'Bot',
        broker: strategyConfig.broker,
        balance: account.balance,
        equity: account.equity,
      });

      // 3. Create new services
      marketData = new MarketDataService(adapter);
      orderServiceLocal = new OrderService(adapter);
      orderService = orderServiceLocal;

      // 4. Update config so ApiServer route handlers see new references
      apiConfig.adapter = adapter;
      apiConfig.marketData = marketData;
      apiConfig.orderService = orderServiceLocal;

      // 5. Re-attach event listeners to new MarketDataService
      attachListeners(marketData);

      // 6. Restart market data pipeline if bot was running
      if (wasRunning) {
        await marketData.start();
        botState.isRunning = true;
        botState.startedAt = new Date();
      }
    },
  };

  const apiServer = new ApiServer(apiConfig);
  apiServer.start(API_PORT);

  // ─── Event listeners (extracted so they can be re-attached after broker switch)

  function attachListeners(md: MarketDataService): void {
  md.on('candle:close', async (candle: Candle) => {
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

    const candles = md.getCandles();

    // ── Grid strategy: lifecycle management ─────────────────────────────────
    if (hasLifecycle(strategy)) {
      try {
        // Initialize grid on first candle after strategy creation
        if (!strategy.isGridInitialized()) {
          const initSignal = strategy.initialize(candle.close);
          logger.info('Grid strategy initializing', {
            component: 'Bot',
            reason: initSignal.reason,
            orderCount: initSignal.gridOrders?.length ?? 0,
          });
          await handleGridSignal(initSignal, orderService, apiServer);
          return;
        }

        // Detect filled orders by polling broker open orders
        const openOrders = await orderService.getOpenOrders();
        const openOrderIds = new Set(openOrders.map((o) => o.orderId));
        const gridState = (strategy as BaseStrategy & LifecycleStrategy & { getState(): { levels: Array<{ orderId: string | null; status: string }> } }).getState();

        for (const level of gridState.levels) {
          if (level.orderId && level.status === 'PENDING' && !openOrderIds.has(level.orderId)) {
            strategy.confirmOrderFilled(level.orderId);
            logger.info('Grid order filled (detected via polling)', {
              component: 'Bot',
              orderId: level.orderId,
            });
          }
        }

        // Drawdown safety check for grid
        const account = await adapter.getAccountInfo();
        const riskState = riskManager.getState();
        if (riskState.peakEquity > 0) {
          const drawdown = (riskState.peakEquity - account.equity) / riskState.peakEquity;
          if (drawdown >= strategyConfig.gridTrading.maxGridDrawdown) {
            const shutdownSignal = strategy.shutdown();
            shutdownSignal.reason = `Grid drawdown limit hit: ${(drawdown * 100).toFixed(2)}% >= ${(strategyConfig.gridTrading.maxGridDrawdown * 100).toFixed(1)}%`;
            await handleGridSignal(shutdownSignal, orderService, apiServer);
            logger.error('Grid shut down due to max drawdown', { component: 'Bot', drawdown });
            return;
          }
        }

        // Evaluate grid health (ADX, rebalance)
        const signal = strategy.evaluate(candles);
        logger.info('Grid candle evaluated', {
          component: 'Bot',
          close: candle.close,
          gridAction: signal.gridAction,
          reason: signal.reason,
        });

        if (signal.gridAction && signal.gridAction !== 'MONITOR') {
          await handleGridSignal(signal, orderService, apiServer);
          if (signal.gridAction === 'SHUTDOWN') {
            logger.warn('Grid strategy shut down — safety trigger', {
              component: 'Bot',
              reason: signal.reason,
            });
          }
        }
      } catch (err) {
        logger.error('Error in grid trading loop', {
          component: 'Bot',
          error: (err as Error).message,
          stack: (err as Error).stack,
        });
      }
      return; // Grid strategies handle their own order flow — skip scalar path
    }

    // ── Scalar strategy: standard BUY/SELL/HOLD flow ────────────────────────

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

      // 5a. Spread filter — skip if spread is too wide
      const lastTick = md.getLastTick();
      const instrument = getInstrumentConfig(strategyConfig.symbol);
      const pipSize = instrument.pipSize;

      if (lastTick && lastTick.ask > 0 && lastTick.bid > 0) {
        const spreadPips = (lastTick.ask - lastTick.bid) / pipSize;
        if (spreadPips > strategyConfig.spreadFilterPips) {
          logger.info('Trade skipped — spread too wide', {
            component: 'Bot',
            spreadPips: spreadPips.toFixed(1),
            maxSpreadPips: strategyConfig.spreadFilterPips,
            bid: lastTick.bid,
            ask: lastTick.ask,
          });
          return;
        }
      }

      // 5b. Position sizing — use ATR-based SL if the strategy provided it
      const effectiveSlPips = signal.stopLossPips ?? strategyConfig.stopLossPips;
      const effectiveTpPips = signal.takeProfitPips ?? strategyConfig.takeProfitPips;
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

  md.on('fatal', (err: Error) => {
    logger.error('Fatal market data error — shutting down', {
      component: 'Bot',
      error: err.message,
    });
    process.exit(1);
  });
  } // end attachListeners

  attachListeners(marketData);

  // ─── Daily loss reset at midnight UTC ─────────────────────────────────────

  scheduleDailyReset(riskManager);

  // ─── Start market data pipeline ────────────────────────────────────────────

  botState.isRunning = true;
  botState.startedAt = new Date();
  await marketData.start();

  logger.info('Market data pipeline running — waiting for candles', { component: 'Bot' });

  // ─── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async (sig: string) => {
    logger.info(`${sig} received — shutting down`, { component: 'Bot' });
    botState.isRunning = false;

    // Cancel any active grid orders before disconnecting
    if (hasLifecycle(strategy) && strategy.isGridInitialized()) {
      const shutdownSignal = strategy.shutdown();
      if (shutdownSignal.cancelOrderIds?.length) {
        await cancelGridOrders(shutdownSignal.cancelOrderIds);
      }
    }

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
