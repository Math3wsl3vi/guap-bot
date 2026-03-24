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
import { BaseStrategy, Signal, hasLifecycle, LifecycleStrategy, HTFCandleMap } from './strategies/BaseStrategy';
import { createStrategy } from './strategies/StrategyFactory';
import { PositionMonitor, StopLossUpdate, PositionClosedEvent } from './services/PositionMonitor';
import { TimeframeAggregator } from './services/TimeframeAggregator';
import { Candle, Timeframe } from './models/Candle';
import { Trade } from './models/Trade';
import { TechnicalIndicators } from './indicators/TechnicalIndicators';
import { TelegramService, createTelegramService, DailyReport } from './services/TelegramService';
const API_PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001');
const SIMULATED_BALANCE = process.env.SIMULATED_BALANCE
  ? parseFloat(process.env.SIMULATED_BALANCE)
  : null;

/** Cap balance/equity to the simulated balance if set */
function applyBalanceCap(account: { balance: number; equity: number; currency: string }) {
  if (SIMULATED_BALANCE === null) return account;
  return {
    ...account,
    balance: Math.min(account.balance, SIMULATED_BALANCE),
    equity: Math.min(account.equity, SIMULATED_BALANCE),
  };
}

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
// Assigned in main() — autonomous loop start/stop hooks.
let onCoinFlipStart: (() => void) | null = null;
let onCoinFlipStop: (() => void) | null = null;
let onBinaryOptionStart: (() => void) | null = null;
let onBinaryOptionStop: (() => void) | null = null;

/** Strategy types that run autonomous binary option loops (not candle-driven). */
const BINARY_OPTION_STRATEGIES = new Set([
  'RISE_FALL', 'EVEN_ODD', 'DIGIT_OVER_UNDER',
  'MARTINGALE', 'MOMENTUM_RISE_FALL', 'DIGIT_SNIPER',
  'VOLATILITY_BREAKOUT', 'ALL_IN_RECOVERY',
]);

/** Strategy types that run autonomous accumulator loops (like COIN_FLIP). */
const ACCUMULATOR_STRATEGIES = new Set([
  'COIN_FLIP', 'ACCUMULATOR_LADDER', 'HEDGED_ACCUMULATOR',
]);

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

  // Stop autonomous loops if we're switching away
  onCoinFlipStop?.();
  onBinaryOptionStop?.();

  strategy = createStrategy(strategyConfig.strategyType);
  logger.info(`Strategy re-instantiated: ${strategy.name} (${strategy.type})`, { component: 'Bot' });

  // Start autonomous loops if applicable
  if (ACCUMULATOR_STRATEGIES.has(strategyConfig.strategyType)) {
    onCoinFlipStart?.();
  } else if (BINARY_OPTION_STRATEGIES.has(strategyConfig.strategyType)) {
    onBinaryOptionStart?.();
  }
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

// ─── Virtual grid handler (Deriv — market orders at grid levels) ─────────────

