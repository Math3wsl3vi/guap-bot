import http from 'http';
import os from 'os';
import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { IBrokerAdapter } from './IBrokerAdapter';
import { MarketDataService } from './MarketDataService';
import { OrderService } from './OrderService';
import { DatabaseService } from './DatabaseService';
import { RiskManager } from './RiskManager';
import { strategyConfig } from '../config/strategy.config';
import { riskConfig } from '../config/risk.config';
import { getLogBuffer } from '../utils/LogBuffer';
import { logger } from '../utils/logger';

export interface BotState {
  isRunning: boolean;
  isPaused: boolean;
  startedAt: Date | null;
}

export interface ApiServerConfig {
  adapter: IBrokerAdapter;
  marketData: MarketDataService;
  orderService: OrderService;
  dbService: DatabaseService;
  riskManager: RiskManager;
  botState: BotState;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => void;
  onStrategyUpdate: () => void;
}

export class ApiServer {
  private readonly app: express.Application;
  private readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private readonly cfg: ApiServerConfig;

  constructor(config: ApiServerConfig) {
    this.cfg = config;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  // ─── Middleware ─────────────────────────────────────────────────────────────

  private setupMiddleware(): void {
    this.app.use(express.json());

    // Permissive CORS for the Vite dev server
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // ─── REST Routes ────────────────────────────────────────────────────────────

  private setupRoutes(): void {
    const { adapter, marketData, orderService, dbService, riskManager, botState } = this.cfg;

    // ── GET /api/status ────────────────────────────────────────────────────────
    this.app.get('/api/status', async (_req: Request, res: Response) => {
      try {
        const uptime = botState.startedAt
          ? Math.floor((Date.now() - botState.startedAt.getTime()) / 1000)
          : 0;

        const allTrades = await dbService.getTradeHistory(1000);
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const totalTradesToday = allTrades.filter(
          (t) => new Date(t.openedAt) >= dayStart,
        ).length;

        res.json({
          isRunning: botState.isRunning,
          isPaused: botState.isPaused,
          lastStarted: botState.startedAt?.toISOString() ?? null,
          uptime,
          totalTradesToday,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/account ────────────────────────────────────────────────────────
    this.app.get('/api/account', async (_req: Request, res: Response) => {
      try {
        const account = await adapter.getAccountInfo();

        const allTrades = await dbService.getTradeHistory(1000);
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const todayPnL = allTrades
          .filter((t) => t.status === 'CLOSED' && t.closedAt && new Date(t.closedAt) >= dayStart)
          .reduce((sum, t) => sum + (t.profitLoss || 0), 0);
        const todayPnLPercent = account.balance > 0 ? (todayPnL / account.balance) * 100 : 0;

        const freeMargin = account.equity - account.margin;
        const marginLevel = account.margin > 0 ? (account.equity / account.margin) * 100 : 0;

        res.json({
          balance: account.balance,
          equity: account.equity,
          margin: account.margin,
          freeMargin: +freeMargin.toFixed(2),
          marginLevel: +marginLevel.toFixed(2),
          currency: account.currency,
          todayPnL: +todayPnL.toFixed(2),
          todayPnLPercent: +todayPnLPercent.toFixed(2),
        });
      } catch (err) {
        res.status(503).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/positions ───────────────────────────────────────────────────────
    this.app.get('/api/positions', async (_req: Request, res: Response) => {
      try {
        const positions = await orderService.getOpenPositions();
        res.json(positions);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/trades ──────────────────────────────────────────────────────────
    this.app.get('/api/trades', async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 500);
        const trades = await dbService.getTradeHistory(limit);
        res.json(trades);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/metrics ─────────────────────────────────────────────────────────
    this.app.get('/api/metrics', async (_req: Request, res: Response) => {
      try {
        const trades = await dbService.getTradeHistory(10000);
        const closed = trades.filter((t) => t.status === 'CLOSED');
        const wins = closed.filter((t) => t.profitLoss > 0);
        const losses = closed.filter((t) => t.profitLoss <= 0);

        const grossProfit = wins.reduce((s, t) => s + t.profitLoss, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profitLoss, 0));
        const profitFactor =
          grossLoss > 0 ? grossProfit / grossLoss : wins.length > 0 ? 999 : 0;
        const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
        const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
        const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;
        const totalProfit = closed.reduce((s, t) => s + t.profitLoss, 0);
        const bestTrade = closed.length > 0 ? Math.max(...closed.map((t) => t.profitLoss)) : 0;
        const worstTrade = closed.length > 0 ? Math.min(...closed.map((t) => t.profitLoss)) : 0;

        const riskState = riskManager.getState();
        const drawdownFraction =
          riskState.peakEquity > 0
            ? riskState.dailyLoss / riskState.peakEquity
            : 0;

        res.json({
          totalTrades: closed.length,
          winningTrades: wins.length,
          losingTrades: losses.length,
          winRate: +winRate.toFixed(1),
          profitFactor: +Math.min(profitFactor, 999).toFixed(2),
          averageWin: +averageWin.toFixed(2),
          averageLoss: +averageLoss.toFixed(2),
          maxDrawdown: +Math.max(0, drawdownFraction * 100).toFixed(2),
          sharpeRatio: 0,
          totalProfit: +totalProfit.toFixed(2),
          bestTrade: +bestTrade.toFixed(2),
          worstTrade: +worstTrade.toFixed(2),
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/candles ─────────────────────────────────────────────────────────
    this.app.get('/api/candles', (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? '60')), 200);
        const candles = marketData.getCandles();
        res.json(
          candles.slice(-limit).map((c) => ({
            time: c.timestamp instanceof Date ? c.timestamp.toISOString() : c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
        );
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/logs ────────────────────────────────────────────────────────────
    this.app.get('/api/logs', (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);
        const all = getLogBuffer();
        // Return most-recent first
        res.json(all.slice(-limit).reverse());
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/health ───────────────────────────────────────────────────────────
    this.app.get('/api/health', async (_req: Request, res: Response) => {
      try {
        const memInfo = process.memoryUsage();
        const totalMem = os.totalmem();
        const memUsagePct = Math.round((memInfo.rss / totalMem) * 100);

        // Measure broker round-trip latency
        let latency = -1;
        try {
          const t0 = Date.now();
          await adapter.getAccountInfo();
          latency = Date.now() - t0;
        } catch {
          // broker unreachable
        }

        res.json({
          apiConnection: adapter.isConnected(),
          webSocket: adapter.isConnected(),
          database: true,
          redis: false,
          latency,
          uptime: Math.floor(process.uptime()),
          cpuUsage: 0,
          memoryUsage: memUsagePct,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/strategy ─────────────────────────────────────────────────────────
    this.app.get('/api/strategy', (_req: Request, res: Response) => {
      res.json({
        emaFast: strategyConfig.emaFastPeriod,
        emaSlow: strategyConfig.emaSlowPeriod,
        rsiPeriod: strategyConfig.rsiPeriod,
        rsiOverbought: strategyConfig.rsiOverbought,
        rsiOversold: strategyConfig.rsiOversold,
        takeProfit: strategyConfig.takeProfitPips,
        stopLoss: strategyConfig.stopLossPips,
        trailingStop: strategyConfig.trailingStopEnabled,
        trailingStopPips: strategyConfig.trailingStopPips,
        riskPerTrade: +(riskConfig.maxRiskPerTrade * 100).toFixed(2),
        maxPositions: riskConfig.maxOpenPositions,
        dailyLossLimit: +(riskConfig.maxDailyLoss * 100).toFixed(2),
        maxDrawdown: +(riskConfig.maxDrawdown * 100).toFixed(2),
        positionSizing: strategyConfig.positionSizing,
        tradingDays: strategyConfig.tradingDays,
        tradingHoursStart: strategyConfig.tradingHoursStart,
        tradingHoursEnd: strategyConfig.tradingHoursEnd,
        timezone: strategyConfig.timezone,
      });
    });

    // ── PUT /api/strategy ─────────────────────────────────────────────────────────
    this.app.put('/api/strategy', (req: Request, res: Response) => {
      try {
        const b = req.body as Record<string, unknown>;

        if (b.emaFast != null) strategyConfig.emaFastPeriod = Number(b.emaFast);
        if (b.emaSlow != null) strategyConfig.emaSlowPeriod = Number(b.emaSlow);
        if (b.rsiPeriod != null) strategyConfig.rsiPeriod = Number(b.rsiPeriod);
        if (b.rsiOverbought != null) strategyConfig.rsiOverbought = Number(b.rsiOverbought);
        if (b.rsiOversold != null) strategyConfig.rsiOversold = Number(b.rsiOversold);
        if (b.takeProfit != null) strategyConfig.takeProfitPips = Number(b.takeProfit);
        if (b.stopLoss != null) strategyConfig.stopLossPips = Number(b.stopLoss);
        if (b.trailingStop != null) strategyConfig.trailingStopEnabled = Boolean(b.trailingStop);
        if (b.trailingStopPips != null) strategyConfig.trailingStopPips = Number(b.trailingStopPips);
        if (b.positionSizing != null)
          strategyConfig.positionSizing = b.positionSizing as typeof strategyConfig.positionSizing;
        if (Array.isArray(b.tradingDays)) strategyConfig.tradingDays = b.tradingDays as string[];
        if (b.tradingHoursStart != null) strategyConfig.tradingHoursStart = String(b.tradingHoursStart);
        if (b.tradingHoursEnd != null) strategyConfig.tradingHoursEnd = String(b.tradingHoursEnd);
        if (b.timezone != null) strategyConfig.timezone = String(b.timezone);

        // Risk config updates (frontend sends them as %)
        if (b.riskPerTrade != null) riskConfig.maxRiskPerTrade = Number(b.riskPerTrade) / 100;
        if (b.maxPositions != null) riskConfig.maxOpenPositions = Number(b.maxPositions);
        if (b.dailyLossLimit != null) riskConfig.maxDailyLoss = Number(b.dailyLossLimit) / 100;
        if (b.maxDrawdown != null) riskConfig.maxDrawdown = Number(b.maxDrawdown) / 100;

        // Re-instantiate strategy so new EMA/RSI periods take effect immediately
        this.cfg.onStrategyUpdate();

        logger.info('Strategy config updated via API', { component: 'ApiServer' });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── POST /api/bot/start ───────────────────────────────────────────────────────
    this.app.post('/api/bot/start', async (_req: Request, res: Response) => {
      try {
        if (botState.isRunning) {
          res.json({ success: false, message: 'Bot is already running' });
          return;
        }
        await this.cfg.onStart();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── POST /api/bot/stop ────────────────────────────────────────────────────────
    this.app.post('/api/bot/stop', async (_req: Request, res: Response) => {
      try {
        if (!botState.isRunning) {
          res.json({ success: false, message: 'Bot is not running' });
          return;
        }
        await this.cfg.onStop();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── POST /api/bot/pause ───────────────────────────────────────────────────────
    this.app.post('/api/bot/pause', (_req: Request, res: Response) => {
      try {
        this.cfg.onPause();
        res.json({ success: true, isPaused: botState.isPaused });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }

  // ─── WebSocket ───────────────────────────────────────────────────────────────

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.debug('WS client connected', { component: 'ApiServer' });
      ws.on('close', () => logger.debug('WS client disconnected', { component: 'ApiServer' }));
      ws.on('error', (err) =>
        logger.warn('WS client error', { component: 'ApiServer', error: err.message }),
      );
    });
  }

  /** Broadcast a typed event to every connected WebSocket client. */
  broadcast(event: { type: string; data: unknown }): void {
    const payload = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  start(port: number): void {
    this.server.listen(port, () => {
      logger.info(`API server listening on http://localhost:${port}`, {
        component: 'ApiServer',
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => resolve());
    });
  }
}
