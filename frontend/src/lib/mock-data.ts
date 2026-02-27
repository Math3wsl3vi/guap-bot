import { Trade, Account, BotStatus, Metrics, LogEntry, SystemHealth, CandleData, EquityPoint, PnLBar, StrategyConfig } from '@/types';

export const mockAccount: Account = {
  balance: 52847.32,
  equity: 53102.18,
  margin: 2450.00,
  freeMargin: 50652.18,
  marginLevel: 2167.44,
  todayPnL: 847.32,
  todayPnLPercent: 1.63,
};

export const mockBotStatus: BotStatus = {
  isRunning: true,
  isPaused: false,
  lastStarted: '2026-02-25T08:00:00Z',
  uptime: 28800,
  totalTradesToday: 14,
};

export const mockActiveTrades: Trade[] = [
  { id: '1', symbol: 'EUR/USD', type: 'BUY', entryPrice: 1.0842, currentPrice: 1.0856, stopLoss: 1.0832, takeProfit: 1.0862, quantity: 1.5, profitLoss: 210.00, profitLossPercent: 0.13, status: 'OPEN', openedAt: '2026-02-25T14:32:00Z' },
  { id: '2', symbol: 'GBP/USD', type: 'SELL', entryPrice: 1.2654, currentPrice: 1.2641, stopLoss: 1.2674, takeProfit: 1.2624, quantity: 1.0, profitLoss: 130.00, profitLossPercent: 0.10, status: 'OPEN', openedAt: '2026-02-25T14:45:00Z' },
  { id: '3', symbol: 'USD/JPY', type: 'BUY', entryPrice: 149.850, currentPrice: 149.780, stopLoss: 149.750, takeProfit: 149.950, quantity: 2.0, profitLoss: -93.33, profitLossPercent: -0.05, status: 'OPEN', openedAt: '2026-02-25T15:01:00Z' },
];

export const mockRecentTrades: Trade[] = [
  { id: '10', symbol: 'EUR/USD', type: 'BUY', entryPrice: 1.0831, exitPrice: 1.0848, stopLoss: 1.0821, takeProfit: 1.0851, quantity: 1.0, profitLoss: 170.00, profitLossPercent: 0.16, status: 'CLOSED', openedAt: '2026-02-25T13:15:00Z', closedAt: '2026-02-25T13:22:00Z', duration: 420 },
  { id: '11', symbol: 'GBP/USD', type: 'SELL', entryPrice: 1.2671, exitPrice: 1.2683, stopLoss: 1.2691, takeProfit: 1.2641, quantity: 1.0, profitLoss: -120.00, profitLossPercent: -0.09, status: 'CLOSED', openedAt: '2026-02-25T12:40:00Z', closedAt: '2026-02-25T12:55:00Z', duration: 900 },
  { id: '12', symbol: 'EUR/USD', type: 'SELL', entryPrice: 1.0855, exitPrice: 1.0839, stopLoss: 1.0865, takeProfit: 1.0835, quantity: 2.0, profitLoss: 320.00, profitLossPercent: 0.15, status: 'CLOSED', openedAt: '2026-02-25T11:50:00Z', closedAt: '2026-02-25T12:03:00Z', duration: 780 },
  { id: '13', symbol: 'USD/JPY', type: 'BUY', entryPrice: 149.920, exitPrice: 149.960, stopLoss: 149.870, takeProfit: 149.970, quantity: 1.5, profitLoss: 40.13, profitLossPercent: 0.03, status: 'CLOSED', openedAt: '2026-02-25T11:10:00Z', closedAt: '2026-02-25T11:18:00Z', duration: 480 },
  { id: '14', symbol: 'EUR/USD', type: 'BUY', entryPrice: 1.0818, exitPrice: 1.0811, stopLoss: 1.0808, takeProfit: 1.0838, quantity: 1.0, profitLoss: -70.00, profitLossPercent: -0.06, status: 'CLOSED', openedAt: '2026-02-25T10:30:00Z', closedAt: '2026-02-25T10:38:00Z', duration: 480 },
  { id: '15', symbol: 'GBP/USD', type: 'BUY', entryPrice: 1.2628, exitPrice: 1.2649, stopLoss: 1.2618, takeProfit: 1.2648, quantity: 1.0, profitLoss: 210.00, profitLossPercent: 0.17, status: 'CLOSED', openedAt: '2026-02-25T09:45:00Z', closedAt: '2026-02-25T09:58:00Z', duration: 780 },
  { id: '16', symbol: 'USD/JPY', type: 'SELL', entryPrice: 150.050, exitPrice: 150.010, stopLoss: 150.100, takeProfit: 149.990, quantity: 2.0, profitLoss: 53.33, profitLossPercent: 0.03, status: 'CLOSED', openedAt: '2026-02-25T09:10:00Z', closedAt: '2026-02-25T09:20:00Z', duration: 600 },
  { id: '17', symbol: 'EUR/USD', type: 'SELL', entryPrice: 1.0802, exitPrice: 1.0790, stopLoss: 1.0812, takeProfit: 1.0782, quantity: 1.5, profitLoss: 180.00, profitLossPercent: 0.11, status: 'CLOSED', openedAt: '2026-02-25T08:30:00Z', closedAt: '2026-02-25T08:42:00Z', duration: 720 },
];