async function handleVirtualGridCandle(
  candle: Candle,
  candles: readonly Candle[],
  htfCandles: HTFCandleMap,
  gridStrategy: BaseStrategy & LifecycleStrategy,
  svc: OrderService,
  rm: RiskManager,
  db: DatabaseService,
  server: ApiServer,
  brokerAdapter: IBrokerAdapter,
): Promise<void> {
  // 1. Initialize on first candle
  if (!gridStrategy.isGridInitialized()) {
    const initSignal = gridStrategy.initialize(candle.close);
    logger.info('Virtual grid initialized', {
      component: 'Bot',
      reason: initSignal.reason,
    });
    server.broadcast({
      type: 'grid_update',
      data: { action: 'INIT', reason: initSignal.reason },
    });
    return;
  }

  // 2. Evaluate for ADX shutdown / rebalance
  const evalSignal = gridStrategy.evaluate(candles, htfCandles);
  logger.info('Grid candle evaluated', {
    component: 'Bot',
    close: candle.close,
    gridAction: evalSignal.gridAction,
    reason: evalSignal.reason,
  });

  if (evalSignal.gridAction === 'SHUTDOWN') {
    logger.warn('Virtual grid shutdown — safety trigger', {
      component: 'Bot',
      reason: evalSignal.reason,
    });
    server.broadcast({
      type: 'grid_update',
      data: { action: 'SHUTDOWN', reason: evalSignal.reason },
    });
    return;
  }

  if (evalSignal.gridAction === 'REBALANCE') {
    logger.info('Virtual grid rebalanced', {
      component: 'Bot',
      reason: evalSignal.reason,
    });
    server.broadcast({
      type: 'grid_update',
      data: { action: 'REBALANCE', reason: evalSignal.reason },
    });
    // Fall through to check crossings on the new grid
  }

  // 3. Drawdown safety check
  const account = applyBalanceCap(await brokerAdapter.getAccountInfo());
  const riskState = rm.getState();
  if (riskState.peakEquity > 0) {
    const drawdown = (riskState.peakEquity - account.equity) / riskState.peakEquity;
    if (drawdown >= strategyConfig.gridTrading.maxGridDrawdown) {
      gridStrategy.shutdown();
      logger.error('Virtual grid shut down — max drawdown', { component: 'Bot', drawdown });
      server.broadcast({
        type: 'grid_update',
        data: { action: 'SHUTDOWN', reason: `Drawdown ${(drawdown * 100).toFixed(2)}%` },
      });
      return;
    }
  }

  // 4. Check price crossings
  if (!gridStrategy.checkPriceCrossings) return;

  const openPositions = await svc.getOpenPositions();
  const remainingSlots = riskConfig.maxOpenPositions - openPositions.length;

  if (remainingSlots <= 0) {
    logger.debug('Virtual grid: max positions reached, skipping crossing check', {
      component: 'Bot',
      openPositions: openPositions.length,
    });
    return;
  }

  const crossingSignal = gridStrategy.checkPriceCrossings(candle, remainingSlots);

  if (!crossingSignal.virtualFills?.length) return;

  // 5. Execute market orders for each triggered level
  for (const fill of crossingSignal.virtualFills) {
    try {
      const trade = await svc.placeMarketOrder(
        strategyConfig.symbol,
        fill.direction,
        fill.size,
        fill.stopLevel,
        fill.profitLevel,
        `Grid ${fill.direction} @ $${fill.levelPrice.toFixed(2)}`,
      );

      gridStrategy.confirmVirtualFill?.(fill.levelPrice, fill.direction, trade.brokerId ?? trade.id);

      trade.strategyType = 'GRID_TRADING';
      await db.saveTrade(trade);
      server.broadcast({ type: 'trade', data: trade });

      logger.info('Virtual grid trade opened', {
        component: 'Bot',
        tradeId: trade.id,
        brokerId: trade.brokerId,
        direction: fill.direction,
        gridLevel: fill.levelPrice,
        entryPrice: trade.entryPrice,
        stopLoss: fill.stopLevel,
        takeProfit: fill.profitLevel,
      });
    } catch (err) {
      logger.error('Failed to execute virtual grid fill', {
        component: 'Bot',
        level: fill.levelPrice,
        direction: fill.direction,
        error: (err as Error).message,
      });
      gridStrategy.revertTriggeredLevel?.(fill.levelPrice, fill.direction);
    }
  }

  server.broadcast({
    type: 'grid_update',
    data: {
      action: 'VIRTUAL_FILL',
      reason: crossingSignal.reason,
      fillCount: crossingSignal.virtualFills.length,
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
  let positionMonitor = new PositionMonitor(orderServiceLocal, marketData);
  const dbService = new DatabaseService();
  const telegram: TelegramService | null = createTelegramService();

  // ─── Database init ──────────────────────────────────────────────────────────

  await dbService.init();

  // ─── Seed RiskManager from current account equity ──────────────────────────

  await adapter.connect();
  const accountOnStart = applyBalanceCap(await adapter.getAccountInfo());
  const riskManager = new RiskManager(accountOnStart.equity);

  logger.info('RiskManager initialised', {
    component: 'Bot',
    initialEquity: accountOnStart.equity,
    currency: accountOnStart.currency,
    simulatedBalance: SIMULATED_BALANCE,
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
    getTrackedPositions: () => positionMonitor.getTrackedPositions(),
    onStart: async () => {
      await marketData.start();
      positionMonitor.start();
      botState.isRunning = true;
      botState.startedAt = new Date();
      logger.info('Bot started via API', { component: 'Bot' });
    },
    onStop: async () => {
      stopCoinFlipLoop();
      stopBinaryOptionLoop();
      positionMonitor.stop();
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

      // 1. Stop position monitor & market data, disconnect old adapter
      positionMonitor.stop();
      await marketData.stop();

      // 2. Create and connect new adapter
      adapter = createBrokerAdapter();
      await adapter.connect();

      const account = applyBalanceCap(await adapter.getAccountInfo());
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
      positionMonitor = new PositionMonitor(orderServiceLocal, marketData);
      attachPositionMonitorListeners(positionMonitor);

      // 4. Update config so ApiServer route handlers see new references
      apiConfig.adapter = adapter;
      apiConfig.marketData = marketData;
      apiConfig.orderService = orderServiceLocal;

      // 5. Re-attach event listeners to new MarketDataService
      attachListeners(marketData);

      // 6. Restart market data pipeline + position monitor if bot was running
      if (wasRunning) {
        await marketData.start();
        positionMonitor.start();
        botState.isRunning = true;
        botState.startedAt = new Date();
      }
    },
  };

  const apiServer = new ApiServer(apiConfig);
  apiServer.start(API_PORT);

  // ─── Position monitor event listeners ──────────────────────────────────────

  function attachPositionMonitorListeners(pm: PositionMonitor): void {
    pm.on('sl:update', (update: StopLossUpdate) => {
      apiServer.broadcast({
        type: 'sl_update',
        data: {
          brokerId: update.brokerId,
          oldSL: update.oldSL,
          newSL: update.newSL,
          reason: update.reason,
          trailingActive: update.trailingActive,
          trailingStopLevel: update.trailingStopLevel,
        },
      });
    });

    pm.on('position:closed', (event: PositionClosedEvent) => {
      apiServer.broadcast({ type: 'position_closed', data: event });
      adapter.getAccountInfo().then((account) => {
        const capped = applyBalanceCap(account);
        telegram?.notifyTradeClosed(
          event.symbol,
          event.direction,
          event.entryPrice,
          event.exitPrice,
          event.pnl,
          capped.balance,
        );
      }).catch(() => {});

      // Update DB record when position is closed by broker (TP/SL)
      // Use updateTradeByBrokerId because scalar strategy trades have a UUID as `id`
      // but the PositionMonitor only knows the Deriv contract ID (stored as broker_id).
      dbService.updateTradeByBrokerId(event.brokerId, {
        status: 'CLOSED',
        exitPrice: event.exitPrice,
        profitLoss: event.pnl,
        closedAt: new Date(),
        duration: event.durationMs,
      }).catch((e) => logger.error('DB update failed (position:closed)', { error: (e as Error).message }));
    });
  }

  attachPositionMonitorListeners(positionMonitor);

  // ─── Event listeners (extracted so they can be re-attached after broker switch)

  /** Build an HTF candle map from the MarketDataService aggregator. */
  function buildHTFCandleMap(md: MarketDataService): HTFCandleMap {
    const map = new Map<Timeframe, readonly Candle[]>();
    for (const tf of TimeframeAggregator.timeframes) {
      map.set(tf, md.getCandles(tf));
    }
    return map;
  }

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
    const htfCandles = buildHTFCandleMap(md);

    // ── Grid strategy: lifecycle management ─────────────────────────────────
    if (hasLifecycle(strategy)) {
      try {
        const gridStrategy = strategy as BaseStrategy & LifecycleStrategy;

        if (gridStrategy.getGridMode() === 'VIRTUAL') {
          // ── Virtual grid path (Deriv — market orders) ─────────────────────
          await handleVirtualGridCandle(
            candle, candles, htfCandles,
            gridStrategy, orderServiceLocal, riskManager, dbService, apiServer, adapter,
          );
        } else {
          // ── Limit order path (MT5) ────────────────────────────────────────

          // Initialize grid on first candle after strategy creation
          if (!gridStrategy.isGridInitialized()) {
            const initSignal = gridStrategy.initialize(candle.close);
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
          const gridState = (gridStrategy as BaseStrategy & LifecycleStrategy & { getState(): { levels: Array<{ orderId: string | null; status: string }> } }).getState();

          for (const level of gridState.levels) {
            if (level.orderId && level.status === 'PENDING' && !openOrderIds.has(level.orderId)) {
              gridStrategy.confirmOrderFilled(level.orderId);
              logger.info('Grid order filled (detected via polling)', {
                component: 'Bot',
                orderId: level.orderId,
              });
            }
          }

          // Drawdown safety check for grid
          const account = applyBalanceCap(await adapter.getAccountInfo());
          const riskState = riskManager.getState();
          if (riskState.peakEquity > 0) {
            const drawdown = (riskState.peakEquity - account.equity) / riskState.peakEquity;
            if (drawdown >= strategyConfig.gridTrading.maxGridDrawdown) {
              const shutdownSignal = gridStrategy.shutdown();
              shutdownSignal.reason = `Grid drawdown limit hit: ${(drawdown * 100).toFixed(2)}% >= ${(strategyConfig.gridTrading.maxGridDrawdown * 100).toFixed(1)}%`;
              await handleGridSignal(shutdownSignal, orderService, apiServer);
              logger.error('Grid shut down due to max drawdown', { component: 'Bot', drawdown });
              return;
            }
          }

          // Evaluate grid health (ADX, rebalance)
          const signal = gridStrategy.evaluate(candles, htfCandles);
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

    // ── Autonomous loop strategies — skip candle-based flow (they run their own loop)
    if (ACCUMULATOR_STRATEGIES.has(strategyConfig.strategyType)) return;
    if (BINARY_OPTION_STRATEGIES.has(strategyConfig.strategyType)) return;

    // ── Scalar strategy: standard BUY/SELL/HOLD flow ────────────────────────

    // 1. Evaluate strategy
    const signal = strategy.evaluate(candles, htfCandles);
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

    // Notify Telegram on every actionable signal
    telegram?.notifySignal(signal, strategyConfig.symbol, candle.close).catch(() => {});

    try {
      // 2. Fetch live account state (capped by SIMULATED_BALANCE if set)
      const account = applyBalanceCap(await adapter.getAccountInfo());

      // 3. Fetch open positions for risk gate
      const openPositions = await orderService.getOpenPositions();

      // 4. Risk gate
      if (!riskManager.canOpenTrade(openPositions, account.equity)) {
        logger.info('Trade blocked by risk manager', { component: 'Bot', signal: signal.action });
        telegram?.notifyRiskBlocked(signal.action, 'Risk manager: position/drawdown limit').catch(() => {});
        return;
      }

      // 5a. Spread filter — skip if spread is too wide (skip for synthetics — no real spread)
      const lastTick = md.getLastTick();
      const instrument = getInstrumentConfig(strategyConfig.symbol);
      const pipSize = instrument.pipSize;

      if (!instrument.isSynthetic && lastTick && lastTick.ask > 0 && lastTick.bid > 0) {
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

      let size = riskManager.calculatePositionSize(
        account.balance,
        riskConfig.maxRiskPerTrade,
        effectiveSlPips,
        pipSize,
      );

      // If risk-based sizing is too small, clamp up to broker minimum stake
      if (size < minPositionSize) {
        logger.info(
          `Risk-based size $${size.toFixed(2)} below minimum $${minPositionSize} — using minimum stake`,
          { component: 'Bot', calculatedSize: size, minPositionSize, symbol: strategyConfig.symbol, balance: account.balance },
        );
        size = minPositionSize;
      }

      // 5c. Deriv stake affordability check — on Deriv, `size` IS the stake in USD
      if (strategyConfig.broker === 'deriv') {
        if (size > account.balance) {
          logger.warn(
            `Stake $${size.toFixed(2)} exceeds balance $${account.balance.toFixed(2)} — skipping trade`,
            { component: 'Bot', stake: size, balance: account.balance, symbol: strategyConfig.symbol },
          );
          return;
        }
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
      trade.strategyType = strategyConfig.strategyType;
      await dbService.saveTrade(trade);
      telegram?.notifyTradeOpened(trade, stopLoss, takeProfit).catch(() => {});

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

  // Broadcast higher-TF candle closes to WebSocket clients
  for (const tf of TimeframeAggregator.timeframes) {
    md.on(`candle:close:${tf}`, (htfCandle: Candle) => {
      apiServer.broadcast({
        type: 'candle',
        data: {
          time: htfCandle.timestamp.toISOString(),
          open: htfCandle.open,
          high: htfCandle.high,
          low: htfCandle.low,
          close: htfCandle.close,
          volume: htfCandle.volume,
          timeframe: tf,
        },
      });
    });
  }

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
  scheduleDailyReport(telegram, dbService, adapter);

  // ─── Start market data pipeline ────────────────────────────────────────────

  botState.isRunning = true;
  botState.startedAt = new Date();
  await marketData.start();
  positionMonitor.start();

  logger.info('Market data pipeline running — waiting for candles', { component: 'Bot' });

  // ─── Coin Flip (Accumulator) autonomous loop ──────────────────────────────
  // Runs independently of candle events. State machine:
  //   IDLE → place contract → OPEN → monitor payout → sell at target → COOLDOWN → IDLE

  let coinFlipTimer: NodeJS.Timeout | null = null;
  let coinFlipWins = 0;
  let coinFlipLosses = 0;

  // Track each open contract independently for parallel execution
  interface CoinFlipSlot {
    contractId: string;
    state: 'OPEN' | 'COOLDOWN';
    cooldownUntil: number;
    openedAtMs: number;
  }
  const coinFlipSlots = new Map<string, CoinFlipSlot>();
  // Cooldown timestamps for slots that are between contracts (keyed by slot index)
  let slotCooldowns: number[] = [];

  function startCoinFlipLoop(): void {
    if (coinFlipTimer) return; // already running
    coinFlipSlots.clear();
    slotCooldowns = [];
    coinFlipWins = 0;
    coinFlipLosses = 0;
    const maxSlots = strategyConfig.coinFlip.maxContracts;
    logger.info('Coin flip loop started', { component: 'Bot', maxContracts: maxSlots });

    coinFlipTimer = setInterval(async () => {
      if (!botState.isRunning || botState.isPaused) return;
      if (!ACCUMULATOR_STRATEGIES.has(strategyConfig.strategyType)) return;

      const cfgCF = strategyConfig.coinFlip;
      const now = Date.now();

      // ── 1. Check all open contracts for settlement ───────────────────
      for (const [slotKey, slot] of coinFlipSlots) {
        if (slot.state === 'COOLDOWN') {
          if (now >= slot.cooldownUntil) {
            coinFlipSlots.delete(slotKey);
            logger.info('Coin flip cooldown ended', { component: 'Bot', slot: slotKey });
          }
          continue;
        }

        // state === 'OPEN' — poll contract status
        try {
          const status = await (adapter as any).getContractStatus(slot.contractId);

          if (status.isOpen) {
            logger.debug('Coin flip — contract running', {
              component: 'Bot',
              dealId: slot.contractId,
              profit: status.profit.toFixed(2),
              payout: status.currentPayout.toFixed(2),
            });
            continue;
          }

          // Contract settled
          const won = status.profit > 0;
          if (won) coinFlipWins++; else coinFlipLosses++;

          logger.info(`Coin flip — contract ended (${won ? 'WIN' : 'LOSS'})`, {
            component: 'Bot',
            dealId: slot.contractId,
            profit: status.profit.toFixed(2),
            payout: status.currentPayout.toFixed(2),
            record: `${coinFlipWins}W / ${coinFlipLosses}L`,
            openContracts: coinFlipSlots.size - 1,
          });

          // Persist settlement to DB
          dbService.updateTrade(slot.contractId, {
            status: 'CLOSED',
            profitLoss: status.profit,
            profitLossPercent: cfgCF.stake > 0 ? (status.profit / cfgCF.stake) * 100 : 0,
            closedAt: new Date(),
            duration: Date.now() - slot.openedAtMs,
          }).catch((e) => logger.error('DB update failed (coin flip close)', { error: (e as Error).message }));

          adapter.getAccountInfo().then((account) => {
            const capped = applyBalanceCap(account);
            telegram?.notifyTradeClosed(
              strategyConfig.symbol,
              'ACCU',
              cfgCF.stake,
              status.currentPayout,
              status.profit,
              capped.balance,
            );
          }).catch(() => {});

          apiServer.broadcast({
            type: 'trade',
            data: {
              id: slot.contractId,
              type: 'ACCU',
              profitLoss: status.profit,
              status: 'CLOSED',
            },
          });

          // Move slot to cooldown
          slot.state = 'COOLDOWN';
          slot.cooldownUntil = now + cfgCF.cooldownSeconds * 1000;
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes('BetExpired')) {
            coinFlipLosses++;
            logger.info('Coin flip — contract expired (barrier hit)', {
              component: 'Bot',
              dealId: slot.contractId,
              record: `${coinFlipWins}W / ${coinFlipLosses}L`,
            });
            dbService.updateTrade(slot.contractId, {
              status: 'CLOSED',
              profitLoss: -cfgCF.stake,
              profitLossPercent: -100,
              closedAt: new Date(),
              duration: Date.now() - slot.openedAtMs,
            }).catch((e) => logger.error('DB update failed (coin flip expired)', { error: (e as Error).message }));
          } else {
            logger.error('Coin flip poll error', {
              component: 'Bot',
              error: errMsg,
              dealId: slot.contractId,
            });
          }
          slot.state = 'COOLDOWN';
          slot.cooldownUntil = now + cfgCF.cooldownSeconds * 1000;
        }
      }

      // ── 2. Open new contracts to fill available slots ────────────────
      // Count active (non-cooldown) slots
      const activeCount = [...coinFlipSlots.values()].filter(s => s.state === 'OPEN').length;
      const slotsToFill = cfgCF.maxContracts - activeCount - [...coinFlipSlots.values()].filter(s => s.state === 'COOLDOWN').length;

      if (slotsToFill <= 0) return;

      // Pre-check balance once for all new contracts
      let account;
      try {
        account = applyBalanceCap(await adapter.getAccountInfo());
      } catch {
        return;
      }

      if (cfgCF.minBalance > 0 && account.balance <= cfgCF.minBalance) {
        if (coinFlipSlots.size === 0) {
          logger.warn(`Coin flip STOPPED — balance $${account.balance.toFixed(2)} hit floor $${cfgCF.minBalance}`, {
            component: 'Bot',
            record: `${coinFlipWins}W / ${coinFlipLosses}L`,
          });
        }
        return;
      }

      if (!adapter.placeAccumulator) {
        logger.error('Coin flip requires Deriv broker', { component: 'Bot' });
        return;
      }

      // Open contracts one at a time (sequential to avoid race conditions with Deriv)
      for (let i = 0; i < slotsToFill; i++) {
        const totalStakeNeeded = cfgCF.stake;
        if (account.balance < totalStakeNeeded) {
          logger.warn('Coin flip — balance too low for next contract', {
            component: 'Bot',
            balance: account.balance,
            stake: cfgCF.stake,
          });
          break;
        }

        try {
          const result = await adapter.placeAccumulator({
            symbol: strategyConfig.symbol,
            stake: cfgCF.stake,
            growthRate: cfgCF.growthRate,
            takeProfitUSD: cfgCF.takeProfitUSD > 0 ? cfgCF.takeProfitUSD : undefined,
          });

          const slotKey = result.dealId;
          const openedAtMs = Date.now();
          coinFlipSlots.set(slotKey, {
            contractId: result.dealId,
            state: 'OPEN',
            cooldownUntil: 0,
            openedAtMs,
          });

          // Persist to DB
          const accuTrade: Trade = {
            id: result.dealId,
            brokerId: result.dealId,
            symbol: strategyConfig.symbol,
            type: 'ACCU',
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: cfgCF.takeProfitUSD,
            quantity: cfgCF.stake,
            profitLoss: 0,
            profitLossPercent: 0,
            status: 'OPEN',
            openedAt: new Date(openedAtMs),
            strategySignal: `ACCU ${cfgCF.growthRate * 100}% growth`,
            strategyType: strategyConfig.strategyType,
          };
          dbService.saveTrade(accuTrade).catch((e) =>
            logger.error('DB save failed (coin flip open)', { error: (e as Error).message }),
          );

          logger.info('Coin flip — contract opened', {
            component: 'Bot',
            dealId: result.dealId,
            stake: cfgCF.stake,
            growthRate: `${cfgCF.growthRate * 100}%`,
            takeProfitUSD: cfgCF.takeProfitUSD,
            openContracts: [...coinFlipSlots.values()].filter(s => s.state === 'OPEN').length,
            maxContracts: cfgCF.maxContracts,
          });

          telegram?.notifySignal(
            { action: 'BUY', reason: `ACCU $${cfgCF.stake} @ ${cfgCF.growthRate * 100}% growth`, strategyType: 'COIN_FLIP' },
            strategyConfig.symbol,
            0,
          ).catch(() => {});

          apiServer.broadcast({
            type: 'trade',
            data: {
              id: result.dealId,
              symbol: result.symbol,
              type: 'ACCU',
              entryPrice: 0,
              quantity: cfgCF.stake,
              profitLoss: 0,
              status: 'OPEN',
              openedAt: result.openedAt.toISOString(),
            },
          });

          // Deduct stake from local balance tracking to avoid over-opening
          account.balance -= cfgCF.stake;
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes('OpenPositionLimitExceeded')) {
            logger.info('Coin flip — Deriv position limit reached, will retry next tick', {
              component: 'Bot',
              openContracts: [...coinFlipSlots.values()].filter(s => s.state === 'OPEN').length,
            });
            break; // Stop trying to open more this cycle
          } else {
            logger.error('Coin flip open error', {
              component: 'Bot',
              error: errMsg,
            });
            break;
          }
        }
      }
    }, 2000); // Poll every 2 seconds
  }

  function stopCoinFlipLoop(): void {
    if (coinFlipTimer) {
      clearInterval(coinFlipTimer);
      coinFlipTimer = null;
      logger.info('Coin flip loop stopped', { component: 'Bot' });
    }
  }

  // Wire up coin flip hooks for strategy switching
  onCoinFlipStart = startCoinFlipLoop;
  onCoinFlipStop = stopCoinFlipLoop;

  // Auto-start if strategy is an accumulator type on boot
  if (ACCUMULATOR_STRATEGIES.has(strategyConfig.strategyType)) {
    startCoinFlipLoop();
  }

  // ─── Binary Options (Rise/Fall, Even/Odd, Digit Over/Under) autonomous loop ─

  let binaryOptionTimer: NodeJS.Timeout | null = null;
  let binaryWins = 0;
  let binaryLosses = 0;
  let binaryConsecutiveErrors = 0;
  const BINARY_MAX_CONSECUTIVE_ERRORS = 3;

  interface BinarySlot {
    contractId: string;
    state: 'OPEN' | 'COOLDOWN';
    cooldownUntil: number;
    contractType: string;
    openedAtMs: number;
  }
  const binarySlots = new Map<string, BinarySlot>();
  let lastContractEndedAt = 0;          // timestamp of most recent settlement
  let isPlacingBinary = false;          // mutex to prevent overlapping placements
  let lastSignalDirection: string | null = null;
  let lastSignalCandleTime = 0;         // epoch of the candle the signal was based on

  /**
   * Resolve Rise/Fall direction using EMA crossover + RSI.
   * When useTickIndicators is enabled, computes indicators over recent tick prices
   * (more relevant for 5-tick contracts on synthetics). Otherwise uses 1-min candle closes.
   * Returns 'CALL' (rise), 'PUT' (fall), or null (no signal — skip trade).
   */
  function resolveRiseFallSignal(): 'CALL' | 'PUT' | null {
    const cfg = strategyConfig.riseFall;

    let prices: number[];
    let emaFastPeriod: number;
    let emaSlowPeriod: number;
    let rsiPeriod: number;
    let source: string;

    if (cfg.useTickIndicators) {
      // Tick-level indicators — compute over recent tick mid-prices
      const tickPrices = marketData.getTickPrices();
      emaFastPeriod = cfg.tickEmaFast;
      emaSlowPeriod = cfg.tickEmaSlow;
      rsiPeriod = cfg.tickRsiPeriod;
      const minTicks = Math.max(emaSlowPeriod, rsiPeriod) + 2;
      if (tickPrices.length < minTicks) {
        logger.debug('Rise/Fall signal: not enough ticks for indicators', {
          component: 'Bot',
          have: tickPrices.length,
          need: minTicks,
        });
        return null;
      }
      prices = tickPrices as number[];
      source = 'tick';
    } else {
      // Candle-level indicators — original behaviour
      const candles = marketData.getCandles();
      emaFastPeriod = cfg.signalEmaFast;
      emaSlowPeriod = cfg.signalEmaSlow;
      rsiPeriod = cfg.signalRsiPeriod;
      const minBars = Math.max(emaSlowPeriod, rsiPeriod) + 1;
      if (candles.length < minBars) {
        logger.debug('Rise/Fall signal: not enough candles for indicators', {
          component: 'Bot',
          have: candles.length,
          need: minBars,
        });
        return null;
      }
      prices = candles.map((c) => c.close);
      source = 'candle';
    }

    const emaFast = TechnicalIndicators.calculateEMA(prices, emaFastPeriod);
    const emaSlow = TechnicalIndicators.calculateEMA(prices, emaSlowPeriod);
    const rsi = TechnicalIndicators.calculateRSI(prices, rsiPeriod);

    const lastEmaFast = emaFast[emaFast.length - 1];
    const lastEmaSlow = emaSlow[emaSlow.length - 1];
    const lastRsi = rsi[rsi.length - 1];

    if (isNaN(lastEmaFast) || isNaN(lastEmaSlow) || isNaN(lastRsi)) return null;

    const emaBullish = lastEmaFast > lastEmaSlow;
    const emaBearish = lastEmaFast < lastEmaSlow;
    const rsiOversold = lastRsi < cfg.signalRsiOversold;
    const rsiOverbought = lastRsi > cfg.signalRsiOverbought;
    const rsiNeutral = !rsiOversold && !rsiOverbought;

    // Tick-level RSI strength filter: require RSI to be far enough from 50
    // to indicate actual momentum, not just noise in the dead zone.
    if (source === 'tick' && cfg.tickRsiMinStrength > 0) {
      const rsiStrength = Math.abs(lastRsi - 50);
      if (rsiStrength < cfg.tickRsiMinStrength) {
        logger.debug(`Rise/Fall signal [tick]: RSI ${lastRsi.toFixed(1)} too close to 50 (strength ${rsiStrength.toFixed(1)} < ${cfg.tickRsiMinStrength}) — skipping`, { component: 'Bot' });
        return null;
      }
    }

    // Determine direction + reason
    let direction: 'CALL' | 'PUT' | null = null;
    let reason = '';

    if (cfg.requireConfluence) {
      if (emaBullish && (rsiNeutral || rsiOversold)) { direction = 'CALL'; reason = `EMA bullish + RSI ${lastRsi.toFixed(1)}`; }
      else if (emaBearish && (rsiNeutral || rsiOverbought)) { direction = 'PUT'; reason = `EMA bearish + RSI ${lastRsi.toFixed(1)}`; }
    } else {
      if (rsiOversold) { direction = 'CALL'; reason = `RSI oversold ${lastRsi.toFixed(1)}`; }
      else if (rsiOverbought) { direction = 'PUT'; reason = `RSI overbought ${lastRsi.toFixed(1)}`; }
      else if (emaBullish) { direction = 'CALL'; reason = `EMA bullish, RSI ${lastRsi.toFixed(1)}`; }
      else if (emaBearish) { direction = 'PUT'; reason = `EMA bearish, RSI ${lastRsi.toFixed(1)}`; }
    }

    if (!direction) return null;

    if (source === 'candle') {
      // Candle-level staleness: skip if same direction on same candle
      const candles = marketData.getCandles();
      const latestCandleTime = candles[candles.length - 1].timestamp.getTime();
      if (direction === lastSignalDirection && latestCandleTime === lastSignalCandleTime) {
        logger.debug('Rise/Fall signal: stale (same direction, same candle) — skipping', { component: 'Bot' });
        return null;
      }
      lastSignalCandleTime = latestCandleTime;
    }
    // Tick-level: no staleness check — signal is fresh every tick, cooldown handles spacing

    lastSignalDirection = direction;
    logger.info(`Rise/Fall signal [${source}]: ${direction === 'CALL' ? 'RISE' : 'FALL'} (${reason})`, { component: 'Bot' });
    return direction;
  }

  /** Resolve the Deriv contract_type from current strategy config. Returns null when signal mode says skip. */
  function resolveBinaryContractType(): { contractType: string; barrier?: number } | null {
    const st = strategyConfig.strategyType;
    if (st === 'RISE_FALL') {
      const dir = strategyConfig.riseFall.direction;
      if (dir === 'signal') {
        const signal = resolveRiseFallSignal();
        if (signal) return { contractType: signal };
        // No signal — skip or fallback to random
        if (strategyConfig.riseFall.skipOnNoSignal) return null;
        return { contractType: Math.random() < 0.5 ? 'CALL' : 'PUT' };
      }
      if (dir === 'auto') return { contractType: Math.random() < 0.5 ? 'CALL' : 'PUT' };
      return { contractType: dir === 'rise' ? 'CALL' : 'PUT' };
    }
    if (st === 'EVEN_ODD') {
      const pred = strategyConfig.evenOdd.prediction;
      if (pred === 'auto') return { contractType: Math.random() < 0.5 ? 'DIGITEVEN' : 'DIGITODD' };
      return { contractType: pred === 'even' ? 'DIGITEVEN' : 'DIGITODD' };
    }
    if (st === 'DIGIT_OVER_UNDER') {
      const cfg = strategyConfig.digitOverUnder;
      return {
        contractType: cfg.direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: cfg.barrier,
      };
    }
    // ── Martingale: uses Rise/Fall or Even/Odd contracts ────────────────────
    if (st === 'MARTINGALE') {
      const cfg = strategyConfig.martingale;
      if (cfg.contractType === 'even_odd') {
        return { contractType: Math.random() < 0.5 ? 'DIGITEVEN' : 'DIGITODD' };
      }
      // rise_fall
      if (cfg.directionMode === 'signal') {
        const signal = resolveRiseFallSignal();
        if (signal) return { contractType: signal };
        return null; // No signal — skip trade
      }
      return { contractType: Math.random() < 0.5 ? 'CALL' : 'PUT' };
    }
    // ── Momentum Rise/Fall: EMA-driven direction ───────────────────────────
    if (st === 'MOMENTUM_RISE_FALL') {
      const signal = resolveRiseFallSignal();
      if (signal) return { contractType: signal };
      return null; // No signal = don't trade
    }
    // ── Digit Sniper: DIGITMATCH — target digit is set per-contract in the loop
    if (st === 'DIGIT_SNIPER') {
      // Use first target digit as default; the loop handles multi-digit firing
      const digits = strategyConfig.digitSniper.targetDigits;
      return { contractType: 'DIGITMATCH', barrier: digits[0] ?? 5 };
    }
    // ── Volatility Breakout: CALL for Boom, PUT for Crash ──────────────────
    if (st === 'VOLATILITY_BREAKOUT') {
      const idx = strategyConfig.volatilityBreakout.targetIndex;
      return { contractType: idx.startsWith('BOOM') ? 'CALL' : 'PUT' };
    }
    // ── All-In Recovery: depends on recovery contract type ─────────────────
    if (st === 'ALL_IN_RECOVERY') {
      const cfg = strategyConfig.allInRecovery;
      if (cfg.recoveryContractType === 'even_odd') {
        return { contractType: Math.random() < 0.5 ? 'DIGITEVEN' : 'DIGITODD' };
      }
      if (cfg.recoveryContractType === 'rise_fall') {
        return { contractType: Math.random() < 0.5 ? 'CALL' : 'PUT' };
      }
      // accumulator — shouldn't reach here, but fallback
      return { contractType: 'CALL' };
    }
    return { contractType: 'CALL' };
  }

  /** Get the active config for the current binary option strategy. */
  function getBinaryConfig(): { stake: number; durationTicks: number; maxContracts: number; cooldownSeconds: number; minBalance: number } {
    const st = strategyConfig.strategyType;
    if (st === 'RISE_FALL') return strategyConfig.riseFall;
    if (st === 'EVEN_ODD') return strategyConfig.evenOdd;
    if (st === 'DIGIT_OVER_UNDER') return strategyConfig.digitOverUnder;
    if (st === 'MARTINGALE') {
      const cfg = strategyConfig.martingale;
      return { stake: cfg.baseStake, durationTicks: cfg.durationTicks, maxContracts: 1, cooldownSeconds: cfg.cooldownSeconds, minBalance: cfg.minBalance };
    }
    if (st === 'MOMENTUM_RISE_FALL') {
      const cfg = strategyConfig.momentumRiseFall;
      return { stake: cfg.stake, durationTicks: cfg.durationTicks, maxContracts: cfg.maxBurstContracts, cooldownSeconds: cfg.burstIntervalSeconds, minBalance: cfg.minBalance };
    }
    if (st === 'DIGIT_SNIPER') {
      const cfg = strategyConfig.digitSniper;
      return { stake: cfg.stakePerDigit, durationTicks: cfg.durationTicks, maxContracts: cfg.maxConcurrentRounds, cooldownSeconds: cfg.cooldownSeconds, minBalance: cfg.minBalance };
    }
    if (st === 'VOLATILITY_BREAKOUT') {
      const cfg = strategyConfig.volatilityBreakout;
      return { stake: cfg.stake, durationTicks: cfg.turboDurationMinutes * 60, maxContracts: cfg.maxContracts, cooldownSeconds: cfg.cooldownSeconds, minBalance: cfg.minBalance };
    }
    if (st === 'ALL_IN_RECOVERY') {
      const cfg = strategyConfig.allInRecovery;
      return { stake: cfg.recoveryStake, durationTicks: 5, maxContracts: 1, cooldownSeconds: cfg.cooldownSeconds, minBalance: cfg.hardStopBalance };
    }
    return strategyConfig.digitOverUnder;
  }

  function startBinaryOptionLoop(): void {
    if (binaryOptionTimer) return;
    binarySlots.clear();
    binaryWins = 0;
    binaryLosses = 0;
    binaryConsecutiveErrors = 0;
    lastContractEndedAt = 0;
    isPlacingBinary = false;
    lastSignalDirection = null;
    lastSignalCandleTime = 0;
    const cfg = getBinaryConfig();
    logger.info('Binary option loop started', {
      component: 'Bot',
      strategy: strategyConfig.strategyType,
      maxContracts: cfg.maxContracts,
    });

    binaryOptionTimer = setInterval(async () => {
      if (!botState.isRunning || botState.isPaused) return;
      if (!BINARY_OPTION_STRATEGIES.has(strategyConfig.strategyType)) return;

      const cfg = getBinaryConfig();
      const now = Date.now();

      // ── 1. Check all open contracts for settlement ────────────────
      for (const [slotKey, slot] of binarySlots) {
        if (slot.state === 'COOLDOWN') {
          if (now >= slot.cooldownUntil) {
            binarySlots.delete(slotKey);
          }
          continue;
        }

        // state === 'OPEN' — poll contract status
        try {
          const status = await (adapter as any).getBinaryOptionStatus(slot.contractId);

          if (status.isOpen) continue; // Still running

          // Contract settled — immediately mark as COOLDOWN to prevent duplicate processing
          slot.state = 'COOLDOWN';
          slot.cooldownUntil = now + cfg.cooldownSeconds * 1000;
          lastContractEndedAt = now;

          const won = status.profit > 0;
          if (won) binaryWins++; else binaryLosses++;

          logger.info(`Binary option — contract ended (${won ? 'WIN' : 'LOSS'})`, {
            component: 'Bot',
            strategy: strategyConfig.strategyType,
            contractType: slot.contractType,
            dealId: slot.contractId,
            profit: status.profit.toFixed(2),
            record: `${binaryWins}W / ${binaryLosses}L`,
          });

          // Persist settlement to DB
          dbService.updateTrade(slot.contractId, {
            status: 'CLOSED',
            profitLoss: status.profit,
            profitLossPercent: cfg.stake > 0 ? (status.profit / cfg.stake) * 100 : 0,
            closedAt: new Date(),
            duration: Date.now() - slot.openedAtMs,
          }).catch((e) => logger.error('DB update failed (binary close)', { error: (e as Error).message }));

          adapter.getAccountInfo().then((account) => {
            const capped = applyBalanceCap(account);
            telegram?.notifyTradeClosed(
              strategyConfig.symbol,
              slot.contractType as any,
              cfg.stake,
              status.payout,
              status.profit,
              capped.balance,
            );
          }).catch(() => {});

          apiServer.broadcast({
            type: 'trade',
            data: {
              id: slot.contractId,
              type: slot.contractType,
              profitLoss: status.profit,
              status: 'CLOSED',
            },
          });
        } catch (err) {
          logger.error('Binary option poll error', {
            component: 'Bot',
            error: (err as Error).message,
            dealId: slot.contractId,
          });
          slot.state = 'COOLDOWN';
          slot.cooldownUntil = now + cfg.cooldownSeconds * 1000;
        }
      }

      // ── 2. Open new contracts to fill available slots ────────────
      if (isPlacingBinary) return; // Prevent overlapping async placements

      const activeCount = [...binarySlots.values()].filter(s => s.state === 'OPEN').length;
      const cooldownCount = [...binarySlots.values()].filter(s => s.state === 'COOLDOWN').length;
      const slotsToFill = cfg.maxContracts - activeCount - cooldownCount;

      if (slotsToFill <= 0) return;

      // Enforce minimum gap after last contract settlement (cooldownSeconds)
      const minGapMs = cfg.cooldownSeconds * 1000;
      if (lastContractEndedAt > 0 && (now - lastContractEndedAt) < minGapMs) return;

      let account;
      try {
        account = applyBalanceCap(await adapter.getAccountInfo());
      } catch {
        return;
      }

      if (cfg.minBalance > 0 && account.balance <= cfg.minBalance) {
        if (binarySlots.size === 0) {
          logger.warn(`Binary option STOPPED — balance $${account.balance.toFixed(2)} hit floor $${cfg.minBalance}`, {
            component: 'Bot',
            record: `${binaryWins}W / ${binaryLosses}L`,
          });
        }
        return;
      }

      if (!adapter.placeBinaryOption) {
        logger.error('Binary options require Deriv broker', { component: 'Bot' });
        return;
      }

      isPlacingBinary = true;
      for (let i = 0; i < slotsToFill; i++) {
        if (account.balance < cfg.stake) {
          logger.warn('Binary option — balance too low for stake', {
            component: 'Bot',
            balance: account.balance,
            stake: cfg.stake,
          });
          break;
        }

        try {
          const resolved = resolveBinaryContractType();
          if (!resolved) {
            logger.debug('Binary option — no signal, skipping this tick', { component: 'Bot' });
            continue;
          }
          const { contractType, barrier } = resolved;

          const result = await adapter.placeBinaryOption({
            symbol: strategyConfig.symbol,
            stake: cfg.stake,
            contractType,
            durationTicks: cfg.durationTicks,
            barrier,
          });

          const binaryOpenedAtMs = Date.now();
          binarySlots.set(result.dealId, {
            contractId: result.dealId,
            state: 'OPEN',
            cooldownUntil: 0,
            contractType,
            openedAtMs: binaryOpenedAtMs,
          });

          // Persist to DB
          const binaryTrade: Trade = {
            id: result.dealId,
            brokerId: result.dealId,
            symbol: strategyConfig.symbol,
            type: contractType as Trade['type'],
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            quantity: cfg.stake,
            profitLoss: 0,
            profitLossPercent: 0,
            status: 'OPEN',
            openedAt: new Date(binaryOpenedAtMs),
            strategySignal: `${contractType}${barrier != null ? ` barrier=${barrier}` : ''} ${cfg.durationTicks}t`,
            strategyType: strategyConfig.strategyType,
          };
          dbService.saveTrade(binaryTrade).catch((e) =>
            logger.error('DB save failed (binary open)', { error: (e as Error).message }),
          );

          logger.info('Binary option — contract opened', {
            component: 'Bot',
            strategy: strategyConfig.strategyType,
            contractType,
            dealId: result.dealId,
            stake: cfg.stake,
            durationTicks: cfg.durationTicks,
            barrier,
            payout: result.payout,
            openContracts: [...binarySlots.values()].filter(s => s.state === 'OPEN').length,
          });

          apiServer.broadcast({
            type: 'trade',
            data: {
              id: result.dealId,
              symbol: result.symbol,
              type: contractType,
              entryPrice: 0,
              quantity: cfg.stake,
              profitLoss: 0,
              status: 'OPEN',
              openedAt: result.openedAt.toISOString(),
            },
          });

          account.balance -= cfg.stake;
          binaryConsecutiveErrors = 0; // Reset on success
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes('OpenPositionLimitExceeded')) {
            logger.info('Binary option — Deriv position limit reached, will retry next tick', { component: 'Bot' });
            break;
          }

          binaryConsecutiveErrors++;
          const isAssetError = errMsg.includes('not offered for this asset');
          const isDurationError = errMsg.includes('not offered for this duration');

          if (isAssetError) {
            logger.error(`Binary option STOPPED — ${strategyConfig.strategyType} is not available on ${strategyConfig.symbol}. Try switching to R_10, R_25, R_50, R_75, or R_100 (digit contracts require 2s-tick synthetics).`, {
              component: 'Bot',
              symbol: strategyConfig.symbol,
              strategy: strategyConfig.strategyType,
            });
            isPlacingBinary = false;
            stopBinaryOptionLoop();
            return;
          }

          if (binaryConsecutiveErrors >= BINARY_MAX_CONSECUTIVE_ERRORS) {
            logger.error(`Binary option PAUSED — ${binaryConsecutiveErrors} consecutive errors. Check symbol/contract compatibility.`, {
              component: 'Bot',
              lastError: errMsg,
              symbol: strategyConfig.symbol,
              strategy: strategyConfig.strategyType,
            });
            isPlacingBinary = false;
            stopBinaryOptionLoop();
            return;
          }

          logger.error('Binary option open error', {
            component: 'Bot',
            error: errMsg,
            consecutiveErrors: binaryConsecutiveErrors,
          });
          break;
        }
      }
      isPlacingBinary = false;
    }, 2000);
  }

  function stopBinaryOptionLoop(): void {
    if (binaryOptionTimer) {
      clearInterval(binaryOptionTimer);
      binaryOptionTimer = null;
      logger.info('Binary option loop stopped', { component: 'Bot' });
    }
  }

  // Wire up binary option hooks
  onBinaryOptionStart = startBinaryOptionLoop;
  onBinaryOptionStop = stopBinaryOptionLoop;

  // Auto-start if strategy is a binary option type on boot
  if (BINARY_OPTION_STRATEGIES.has(strategyConfig.strategyType)) {
    startBinaryOptionLoop();
  }

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

    positionMonitor.stop();
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

/** Schedule the daily Telegram report to fire at 23:55 UTC each day. */
function scheduleDailyReport(
  telegram: TelegramService | null,
  dbService: DatabaseService,
  adapter: IBrokerAdapter,
): void {
  if (!telegram) return;

  const msUntilReportTime = (): number => {
    const now = new Date();
    const target = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 55, 0),
    );
    // If we've already passed 23:55 today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    const delay = msUntilReportTime();
    logger.info('Daily Telegram report scheduled', {
      component: 'Bot',
      firesIn: `${Math.round(delay / 60_000)}m`,
    });

    setTimeout(async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const trades = await dbService.getTradesByDate(today);
        const account = applyBalanceCap(await adapter.getAccountInfo());

        const closed = trades.filter((t) => t.status === 'CLOSED');
        const open = trades.filter((t) => t.status === 'OPEN');
        const wins = closed.filter((t) => t.profitLoss > 0);
        const losses = closed.filter((t) => t.profitLoss <= 0);
        const grossProfit = wins.reduce((s, t) => s + t.profitLoss, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profitLoss, 0));
        const netPnL = grossProfit - grossLoss;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
        const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
        const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
        const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
        const bestTrade = closed.length > 0 ? Math.max(...closed.map((t) => t.profitLoss)) : 0;
        const worstTrade = closed.length > 0 ? Math.min(...closed.map((t) => t.profitLoss)) : 0;
        const totalStaked = closed.reduce((s, t) => s + t.quantity, 0);
        const roi = totalStaked > 0 ? (netPnL / totalStaked) * 100 : 0;

        // Strategy breakdown
        const stratMap = new Map<string, { wins: number; losses: number; pnl: number; trades: number }>();
        for (const t of closed) {
          const key = t.strategyType ?? 'Unknown';
          const entry = stratMap.get(key) ?? { wins: 0, losses: 0, pnl: 0, trades: 0 };
          entry.trades++;
          entry.pnl += t.profitLoss;
          if (t.profitLoss > 0) entry.wins++; else entry.losses++;
          stratMap.set(key, entry);
        }

        const report: DailyReport = {
          date: today,
          balance: account.balance,
          trades: trades.length,
          closed: closed.length,
          openPositions: open.length,
          wins: wins.length,
          losses: losses.length,
          winRate,
          grossProfit,
          grossLoss,
          netPnL,
          profitFactor,
          avgWin,
          avgLoss,
          bestTrade,
          worstTrade,
          totalStaked,
          roi,
          byStrategy: [...stratMap.entries()]
            .sort((a, b) => b[1].pnl - a[1].pnl)
            .map(([name, s]) => ({ name: name.replace(/_/g, ' '), ...s })),
        };

        await telegram.sendDailyReport(report);
        logger.info('Daily Telegram report sent', { component: 'Bot', date: today, trades: trades.length });
      } catch (err) {
        logger.error('Failed to send daily Telegram report', {
          component: 'Bot',
          error: (err as Error).message,
        });
      }
      scheduleNext();
    }, delay);
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
