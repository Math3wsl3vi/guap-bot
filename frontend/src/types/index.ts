export interface Trade {
  id: string;
  symbol: string;
  type: string;
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
  strategySignal?: string;
  strategyType?: string;
  trailingStopActive?: boolean;
  trailingStopLevel?: number | null;
  breakevenApplied?: boolean;
}

export interface TradesResponse {
  trades: Trade[];
  total: number;
}

export interface TradeFilters {
  from?: string;
  to?: string;
  strategy?: string;
  status?: 'OPEN' | 'CLOSED';
  outcome?: 'win' | 'loss';
  minSize?: number;
  maxSize?: number;
  limit?: number;
  offset?: number;
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
  /** Present on higher-timeframe candle events (e.g. '5m', '15m', '1h'). Absent for 1m. */
  timeframe?: string;
}

export interface Instrument {
  symbol: string;
  label: string;
  category: 'metals' | 'forex' | 'crypto' | 'synthetic';
  pipSize: number;
  minPositionSize: number;
  isSynthetic?: boolean;
}

// ── Strategy-specific config sub-types ────────────────────────────────────────

export interface AggressiveConfig {
  emaFast: number;
  emaSlow: number;
  rsiOverbought: number;
  rsiOversold: number;
  adxThreshold: number;
  useTrendFilter: boolean;
  breakevenAfterPips: number;
  trailingActivationPips: number;
}

export interface LondonBreakoutConfig {
  asianRangeStartHour: number;
  asianRangeEndHour: number;
  breakoutWindowEndHour: number;
  minRangePips: number;
  maxRangePips: number;
  slRangeMultiplier: number;
  tpRangeMultiplier: number;
}

export interface MeanReversionConfig {
  bollingerPeriod: number;
  bollingerStdDev: number;
  rsiOversold: number;
  rsiOverbought: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
}

export interface GridTradingConfig {
  gridLevels: number;
  gridSpacing: number;
  lotSizePerLevel: number;
  takeProfitPerLevel: number;
  maxGridDrawdown: number;
  trendDetectionEnabled: boolean;
  trendAdxThreshold: number;
}

export interface NewsEventConfig {
  blackoutMinutesBefore: number;
  entryWindowMinutesAfter: number;
  minImpulseBodyPips: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
  scheduledEvents: string[];
}

export interface HybridConfig {
  londonEndHour: number;
  scalpingEndHour: number;
}