export const mockMetrics: Metrics = {
  totalTrades: 187,
  winningTrades: 121,
  losingTrades: 66,
  winRate: 64.7,
  profitFactor: 2.14,
  averageWin: 185.40,
  averageLoss: -98.20,
  maxDrawdown: 4.2,
  sharpeRatio: 1.87,
  totalProfit: 15892.40,
  bestTrade: 520.00,
  worstTrade: -310.00,
};

export const mockSystemHealth: SystemHealth = {
  apiConnection: true,
  webSocket: true,
  database: true,
  redis: true,
  latency: 12,
  uptime: 604800,
  cpuUsage: 23,
  memoryUsage: 41,
};

const basePrice = 1.0845;
export function generateCandles(count: number): CandleData[] {
  const candles: CandleData[] = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = count; i > 0; i--) {
    const change = (Math.random() - 0.48) * 0.0008;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 0.0004;
    const low = Math.min(open, close) - Math.random() * 0.0004;
    price = close;
    candles.push({
      time: new Date(now - i * 60000).toISOString(),
      open: +open.toFixed(5),
      high: +high.toFixed(5),
      low: +low.toFixed(5),
      close: +close.toFixed(5),
      volume: Math.floor(Math.random() * 500 + 100),
    });
  }
  return candles;
}

export function generateEquityCurve(): EquityPoint[] {
  const points: EquityPoint[] = [];
  let equity = 40000;
  for (let i = 30; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    equity += (Math.random() - 0.35) * 600;
    points.push({ date: d.toISOString().split('T')[0], equity: +equity.toFixed(2) });
  }
  return points;
}

export function generatePnLBars(): PnLBar[] {
  const bars: PnLBar[] = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    bars.push({ date: d.toISOString().split('T')[0], pnl: +((Math.random() - 0.35) * 800).toFixed(2) });
  }
  return bars;
}

export const mockLogs: LogEntry[] = [
  { id: 'l1', timestamp: '2026-02-25T15:01:02Z', level: 'INFO', component: 'Strategy', message: 'BUY signal detected on USD/JPY — EMA(9) crossed above EMA(21), RSI at 38.2' },
  { id: 'l2', timestamp: '2026-02-25T15:01:01Z', level: 'INFO', component: 'Orders', message: 'Order filled: BUY 2.0 lots USD/JPY @ 149.850' },
  { id: 'l3', timestamp: '2026-02-25T14:58:30Z', level: 'DEBUG', component: 'MarketData', message: 'Candle close EUR/USD: O=1.0841 H=1.0858 L=1.0839 C=1.0856' },
  { id: 'l4', timestamp: '2026-02-25T14:55:12Z', level: 'WARN', component: 'Risk', message: 'Approaching daily loss limit (2.1% of 3.0% max)' },
  { id: 'l5', timestamp: '2026-02-25T14:50:00Z', level: 'INFO', component: 'Strategy', message: 'SELL signal detected on GBP/USD — EMA(9) crossed below EMA(21)' },
  { id: 'l6', timestamp: '2026-02-25T14:45:01Z', level: 'INFO', component: 'Orders', message: 'Order filled: SELL 1.0 lots GBP/USD @ 1.2654' },
  { id: 'l7', timestamp: '2026-02-25T14:40:00Z', level: 'DEBUG', component: 'MarketData', message: 'WebSocket reconnected successfully after 200ms' },
  { id: 'l8', timestamp: '2026-02-25T14:35:15Z', level: 'ERROR', component: 'Orders', message: 'Order rejected: Insufficient margin for 3.0 lots EUR/USD' },
  { id: 'l9', timestamp: '2026-02-25T14:32:01Z', level: 'INFO', component: 'Orders', message: 'Order filled: BUY 1.5 lots EUR/USD @ 1.0842' },
  { id: 'l10', timestamp: '2026-02-25T14:30:00Z', level: 'INFO', component: 'Strategy', message: 'BUY signal detected on EUR/USD — RSI oversold bounce at 28.4' },
];

export const defaultStrategyConfig: StrategyConfig = {
  symbol: 'XAU_USD',
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  takeProfit: 8,
  stopLoss: 5,
  trailingStop: false,
  trailingStopPips: 3,
  riskPerTrade: 0.5,
  maxPositions: 1,
  dailyLossLimit: 2,
  maxDrawdown: 10,
  positionSizing: 'percentage',
  tradingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  tradingHoursStart: '08:00',
  tradingHoursEnd: '16:00',
  timezone: 'UTC',
};
