export interface Trade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  currentPrice?: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  profitLoss: number;
  profitLossPercent: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  duration?: number;
}

export interface Account {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  todayPnL: number;
  todayPnLPercent: number;
}

export interface BotStatus {
  isRunning: boolean;
  isPaused: boolean;
  lastStarted?: string;
  uptime: number;
  totalTradesToday: number;
}

export interface Metrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalProfit: number;
  bestTrade: number;
  worstTrade: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  component: string;
  message: string;
}

export interface SystemHealth {
  apiConnection: boolean;
  webSocket: boolean;
  database: boolean;
  redis: boolean;
  latency: number;
  uptime: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9?: number;
  ema21?: number;
}

export interface Instrument {
  symbol: string;
  label: string;
  category: 'metals' | 'forex' | 'crypto';
  pipSize: number;
  minPositionSize: number;
}

export interface StrategyConfig {
  symbol: string;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  takeProfit: number;
  stopLoss: number;
  trailingStop: boolean;
  trailingStopPips: number;
  riskPerTrade: number;
  maxPositions: number;
  dailyLossLimit: number;
  maxDrawdown: number;
  positionSizing: 'fixed' | 'percentage' | 'kelly';
  tradingDays: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
  timezone: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface PnLBar {
  date: string;
  pnl: number;
}
