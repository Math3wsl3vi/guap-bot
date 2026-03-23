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
import { Timeframe } from '../models/Candle';
import { INSTRUMENTS, getInstrumentConfig } from '../config/instruments.config';
import { getLogBuffer } from '../utils/LogBuffer';
import { Trade } from '../models/Trade';
import { TradeQueryFilters } from './DatabaseService';
import { logger } from '../utils/logger';

const SIMULATED_BALANCE = process.env.SIMULATED_BALANCE
  ? parseFloat(process.env.SIMULATED_BALANCE)
  : null;

function applyBalanceCap<T extends { balance: number; equity: number }>(account: T): T {
  if (SIMULATED_BALANCE === null) return account;
  return { ...account, balance: Math.min(account.balance, SIMULATED_BALANCE), equity: Math.min(account.equity, SIMULATED_BALANCE) };
}
import { BaseStrategy, hasLifecycle } from '../strategies/BaseStrategy';
import { GridTradingStrategy } from '../strategies/GridTradingStrategy';
import { PRESETS, getPresetById, getActivePresetId, setActivePresetId } from '../config/presets';
import { TrackedPosition } from './PositionMonitor';

function parseTradeFilters(req: Request): TradeQueryFilters {
  const { from, to, strategy, status, outcome, minSize, maxSize, limit, offset } = req.query;
  return {
    from: from ? String(from) : undefined,
    to: to ? String(to) : undefined,
    strategy: strategy ? String(strategy) : undefined,
    status: status ? String(status) as 'OPEN' | 'CLOSED' : undefined,
    outcome: outcome ? String(outcome) as 'win' | 'loss' : undefined,
    minSize: minSize ? parseFloat(String(minSize)) : undefined,
    maxSize: maxSize ? parseFloat(String(maxSize)) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 100,
    offset: offset ? parseInt(String(offset), 10) : 0,
  };
}

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
  getStrategy: () => BaseStrategy;
  /** Returns the tracked trailing/breakeven state for all monitored positions. */
  getTrackedPositions: () => ReadonlyMap<string, TrackedPosition>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => void;
  onStrategyUpdate: () => void;
  /** Full reconnect cycle: disconnect old adapter → create new → connect → rebuild services. */
  onBrokerSwitch: () => Promise<void>;
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
    // adapter, marketData, orderService are NOT destructured here — they are
    // accessed via this.cfg.* so broker switching can swap them at runtime.
    const { dbService, riskManager, botState } = this.cfg;

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
        const account = applyBalanceCap(await this.cfg.adapter.getAccountInfo());

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
        const positions = await this.cfg.orderService.getOpenPositions();
        const tracked = this.cfg.getTrackedPositions();

        // Map Position → frontend Trade shape so field names align
        res.json(
          positions.map((p) => {
            const brokerId = p.brokerId ?? p.id;
            const ts = tracked.get(brokerId);
            return {
              id: p.id,
              brokerId: p.brokerId,
              symbol: p.symbol,
              type: p.type,
              entryPrice: p.entryPrice,
              currentPrice: p.currentPrice,
              stopLoss: p.stopLoss,
              takeProfit: p.takeProfit,
              quantity: p.quantity,
              profitLoss: p.unrealisedPnL,
              profitLossPercent: p.unrealisedPnLPercent,
              status: 'OPEN' as const,
              openedAt: p.openedAt instanceof Date ? p.openedAt.toISOString() : p.openedAt,
              trailingStopActive: ts?.trailingActive ?? false,
              trailingStopLevel: ts?.trailingStopLevel ?? null,
              breakevenApplied: ts?.breakevenApplied ?? false,
            };
          }),
        );
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── POST /api/positions/:id/close ────────────────────────────────────────────
    this.app.post('/api/positions/:id/close', async (req: Request, res: Response) => {
      try {
        const positionId = req.params.id;

        // Get live positions to find current price
        const livePositions = await this.cfg.orderService.getOpenPositions();
        const position = livePositions.find((p) => p.id === positionId);
        if (!position) {
          res.status(404).json({ error: 'Position not found' });
          return;
        }

        // Find the matching DB trade record by brokerId (may not exist for
        // positions opened outside the bot or before the DB was set up).
        const openTrades = await dbService.getOpenTrades();
        const trade = openTrades.find((t) => t.brokerId === positionId);

        if (trade) {
          const update = await this.cfg.orderService.closePosition(positionId, position.currentPrice, trade);
          await dbService.updateTrade(trade.id, update);
        } else {
          // No DB record — close directly on broker
          await this.cfg.adapter.closePosition(positionId);
        }

        logger.info('Position closed via API', { component: 'ApiServer', positionId });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/trades ──────────────────────────────────────────────────────────
    this.app.get('/api/trades', async (req: Request, res: Response) => {
      try {
        const filters = parseTradeFilters(req);
        const result = await dbService.getFilteredTrades(filters);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/trades/export/csv ────────────────────────────────────────────────
    this.app.get('/api/trades/export/csv', async (req: Request, res: Response) => {
      try {
        const filters = parseTradeFilters(req);
        filters.limit = 10000; // export all matching
        filters.offset = 0;
        const { trades } = await dbService.getFilteredTrades(filters);

        const header = 'Date,Symbol,Type,Strategy,Stake,Entry Price,Exit Price,Stop Loss,Take Profit,P&L,P&L %,Status,Duration (s),Signal';
        const rows = trades.map((t) => {
          const opened = t.openedAt instanceof Date ? t.openedAt.toISOString() : t.openedAt;
          const closed = t.closedAt ? (t.closedAt instanceof Date ? t.closedAt.toISOString() : t.closedAt) : '';
          return [
            opened,
            t.symbol,
            t.type,
            t.strategyType ?? '',
            t.quantity.toFixed(2),
            t.entryPrice.toFixed(5),
            t.exitPrice?.toFixed(5) ?? '',
            t.stopLoss.toFixed(5),
            t.takeProfit.toFixed(5),
            t.profitLoss.toFixed(2),
            t.profitLossPercent.toFixed(2),
            t.status,
            t.duration ? (t.duration / 1000).toFixed(1) : '',
            `"${(t.strategySignal ?? '').replace(/"/g, '""')}"`,
          ].join(',');
        });

        const csv = [header, ...rows].join('\n');
        const filename = `trades_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/trades/export/pdf ────────────────────────────────────────────────
    this.app.get('/api/trades/export/pdf', async (req: Request, res: Response) => {
      try {
        const PDFDocument = (await import('pdfkit')).default;
        const filters = parseTradeFilters(req);
        filters.limit = 10000;
        filters.offset = 0;
        const { trades, total } = await dbService.getFilteredTrades(filters);

        // ── Compute report stats ──────────────────────────
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
        const byStrategy = new Map<string, { wins: number; losses: number; pnl: number; trades: number }>();
        for (const t of closed) {
          const key = t.strategyType ?? 'Unknown';
          const entry = byStrategy.get(key) ?? { wins: 0, losses: 0, pnl: 0, trades: 0 };
          entry.trades++;
          entry.pnl += t.profitLoss;
          if (t.profitLoss > 0) entry.wins++; else entry.losses++;
          byStrategy.set(key, entry);
        }

        // Daily P&L breakdown
        const byDay = new Map<string, { pnl: number; trades: number; wins: number }>();
        for (const t of closed) {
          const day = (t.openedAt instanceof Date ? t.openedAt : new Date(t.openedAt)).toISOString().split('T')[0];
          const entry = byDay.get(day) ?? { pnl: 0, trades: 0, wins: 0 };
          entry.trades++;
          entry.pnl += t.profitLoss;
          if (t.profitLoss > 0) entry.wins++;
          byDay.set(day, entry);
        }

        // ── Build PDF ────────────────────────────────────
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
        const filename = `trade_report_${new Date().toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const pageW = doc.page.width - 80;
        const grey = '#666666';
        const green = '#22c55e';
        const red = '#ef4444';

        // Title
        doc.fontSize(20).fillColor('#111').text('ScalpX Trading Report', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor(grey).text(
          `Generated: ${new Date().toLocaleString()} | Period: ${filters.from?.split('T')[0] ?? 'All'} to ${filters.to?.split('T')[0] ?? 'Present'}`,
          { align: 'center' },
        );
        doc.moveDown(1);

        // ── Summary Card ──────────────────────────────────
        doc.fontSize(13).fillColor('#111').text('Performance Summary');
        doc.moveDown(0.3);

        const summaryRows: [string, string][] = [
          ['Total Trades', `${total} (${closed.length} closed, ${open.length} open)`],
          ['Win / Loss', `${wins.length}W / ${losses.length}L`],
          ['Win Rate', `${winRate.toFixed(1)}%`],
          ['Net P&L', `$${netPnL.toFixed(2)}`],
          ['Gross Profit', `$${grossProfit.toFixed(2)}`],
          ['Gross Loss', `$${grossLoss.toFixed(2)}`],
          ['Profit Factor', profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)],
          ['Avg Win', `$${avgWin.toFixed(2)}`],
          ['Avg Loss', `$${avgLoss.toFixed(2)}`],
          ['Best Trade', `$${bestTrade.toFixed(2)}`],
          ['Worst Trade', `$${worstTrade.toFixed(2)}`],
          ['Total Staked', `$${totalStaked.toFixed(2)}`],
          ['ROI', `${roi.toFixed(2)}%`],
        ];

        const colW = pageW / 2;
        for (let i = 0; i < summaryRows.length; i += 2) {
          const y = doc.y;
          const bg = i % 4 === 0 ? '#f9fafb' : '#ffffff';
          doc.rect(40, y - 2, pageW, 16).fill(bg);
          // Left column
          doc.fontSize(8).fillColor(grey).text(summaryRows[i][0], 45, y, { width: 100, lineBreak: false }); doc.y = y;
          const val1 = summaryRows[i][1];
          doc.fontSize(8).fillColor(val1.startsWith('-') ? red : '#111').text(val1, 150, y, { width: colW - 115, lineBreak: false }); doc.y = y;
          // Right column
          if (i + 1 < summaryRows.length) {
            doc.fontSize(8).fillColor(grey).text(summaryRows[i + 1][0], 40 + colW + 5, y, { width: 100, lineBreak: false }); doc.y = y;
            const val2 = summaryRows[i + 1][1];
            doc.fontSize(8).fillColor(val2.startsWith('-') ? red : '#111').text(val2, 40 + colW + 110, y, { width: colW - 115, lineBreak: false });
          }
          doc.y = y + 16;
        }
        doc.moveDown(1);

        // ── Strategy Breakdown ──────────────────────────────
        if (byStrategy.size > 0) {
          doc.fontSize(13).fillColor('#111').text('Strategy Breakdown');
          doc.moveDown(0.3);

          // Header
          const stratCols = [45, 180, 260, 320, 390, 460];
          const stratY = doc.y;
          doc.rect(40, stratY - 2, pageW, 14).fill('#f1f5f9');
          doc.fontSize(7).fillColor(grey);
          doc.text('Strategy', stratCols[0], stratY, { lineBreak: false }); doc.y = stratY;
          doc.text('Trades', stratCols[1], stratY, { lineBreak: false }); doc.y = stratY;
          doc.text('Wins', stratCols[2], stratY, { lineBreak: false }); doc.y = stratY;
          doc.text('Losses', stratCols[3], stratY, { lineBreak: false }); doc.y = stratY;
          doc.text('Win Rate', stratCols[4], stratY, { width: 50, align: 'right', lineBreak: false }); doc.y = stratY;
          doc.text('P&L', stratCols[4] + 55, stratY, { width: 50, align: 'right', lineBreak: false });
          doc.y = stratY + 14;

          for (const [name, stats] of [...byStrategy.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
            if (doc.y > doc.page.height - 60) { doc.addPage(); }
            const rowY = doc.y;
            doc.fontSize(7).fillColor('#111').text(name.replace(/_/g, ' '), stratCols[0], rowY, { width: 130, lineBreak: false }); doc.y = rowY;
            doc.text(String(stats.trades), stratCols[1], rowY, { lineBreak: false }); doc.y = rowY;
            doc.fillColor(green).text(String(stats.wins), stratCols[2], rowY, { lineBreak: false }); doc.y = rowY;
            doc.fillColor(red).text(String(stats.losses), stratCols[3], rowY, { lineBreak: false }); doc.y = rowY;
            const wr = stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) + '%' : '—';
            doc.fillColor('#111').text(wr, stratCols[4], rowY, { width: 50, align: 'right', lineBreak: false }); doc.y = rowY;
            doc.fillColor(stats.pnl >= 0 ? green : red).text(`$${stats.pnl.toFixed(2)}`, stratCols[4] + 55, rowY, { width: 50, align: 'right', lineBreak: false });
            doc.y = rowY + 12;
          }
          doc.moveDown(1);
        }

        // ── Daily P&L Breakdown ─────────────────────────────
        if (byDay.size > 0) {
          if (doc.y > doc.page.height - 120) doc.addPage();
          doc.fontSize(13).fillColor('#111').text('Daily P&L');
          doc.moveDown(0.3);

          const dayCols = [45, 160, 240, 320, 420];
          const dayHdrY = doc.y;
          doc.rect(40, dayHdrY - 2, pageW, 14).fill('#f1f5f9');
          doc.fontSize(7).fillColor(grey);
          doc.text('Date', dayCols[0], dayHdrY, { lineBreak: false }); doc.y = dayHdrY;
          doc.text('Trades', dayCols[1], dayHdrY, { lineBreak: false }); doc.y = dayHdrY;
          doc.text('Wins', dayCols[2], dayHdrY, { lineBreak: false }); doc.y = dayHdrY;
          doc.text('Win Rate', dayCols[3], dayHdrY, { width: 60, align: 'right', lineBreak: false }); doc.y = dayHdrY;
          doc.text('P&L', dayCols[3] + 65, dayHdrY, { width: 60, align: 'right', lineBreak: false });
          doc.y = dayHdrY + 14;

          for (const [day, stats] of [...byDay.entries()].sort().reverse()) {
            if (doc.y > doc.page.height - 50) doc.addPage();
            const y = doc.y;
            doc.fontSize(7).fillColor('#111').text(day, dayCols[0], y, { lineBreak: false }); doc.y = y;
            doc.text(String(stats.trades), dayCols[1], y, { lineBreak: false }); doc.y = y;
            doc.fillColor(green).text(String(stats.wins), dayCols[2], y, { lineBreak: false }); doc.y = y;
            const wr = stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) + '%' : '—';
            doc.fillColor('#111').text(wr, dayCols[3], y, { width: 60, align: 'right', lineBreak: false }); doc.y = y;
            doc.fillColor(stats.pnl >= 0 ? green : red).text(`$${stats.pnl.toFixed(2)}`, dayCols[3] + 65, y, { width: 60, align: 'right', lineBreak: false });
            doc.y = y + 12;
          }
          doc.moveDown(1);
        }

        // ── Trade Log Table ─────────────────────────────────
        if (doc.y > doc.page.height - 100) doc.addPage();
        doc.fontSize(13).fillColor('#111').text('Trade Log');
        doc.moveDown(0.3);

        const tc = [40, 110, 155, 190, 260, 310, 370, 425, 480];
        function drawTradeHeader() {
          const y = doc.y;
          doc.rect(40, y - 2, pageW, 13).fill('#f1f5f9');
          doc.fontSize(6).fillColor(grey);
          doc.text('Date', tc[0] + 2, y, { lineBreak: false }); doc.y = y;
          doc.text('Symbol', tc[1], y, { lineBreak: false }); doc.y = y;
          doc.text('Type', tc[2], y, { lineBreak: false }); doc.y = y;
          doc.text('Strategy', tc[3], y, { lineBreak: false }); doc.y = y;
          doc.text('Stake', tc[4], y, { width: 45, align: 'right', lineBreak: false }); doc.y = y;
          doc.text('Entry', tc[5], y, { width: 55, align: 'right', lineBreak: false }); doc.y = y;
          doc.text('Exit', tc[6], y, { width: 50, align: 'right', lineBreak: false }); doc.y = y;
          doc.text('P&L', tc[7], y, { width: 50, align: 'right', lineBreak: false }); doc.y = y;
          doc.text('Status', tc[8], y, { lineBreak: false });
          doc.y = y + 13;
        }
        drawTradeHeader();

        for (const t of trades) {
          if (doc.y > doc.page.height - 40) {
            doc.addPage();
            drawTradeHeader();
          }
          const y = doc.y;
          const opened = (t.openedAt instanceof Date ? t.openedAt : new Date(t.openedAt));
          const dateStr = `${opened.getMonth() + 1}/${opened.getDate()} ${opened.toTimeString().slice(0, 5)}`;
          doc.fontSize(6).fillColor('#333');
          doc.text(dateStr, tc[0] + 2, y, { width: 68, lineBreak: false }); doc.y = y;
          doc.text(t.symbol, tc[1], y, { width: 42, lineBreak: false }); doc.y = y;
          doc.text(t.type, tc[2], y, { width: 30, lineBreak: false }); doc.y = y;
          doc.text((t.strategyType ?? '').replace(/_/g, ' ').slice(0, 14), tc[3], y, { width: 48, lineBreak: false }); doc.y = y;
          doc.text(`$${t.quantity.toFixed(2)}`, tc[4], y, { width: 45, align: 'right', lineBreak: false }); doc.y = y;
          doc.text(t.entryPrice > 0 ? t.entryPrice.toFixed(2) : '—', tc[5], y, { width: 55, align: 'right', lineBreak: false }); doc.y = y;
          doc.text(t.exitPrice && t.exitPrice > 0 ? t.exitPrice.toFixed(2) : '—', tc[6], y, { width: 50, align: 'right', lineBreak: false }); doc.y = y;
          doc.fillColor(t.profitLoss >= 0 ? green : red);
          doc.text(t.status === 'CLOSED' ? `$${t.profitLoss.toFixed(2)}` : '—', tc[7], y, { width: 50, align: 'right', lineBreak: false }); doc.y = y;
          doc.fillColor(t.profitLoss > 0 ? green : t.status === 'OPEN' ? '#3b82f6' : red);
          doc.text(t.status === 'OPEN' ? 'OPEN' : t.profitLoss > 0 ? 'WIN' : 'LOSS', tc[8], y, { lineBreak: false });
          doc.y = y + 11;
        }

        // Footer on last page
        doc.moveDown(1);
        doc.fontSize(7).fillColor(grey).text('Report generated by ScalpX Trading Bot', { align: 'center' });

        doc.end();
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: (err as Error).message });
        }
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
        const validTimeframes = new Set<string>(['1m', '5m', '15m', '1h', '4h', '1d']);
        const tf = validTimeframes.has(String(req.query.timeframe ?? '1m'))
          ? (String(req.query.timeframe) as Timeframe)
          : ('1m' as Timeframe);
        const candles = this.cfg.marketData.getCandles(tf);
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
          await this.cfg.adapter.getAccountInfo();
          latency = Date.now() - t0;
        } catch {
          // broker unreachable
        }

        res.json({
          apiConnection: this.cfg.adapter.isConnected(),
          webSocket: this.cfg.adapter.isConnected(),
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

    // ── GET /api/instruments ──────────────────────────────────────────────────────
    this.app.get('/api/instruments', (_req: Request, res: Response) => {
      res.json(
        INSTRUMENTS.map((i) => ({
          symbol: i.symbol,
          label: i.label,
          category: i.category,
          pipSize: i.pipSize,
          minPositionSize: i.minPositionSize,
          isSynthetic: i.isSynthetic ?? false,
        })),
      );
    });

    // ── GET /api/grid ───────────────────────────────────────────────────────────────
    this.app.get('/api/grid', (_req: Request, res: Response) => {
      try {
        const strat = this.cfg.getStrategy();
        if (!hasLifecycle(strat) || !strat.isGridInitialized()) {
          res.json({ active: false });
          return;
        }
        const gridState = (strat as GridTradingStrategy).getState();
        const pendingCount = gridState.levels.filter((l) => l.status === 'PENDING').length;
        const filledCount = gridState.levels.filter((l) => l.status === 'FILLED').length;
        const cancelledCount = gridState.levels.filter((l) => l.status === 'CANCELLED').length;

        res.json({
          active: true,
          centerPrice: gridState.centerPrice,
          totalLevels: gridState.levels.length,
          pendingCount,
          filledCount,
          cancelledCount,
          levels: gridState.levels,
          config: strategyConfig.gridTrading,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/presets ──────────────────────────────────────────────────────────
    this.app.get('/api/presets', (_req: Request, res: Response) => {
      res.json(
        PRESETS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          riskLevel: p.riskLevel,
          timeframe: p.timeframe,
          strategyType: p.strategyType,
        })),
      );
    });

    // ── POST /api/presets/apply/:id ────────────────────────────────────────────────
    this.app.post('/api/presets/apply/:id', async (req: Request, res: Response) => {
      try {
        const preset = getPresetById(req.params.id);
        if (!preset) {
          res.status(404).json({ error: `Preset "${req.params.id}" not found` });
          return;
        }

        await this.applyConfigUpdate(preset.config);
        setActivePresetId(preset.id);

        logger.info(`Preset "${preset.name}" applied`, { component: 'ApiServer', presetId: preset.id });
        res.json({ success: true, presetId: preset.id });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ── GET /api/strategy ─────────────────────────────────────────────────────────
    this.app.get('/api/strategy', (_req: Request, res: Response) => {
      res.json({
        strategyType: strategyConfig.strategyType,
        broker: strategyConfig.broker,
        symbol: strategyConfig.symbol,

        // Core EMA/RSI
        emaFast: strategyConfig.emaFastPeriod,
        emaSlow: strategyConfig.emaSlowPeriod,
        rsiPeriod: strategyConfig.rsiPeriod,
        rsiOverbought: strategyConfig.rsiOverbought,
        rsiOversold: strategyConfig.rsiOversold,

        // Exit levels
        takeProfit: strategyConfig.takeProfitPips,
        stopLoss: strategyConfig.stopLossPips,
        trailingStop: strategyConfig.trailingStopEnabled,
        trailingStopPips: strategyConfig.trailingStopPips,

        // Advanced trailing & breakeven
        trailingActivationPips: strategyConfig.trailingActivationPips,
        useAtrTrailing: strategyConfig.useAtrTrailing,
        trailingAtrMultiplier: strategyConfig.trailingAtrMultiplier,
        breakevenEnabled: strategyConfig.breakevenEnabled,
        breakevenTriggerPips: strategyConfig.breakevenTriggerPips,

        // Trend confirmation
        emaTrendPeriod: strategyConfig.emaTrendPeriod,
        adxPeriod: strategyConfig.adxPeriod,
        adxThreshold: strategyConfig.adxThreshold,

        // ATR-based dynamic stops
        useAtrStops: strategyConfig.useAtrStops,
        atrPeriod: strategyConfig.atrPeriod,
        atrSlMultiplier: strategyConfig.atrSlMultiplier,
        atrTpMultiplier: strategyConfig.atrTpMultiplier,

        // Entry quality filters
        minBodyPips: strategyConfig.minBodyPips,
        spreadFilterPips: strategyConfig.spreadFilterPips,

        // Session filter
        sessionFilterEnabled: strategyConfig.sessionFilterEnabled,
        blockedHoursUtc: strategyConfig.blockedHoursUtc,

        // Risk management
        riskPerTrade: +(riskConfig.maxRiskPerTrade * 100).toFixed(2),
        maxPositions: riskConfig.maxOpenPositions,
        dailyLossLimit: +(riskConfig.maxDailyLoss * 100).toFixed(2),
        maxDrawdown: +(riskConfig.maxDrawdown * 100).toFixed(2),
        positionSizing: strategyConfig.positionSizing,

        // Schedule
        tradingDays: strategyConfig.tradingDays,
        tradingHoursStart: strategyConfig.tradingHoursStart,
        tradingHoursEnd: strategyConfig.tradingHoursEnd,
        timezone: strategyConfig.timezone,

        // Per-strategy configs
        gridTrading: strategyConfig.gridTrading,
        aggressive: strategyConfig.aggressive,
        londonBreakout: strategyConfig.londonBreakout,
        meanReversion: strategyConfig.meanReversion,
        newsEvent: strategyConfig.newsEvent,
        hybrid: strategyConfig.hybrid,
        coinFlip: strategyConfig.coinFlip,
        riseFall: strategyConfig.riseFall,
        evenOdd: strategyConfig.evenOdd,
        digitOverUnder: strategyConfig.digitOverUnder,
        martingale: strategyConfig.martingale,
        accumulatorLadder: strategyConfig.accumulatorLadder,
        momentumRiseFall: strategyConfig.momentumRiseFall,
        digitSniper: strategyConfig.digitSniper,
        volatilityBreakout: strategyConfig.volatilityBreakout,
        hedgedAccumulator: strategyConfig.hedgedAccumulator,
        allInRecovery: strategyConfig.allInRecovery,

        activePreset: getActivePresetId(),
      });
    });

    // ── PUT /api/strategy ─────────────────────────────────────────────────────────
    this.app.put('/api/strategy', async (req: Request, res: Response) => {
      try {
        await this.applyConfigUpdate(req.body as Record<string, unknown>);

        // Manual config edit clears active preset
        setActivePresetId(null);

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

  // ─── Config Apply (shared by PUT /api/strategy and POST /api/presets/apply) ──

  private async applyConfigUpdate(b: Record<string, unknown>): Promise<void> {
    const { botState } = this.cfg;

    // Capture broker change intent before applying any config updates
    const brokerChanged = b.broker != null && String(b.broker) !== strategyConfig.broker;

    // Symbol change — stop market data, swap symbol + instrument params, restart
    if (b.symbol != null && String(b.symbol) !== strategyConfig.symbol) {
      const newSymbol = String(b.symbol);
      const wasRunning = botState.isRunning;

      if (wasRunning) await this.cfg.onStop();

      strategyConfig.symbol = newSymbol;

      // Update instrument-derived risk params for the new market
      const instrument = getInstrumentConfig(newSymbol);
      riskConfig.minPositionSize = instrument.minPositionSize;

      logger.info('Symbol changed — instrument params updated', {
        component: 'ApiServer',
        symbol: newSymbol,
        pipSize: instrument.pipSize,
        minPositionSize: instrument.minPositionSize,
      });

      if (wasRunning) await this.cfg.onStart();
    }

    // Core EMA/RSI
    if (b.emaFast != null) strategyConfig.emaFastPeriod = Number(b.emaFast);
    if (b.emaSlow != null) strategyConfig.emaSlowPeriod = Number(b.emaSlow);
    if (b.rsiPeriod != null) strategyConfig.rsiPeriod = Number(b.rsiPeriod);
    if (b.rsiOverbought != null) strategyConfig.rsiOverbought = Number(b.rsiOverbought);
    if (b.rsiOversold != null) strategyConfig.rsiOversold = Number(b.rsiOversold);

    // Exit levels
    if (b.takeProfit != null) strategyConfig.takeProfitPips = Number(b.takeProfit);
    if (b.stopLoss != null) strategyConfig.stopLossPips = Number(b.stopLoss);
    if (b.trailingStop != null) strategyConfig.trailingStopEnabled = Boolean(b.trailingStop);
    if (b.trailingStopPips != null) strategyConfig.trailingStopPips = Number(b.trailingStopPips);

    // Advanced trailing & breakeven
    if (b.trailingActivationPips != null) strategyConfig.trailingActivationPips = Number(b.trailingActivationPips);
    if (b.useAtrTrailing != null) strategyConfig.useAtrTrailing = Boolean(b.useAtrTrailing);
    if (b.trailingAtrMultiplier != null) strategyConfig.trailingAtrMultiplier = Number(b.trailingAtrMultiplier);
    if (b.breakevenEnabled != null) strategyConfig.breakevenEnabled = Boolean(b.breakevenEnabled);
    if (b.breakevenTriggerPips != null) strategyConfig.breakevenTriggerPips = Number(b.breakevenTriggerPips);

    // Trend confirmation
    if (b.emaTrendPeriod != null) strategyConfig.emaTrendPeriod = Number(b.emaTrendPeriod);
    if (b.adxPeriod != null) strategyConfig.adxPeriod = Number(b.adxPeriod);
    if (b.adxThreshold != null) strategyConfig.adxThreshold = Number(b.adxThreshold);

    // ATR-based dynamic stops
    if (b.useAtrStops != null) strategyConfig.useAtrStops = Boolean(b.useAtrStops);
    if (b.atrPeriod != null) strategyConfig.atrPeriod = Number(b.atrPeriod);
    if (b.atrSlMultiplier != null) strategyConfig.atrSlMultiplier = Number(b.atrSlMultiplier);
    if (b.atrTpMultiplier != null) strategyConfig.atrTpMultiplier = Number(b.atrTpMultiplier);

    // Entry quality filters
    if (b.minBodyPips != null) strategyConfig.minBodyPips = Number(b.minBodyPips);
    if (b.spreadFilterPips != null) strategyConfig.spreadFilterPips = Number(b.spreadFilterPips);

    // Session filter
    if (b.sessionFilterEnabled != null) strategyConfig.sessionFilterEnabled = Boolean(b.sessionFilterEnabled);
    if (Array.isArray(b.blockedHoursUtc)) strategyConfig.blockedHoursUtc = b.blockedHoursUtc as string[];

    // Schedule
    if (b.positionSizing != null)
      strategyConfig.positionSizing = b.positionSizing as typeof strategyConfig.positionSizing;
    if (Array.isArray(b.tradingDays)) strategyConfig.tradingDays = b.tradingDays as string[];
    if (b.tradingHoursStart != null) strategyConfig.tradingHoursStart = String(b.tradingHoursStart);
    if (b.tradingHoursEnd != null) strategyConfig.tradingHoursEnd = String(b.tradingHoursEnd);
    if (b.timezone != null) strategyConfig.timezone = String(b.timezone);

    // Strategy type change
    if (b.strategyType != null) {
      strategyConfig.strategyType = String(b.strategyType) as typeof strategyConfig.strategyType;
    }
    if (b.broker != null) {
      strategyConfig.broker = String(b.broker) as typeof strategyConfig.broker;
    }

    // Grid trading config updates
    if (b.gridTrading != null && typeof b.gridTrading === 'object') {
      const g = b.gridTrading as Record<string, unknown>;
      if (g.gridLevels != null) strategyConfig.gridTrading.gridLevels = Number(g.gridLevels);
      if (g.gridSpacing != null) strategyConfig.gridTrading.gridSpacing = Number(g.gridSpacing);
      if (g.lotSizePerLevel != null) strategyConfig.gridTrading.lotSizePerLevel = Number(g.lotSizePerLevel);
      if (g.takeProfitPerLevel != null) strategyConfig.gridTrading.takeProfitPerLevel = Number(g.takeProfitPerLevel);
      if (g.maxGridDrawdown != null) strategyConfig.gridTrading.maxGridDrawdown = Number(g.maxGridDrawdown);
      if (g.trendDetectionEnabled != null) strategyConfig.gridTrading.trendDetectionEnabled = Boolean(g.trendDetectionEnabled);
      if (g.trendAdxThreshold != null) strategyConfig.gridTrading.trendAdxThreshold = Number(g.trendAdxThreshold);
    }

    // Aggressive scalping config updates
    if (b.aggressive != null && typeof b.aggressive === 'object') {
      const a = b.aggressive as Record<string, unknown>;
      if (a.emaFast != null) strategyConfig.aggressive.emaFast = Number(a.emaFast);
      if (a.emaSlow != null) strategyConfig.aggressive.emaSlow = Number(a.emaSlow);
      if (a.rsiOverbought != null) strategyConfig.aggressive.rsiOverbought = Number(a.rsiOverbought);
      if (a.rsiOversold != null) strategyConfig.aggressive.rsiOversold = Number(a.rsiOversold);
      if (a.adxThreshold != null) strategyConfig.aggressive.adxThreshold = Number(a.adxThreshold);
      if (a.useTrendFilter != null) strategyConfig.aggressive.useTrendFilter = Boolean(a.useTrendFilter);
      if (a.breakevenAfterPips != null) strategyConfig.aggressive.breakevenAfterPips = Number(a.breakevenAfterPips);
      if (a.trailingActivationPips != null) strategyConfig.aggressive.trailingActivationPips = Number(a.trailingActivationPips);
    }

    // London Breakout config updates
    if (b.londonBreakout != null && typeof b.londonBreakout === 'object') {
      const lb = b.londonBreakout as Record<string, unknown>;
      if (lb.asianRangeStartHour != null) strategyConfig.londonBreakout.asianRangeStartHour = Number(lb.asianRangeStartHour);
      if (lb.asianRangeEndHour != null) strategyConfig.londonBreakout.asianRangeEndHour = Number(lb.asianRangeEndHour);
      if (lb.breakoutWindowEndHour != null) strategyConfig.londonBreakout.breakoutWindowEndHour = Number(lb.breakoutWindowEndHour);
      if (lb.minRangePips != null) strategyConfig.londonBreakout.minRangePips = Number(lb.minRangePips);
      if (lb.maxRangePips != null) strategyConfig.londonBreakout.maxRangePips = Number(lb.maxRangePips);
      if (lb.slRangeMultiplier != null) strategyConfig.londonBreakout.slRangeMultiplier = Number(lb.slRangeMultiplier);
      if (lb.tpRangeMultiplier != null) strategyConfig.londonBreakout.tpRangeMultiplier = Number(lb.tpRangeMultiplier);
    }

    // Mean Reversion config updates
    if (b.meanReversion != null && typeof b.meanReversion === 'object') {
      const mr = b.meanReversion as Record<string, unknown>;
      if (mr.bollingerPeriod != null) strategyConfig.meanReversion.bollingerPeriod = Number(mr.bollingerPeriod);
      if (mr.bollingerStdDev != null) strategyConfig.meanReversion.bollingerStdDev = Number(mr.bollingerStdDev);
      if (mr.rsiOversold != null) strategyConfig.meanReversion.rsiOversold = Number(mr.rsiOversold);
      if (mr.rsiOverbought != null) strategyConfig.meanReversion.rsiOverbought = Number(mr.rsiOverbought);
      if (mr.atrSlMultiplier != null) strategyConfig.meanReversion.atrSlMultiplier = Number(mr.atrSlMultiplier);
      if (mr.atrTpMultiplier != null) strategyConfig.meanReversion.atrTpMultiplier = Number(mr.atrTpMultiplier);
    }

    // News Event config updates
    if (b.newsEvent != null && typeof b.newsEvent === 'object') {
      const ne = b.newsEvent as Record<string, unknown>;
      if (ne.blackoutMinutesBefore != null) strategyConfig.newsEvent.blackoutMinutesBefore = Number(ne.blackoutMinutesBefore);
      if (ne.entryWindowMinutesAfter != null) strategyConfig.newsEvent.entryWindowMinutesAfter = Number(ne.entryWindowMinutesAfter);
      if (ne.minImpulseBodyPips != null) strategyConfig.newsEvent.minImpulseBodyPips = Number(ne.minImpulseBodyPips);
      if (ne.atrSlMultiplier != null) strategyConfig.newsEvent.atrSlMultiplier = Number(ne.atrSlMultiplier);
      if (ne.atrTpMultiplier != null) strategyConfig.newsEvent.atrTpMultiplier = Number(ne.atrTpMultiplier);
      if (Array.isArray(ne.scheduledEvents)) strategyConfig.newsEvent.scheduledEvents = ne.scheduledEvents as string[];
    }

    // Hybrid config updates
    if (b.hybrid != null && typeof b.hybrid === 'object') {
      const h = b.hybrid as Record<string, unknown>;
      if (h.londonEndHour != null) strategyConfig.hybrid.londonEndHour = Number(h.londonEndHour);
      if (h.scalpingEndHour != null) strategyConfig.hybrid.scalpingEndHour = Number(h.scalpingEndHour);
    }

    // Coin Flip (Accumulator) config updates
    if (b.coinFlip != null && typeof b.coinFlip === 'object') {
      const cf = b.coinFlip as Record<string, unknown>;
      if (cf.growthRate != null) strategyConfig.coinFlip.growthRate = Number(cf.growthRate);
      if (cf.stake != null) strategyConfig.coinFlip.stake = Number(cf.stake);
      if (cf.takeProfitUSD != null) strategyConfig.coinFlip.takeProfitUSD = Number(cf.takeProfitUSD);
      if (cf.maxContracts != null) strategyConfig.coinFlip.maxContracts = Number(cf.maxContracts);
      if (cf.cooldownSeconds != null) strategyConfig.coinFlip.cooldownSeconds = Number(cf.cooldownSeconds);
      if (cf.minBalance != null) strategyConfig.coinFlip.minBalance = Number(cf.minBalance);
    }

    // Rise/Fall config updates
    if (b.riseFall != null && typeof b.riseFall === 'object') {
      const rf = b.riseFall as Record<string, unknown>;
      if (rf.stake != null) strategyConfig.riseFall.stake = Number(rf.stake);
      if (rf.durationTicks != null) strategyConfig.riseFall.durationTicks = Number(rf.durationTicks);
      if (rf.direction != null) strategyConfig.riseFall.direction = String(rf.direction) as 'rise' | 'fall' | 'auto';
      if (rf.maxContracts != null) strategyConfig.riseFall.maxContracts = Number(rf.maxContracts);
      if (rf.cooldownSeconds != null) strategyConfig.riseFall.cooldownSeconds = Number(rf.cooldownSeconds);
      if (rf.minBalance != null) strategyConfig.riseFall.minBalance = Number(rf.minBalance);
      if (rf.useTickIndicators != null) strategyConfig.riseFall.useTickIndicators = Boolean(rf.useTickIndicators);
      if (rf.tickEmaFast != null) strategyConfig.riseFall.tickEmaFast = Number(rf.tickEmaFast);
      if (rf.tickEmaSlow != null) strategyConfig.riseFall.tickEmaSlow = Number(rf.tickEmaSlow);
      if (rf.tickRsiPeriod != null) strategyConfig.riseFall.tickRsiPeriod = Number(rf.tickRsiPeriod);
      if (rf.tickRsiMinStrength != null) strategyConfig.riseFall.tickRsiMinStrength = Number(rf.tickRsiMinStrength);
    }

    // Even/Odd config updates
    if (b.evenOdd != null && typeof b.evenOdd === 'object') {
      const eo = b.evenOdd as Record<string, unknown>;
      if (eo.stake != null) strategyConfig.evenOdd.stake = Number(eo.stake);
      if (eo.durationTicks != null) strategyConfig.evenOdd.durationTicks = Number(eo.durationTicks);
      if (eo.prediction != null) strategyConfig.evenOdd.prediction = String(eo.prediction) as 'even' | 'odd' | 'auto';
      if (eo.maxContracts != null) strategyConfig.evenOdd.maxContracts = Number(eo.maxContracts);
      if (eo.cooldownSeconds != null) strategyConfig.evenOdd.cooldownSeconds = Number(eo.cooldownSeconds);
      if (eo.minBalance != null) strategyConfig.evenOdd.minBalance = Number(eo.minBalance);
    }

    // Digit Over/Under config updates
    if (b.digitOverUnder != null && typeof b.digitOverUnder === 'object') {
      const du = b.digitOverUnder as Record<string, unknown>;
      if (du.stake != null) strategyConfig.digitOverUnder.stake = Number(du.stake);
      if (du.durationTicks != null) strategyConfig.digitOverUnder.durationTicks = Number(du.durationTicks);
      if (du.direction != null) strategyConfig.digitOverUnder.direction = String(du.direction) as 'over' | 'under';
      if (du.barrier != null) strategyConfig.digitOverUnder.barrier = Number(du.barrier);
      if (du.maxContracts != null) strategyConfig.digitOverUnder.maxContracts = Number(du.maxContracts);
      if (du.cooldownSeconds != null) strategyConfig.digitOverUnder.cooldownSeconds = Number(du.cooldownSeconds);
      if (du.minBalance != null) strategyConfig.digitOverUnder.minBalance = Number(du.minBalance);
    }

    // Martingale config updates
    if (b.martingale != null && typeof b.martingale === 'object') {
      const m = b.martingale as Record<string, unknown>;
      if (m.baseStake != null) strategyConfig.martingale.baseStake = Number(m.baseStake);
      if (m.multiplier != null) strategyConfig.martingale.multiplier = Number(m.multiplier);
      if (m.maxConsecutiveLosses != null) strategyConfig.martingale.maxConsecutiveLosses = Number(m.maxConsecutiveLosses);
      if (m.contractType != null) strategyConfig.martingale.contractType = String(m.contractType) as 'rise_fall' | 'even_odd';
      if (m.durationTicks != null) strategyConfig.martingale.durationTicks = Number(m.durationTicks);
      if (m.directionMode != null) strategyConfig.martingale.directionMode = String(m.directionMode) as 'auto' | 'signal';
      if (m.cooldownSeconds != null) strategyConfig.martingale.cooldownSeconds = Number(m.cooldownSeconds);
      if (m.minBalance != null) strategyConfig.martingale.minBalance = Number(m.minBalance);
      if (m.maxSessionLoss != null) strategyConfig.martingale.maxSessionLoss = Number(m.maxSessionLoss);
      if (m.signalEmaFast != null) strategyConfig.martingale.signalEmaFast = Number(m.signalEmaFast);
      if (m.signalEmaSlow != null) strategyConfig.martingale.signalEmaSlow = Number(m.signalEmaSlow);
    }

    // Accumulator Ladder config updates
    if (b.accumulatorLadder != null && typeof b.accumulatorLadder === 'object') {
      const al = b.accumulatorLadder as Record<string, unknown>;
      if (al.growthRate != null) strategyConfig.accumulatorLadder.growthRate = Number(al.growthRate);
      if (al.stake != null) strategyConfig.accumulatorLadder.stake = Number(al.stake);
      if (al.maxDurationSeconds != null) strategyConfig.accumulatorLadder.maxDurationSeconds = Number(al.maxDurationSeconds);
      if (al.targetProfitPercent != null) strategyConfig.accumulatorLadder.targetProfitPercent = Number(al.targetProfitPercent);
      if (al.maxContracts != null) strategyConfig.accumulatorLadder.maxContracts = Number(al.maxContracts);
      if (al.cooldownSeconds != null) strategyConfig.accumulatorLadder.cooldownSeconds = Number(al.cooldownSeconds);
      if (al.minBalance != null) strategyConfig.accumulatorLadder.minBalance = Number(al.minBalance);
    }

    // Momentum Rise/Fall config updates
    if (b.momentumRiseFall != null && typeof b.momentumRiseFall === 'object') {
      const mrf = b.momentumRiseFall as Record<string, unknown>;
      if (mrf.stake != null) strategyConfig.momentumRiseFall.stake = Number(mrf.stake);
      if (mrf.durationTicks != null) strategyConfig.momentumRiseFall.durationTicks = Number(mrf.durationTicks);
      if (mrf.emaFast != null) strategyConfig.momentumRiseFall.emaFast = Number(mrf.emaFast);
      if (mrf.emaSlow != null) strategyConfig.momentumRiseFall.emaSlow = Number(mrf.emaSlow);
      if (mrf.maxBurstContracts != null) strategyConfig.momentumRiseFall.maxBurstContracts = Number(mrf.maxBurstContracts);
      if (mrf.burstIntervalSeconds != null) strategyConfig.momentumRiseFall.burstIntervalSeconds = Number(mrf.burstIntervalSeconds);
      if (mrf.cooldownSeconds != null) strategyConfig.momentumRiseFall.cooldownSeconds = Number(mrf.cooldownSeconds);
      if (mrf.minBalance != null) strategyConfig.momentumRiseFall.minBalance = Number(mrf.minBalance);
      if (mrf.stopOnSignalFlip != null) strategyConfig.momentumRiseFall.stopOnSignalFlip = Boolean(mrf.stopOnSignalFlip);
    }

    // Digit Sniper config updates
    if (b.digitSniper != null && typeof b.digitSniper === 'object') {
      const ds = b.digitSniper as Record<string, unknown>;
      if (ds.stakePerDigit != null) strategyConfig.digitSniper.stakePerDigit = Number(ds.stakePerDigit);
      if (ds.durationTicks != null) strategyConfig.digitSniper.durationTicks = Number(ds.durationTicks);
      if (Array.isArray(ds.targetDigits)) strategyConfig.digitSniper.targetDigits = (ds.targetDigits as number[]).map(Number);
      if (ds.maxConcurrentRounds != null) strategyConfig.digitSniper.maxConcurrentRounds = Number(ds.maxConcurrentRounds);
      if (ds.cooldownSeconds != null) strategyConfig.digitSniper.cooldownSeconds = Number(ds.cooldownSeconds);
      if (ds.minBalance != null) strategyConfig.digitSniper.minBalance = Number(ds.minBalance);
      logger.info('Digit Sniper config updated', {
        component: 'ApiServer',
        stakePerDigit: strategyConfig.digitSniper.stakePerDigit,
        targetDigits: strategyConfig.digitSniper.targetDigits,
      });
    }

    // Volatility Breakout config updates
    if (b.volatilityBreakout != null && typeof b.volatilityBreakout === 'object') {
      const vb = b.volatilityBreakout as Record<string, unknown>;
      if (vb.stake != null) strategyConfig.volatilityBreakout.stake = Number(vb.stake);
      if (vb.targetIndex != null) strategyConfig.volatilityBreakout.targetIndex = String(vb.targetIndex) as 'BOOM500' | 'BOOM1000' | 'CRASH500' | 'CRASH1000';
      if (vb.consecutiveTickThreshold != null) strategyConfig.volatilityBreakout.consecutiveTickThreshold = Number(vb.consecutiveTickThreshold);
      if (vb.turboDurationMinutes != null) strategyConfig.volatilityBreakout.turboDurationMinutes = Number(vb.turboDurationMinutes);
      if (vb.maxContracts != null) strategyConfig.volatilityBreakout.maxContracts = Number(vb.maxContracts);
      if (vb.cooldownSeconds != null) strategyConfig.volatilityBreakout.cooldownSeconds = Number(vb.cooldownSeconds);
      if (vb.minBalance != null) strategyConfig.volatilityBreakout.minBalance = Number(vb.minBalance);
    }

    // Hedged Accumulator config updates
    if (b.hedgedAccumulator != null && typeof b.hedgedAccumulator === 'object') {
      const ha = b.hedgedAccumulator as Record<string, unknown>;
      if (ha.growthRate != null) strategyConfig.hedgedAccumulator.growthRate = Number(ha.growthRate);
      if (ha.stakePerSide != null) strategyConfig.hedgedAccumulator.stakePerSide = Number(ha.stakePerSide);
      if (ha.takeProfitUSD != null) strategyConfig.hedgedAccumulator.takeProfitUSD = Number(ha.takeProfitUSD);
      if (ha.maxPairs != null) strategyConfig.hedgedAccumulator.maxPairs = Number(ha.maxPairs);
      if (ha.cooldownSeconds != null) strategyConfig.hedgedAccumulator.cooldownSeconds = Number(ha.cooldownSeconds);
      if (ha.minBalance != null) strategyConfig.hedgedAccumulator.minBalance = Number(ha.minBalance);
    }

    // All-In Recovery config updates
    if (b.allInRecovery != null && typeof b.allInRecovery === 'object') {
      const air = b.allInRecovery as Record<string, unknown>;
      if (air.triggerBalance != null) strategyConfig.allInRecovery.triggerBalance = Number(air.triggerBalance);
      if (air.recoveryStake != null) strategyConfig.allInRecovery.recoveryStake = Number(air.recoveryStake);
      if (air.recoveryGrowthRate != null) strategyConfig.allInRecovery.recoveryGrowthRate = Number(air.recoveryGrowthRate);
      if (air.recoveryTakeProfitUSD != null) strategyConfig.allInRecovery.recoveryTakeProfitUSD = Number(air.recoveryTakeProfitUSD);
      if (air.recoveryContractType != null) strategyConfig.allInRecovery.recoveryContractType = String(air.recoveryContractType) as 'accumulator' | 'rise_fall' | 'even_odd';
      if (air.maxRecoveryAttempts != null) strategyConfig.allInRecovery.maxRecoveryAttempts = Number(air.maxRecoveryAttempts);
      if (air.cooldownSeconds != null) strategyConfig.allInRecovery.cooldownSeconds = Number(air.cooldownSeconds);
      if (air.hardStopBalance != null) strategyConfig.allInRecovery.hardStopBalance = Number(air.hardStopBalance);
    }

    // Risk config updates (frontend sends them as %)
    if (b.riskPerTrade != null) riskConfig.maxRiskPerTrade = Number(b.riskPerTrade) / 100;
    if (b.maxPositions != null) riskConfig.maxOpenPositions = Number(b.maxPositions);
    if (b.dailyLossLimit != null) riskConfig.maxDailyLoss = Number(b.dailyLossLimit) / 100;
    if (b.maxDrawdown != null) riskConfig.maxDrawdown = Number(b.maxDrawdown) / 100;

    // Broker switch — full reconnect cycle (disconnect old → create new → connect → rebuild)
    if (brokerChanged) {
      await this.cfg.onBrokerSwitch();
      logger.info('Broker switched via API', {
        component: 'ApiServer',
        broker: strategyConfig.broker,
      });
    }

    // Re-instantiate strategy so new EMA/RSI periods take effect immediately
    this.cfg.onStrategyUpdate();
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