export interface CoinFlipConfig {
  growthRate: number;
  stake: number;
  takeProfitUSD: number;
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface RiseFallConfig {
  stake: number;
  durationTicks: number;
  direction: 'rise' | 'fall' | 'auto' | 'signal';
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
  signalEmaFast: number;
  signalEmaSlow: number;
  signalRsiPeriod: number;
  signalRsiOverbought: number;
  signalRsiOversold: number;
  requireConfluence: boolean;
  skipOnNoSignal: boolean;
}

export interface EvenOddConfig {
  stake: number;
  durationTicks: number;
  prediction: 'even' | 'odd' | 'auto';
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface DigitOverUnderConfig {
  stake: number;
  durationTicks: number;
  direction: 'over' | 'under';
  barrier: number;
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
}

export type StrategyType =
  | 'CONSERVATIVE'
  | 'AGGRESSIVE_SCALPING'
  | 'LONDON_BREAKOUT'
  | 'MEAN_REVERSION'
  | 'GRID_TRADING'
  | 'NEWS_EVENT'
  | 'HYBRID'
  | 'COIN_FLIP'
  | 'RISE_FALL'
  | 'EVEN_ODD'
  | 'DIGIT_OVER_UNDER'
  | 'MARTINGALE'
  | 'ACCUMULATOR_LADDER'
  | 'MOMENTUM_RISE_FALL'
  | 'DIGIT_SNIPER'
  | 'VOLATILITY_BREAKOUT'
  | 'HEDGED_ACCUMULATOR'
  | 'ALL_IN_RECOVERY';

export interface MartingaleConfig {
  baseStake: number;
  multiplier: number;
  maxConsecutiveLosses: number;
  contractType: 'rise_fall' | 'even_odd';
  durationTicks: number;
  directionMode: 'auto' | 'signal';
  cooldownSeconds: number;
  minBalance: number;
  maxSessionLoss: number;
  signalEmaFast: number;
  signalEmaSlow: number;
}

export interface AccumulatorLadderConfig {
  growthRate: number;
  stake: number;
  maxDurationSeconds: number;
  targetProfitPercent: number;
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface MomentumRiseFallConfig {
  stake: number;
  durationTicks: number;
  emaFast: number;
  emaSlow: number;
  maxBurstContracts: number;
  burstIntervalSeconds: number;
  cooldownSeconds: number;
  minBalance: number;
  stopOnSignalFlip: boolean;
}

export interface DigitSniperConfig {
  stakePerDigit: number;
  durationTicks: number;
  targetDigits: number[];
  maxConcurrentRounds: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface VolatilityBreakoutConfig {
  stake: number;
  targetIndex: 'BOOM500' | 'BOOM1000' | 'CRASH500' | 'CRASH1000';
  consecutiveTickThreshold: number;
  turboDurationMinutes: number;
  maxContracts: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface HedgedAccumulatorConfig {
  growthRate: number;
  stakePerSide: number;
  takeProfitUSD: number;
  maxPairs: number;
  cooldownSeconds: number;
  minBalance: number;
}

export interface AllInRecoveryConfig {
  triggerBalance: number;
  recoveryStake: number;
  recoveryGrowthRate: number;
  recoveryTakeProfitUSD: number;
  recoveryContractType: 'accumulator' | 'rise_fall' | 'even_odd';
  maxRecoveryAttempts: number;
  cooldownSeconds: number;
  hardStopBalance: number;
}

export interface StrategyConfig {
  // ── Strategy selection ──────────────────────────────────────────────────────
  strategyType: StrategyType;
  broker: 'deriv' | 'mt5';
  symbol: string;

  // ── Core EMA/RSI (Conservative base) ────────────────────────────────────────
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  // ── Exit levels ─────────────────────────────────────────────────────────────
  takeProfit: number;
  stopLoss: number;
  trailingStop: boolean;
  trailingStopPips: number;

  // ── Advanced trailing & breakeven ───────────────────────────────────────────
  trailingActivationPips: number;
  useAtrTrailing: boolean;
  trailingAtrMultiplier: number;
  breakevenEnabled: boolean;
  breakevenTriggerPips: number;

  // ── Trend confirmation ──────────────────────────────────────────────────────
  emaTrendPeriod: number;
  adxPeriod: number;
  adxThreshold: number;

  // ── ATR-based dynamic stops ─────────────────────────────────────────────────
  useAtrStops: boolean;
  atrPeriod: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;

  // ── Entry quality filters ───────────────────────────────────────────────────
  minBodyPips: number;
  spreadFilterPips: number;

  // ── Session filter ──────────────────────────────────────────────────────────
  sessionFilterEnabled: boolean;
  blockedHoursUtc: string[];

  // ── Risk management ─────────────────────────────────────────────────────────
  riskPerTrade: number;
  maxPositions: number;
  dailyLossLimit: number;
  maxDrawdown: number;
  positionSizing: 'fixed' | 'percentage' | 'kelly';

  // ── Trading schedule ────────────────────────────────────────────────────────
  tradingDays: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
  timezone: string;

  // ── Per-strategy configs ────────────────────────────────────────────────────
  aggressive: AggressiveConfig;
  londonBreakout: LondonBreakoutConfig;
  meanReversion: MeanReversionConfig;
  gridTrading: GridTradingConfig;
  newsEvent: NewsEventConfig;
  hybrid: HybridConfig;
  coinFlip: CoinFlipConfig;
  riseFall: RiseFallConfig;
  evenOdd: EvenOddConfig;
  digitOverUnder: DigitOverUnderConfig;
  martingale: MartingaleConfig;
  accumulatorLadder: AccumulatorLadderConfig;
  momentumRiseFall: MomentumRiseFallConfig;
  digitSniper: DigitSniperConfig;
  volatilityBreakout: VolatilityBreakoutConfig;
  hedgedAccumulator: HedgedAccumulatorConfig;
  allInRecovery: AllInRecoveryConfig;

  // ── Preset tracking ─────────────────────────────────────────────────────────
  activePreset?: string | null;
}

export interface TradingPreset {
  id: string;
  name: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  timeframe: string;
  strategyType: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface PnLBar {
  date: string;
  pnl: number;
}
