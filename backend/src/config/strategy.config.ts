import 'dotenv/config';
import { parseEnvNumber } from '../utils/helpers';
import { StrategyType } from '../strategies/StrategyType';

// ── Per-strategy config sub-types ─────────────────────────────────────────────

export interface AggressiveConfig {
  emaFast: number;
  emaSlow: number;
  rsiOverbought: number;
  rsiOversold: number;
  adxThreshold: number;
  /** When false, EMA(50) trend filter is disabled to catch more entries. */
  useTrendFilter: boolean;
  /** Pips in profit before moving SL to breakeven (entry price). */
  breakevenAfterPips: number;
  /** Pips in profit before activating trailing stop. */
  trailingActivationPips: number;
}

export interface LondonBreakoutConfig {
  /** UTC hour to start building the Asian range (inclusive). */
  asianRangeStartHour: number;
  /** UTC hour to stop building the Asian range (exclusive). */
  asianRangeEndHour: number;
  /** UTC hour to stop accepting breakout entries (exclusive). */
  breakoutWindowEndHour: number;
  /** Minimum Asian range size in pips to consider valid. */
  minRangePips: number;
  /** Maximum Asian range size in pips (too wide = skip). */
  maxRangePips: number;
  /** Stop loss as a multiple of the Asian range width. */
  slRangeMultiplier: number;
  /** Take profit as a multiple of the Asian range width. */
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
  /** Number of grid levels above and below the current price. */
  gridLevels: number;
  /** Distance between grid levels (in instrument units, e.g. $1 for gold). */
  gridSpacing: number;
  /** Stake amount (USD) per grid order. */
  lotSizePerLevel: number;
  /** Take profit distance per grid level (same units as spacing). */
  takeProfitPerLevel: number;
  /** Max drawdown % to close all grid orders (0.05 = 5%). */
  maxGridDrawdown: number;
  /** When true, shut down grid if ADX exceeds threshold (strong trend). */
  trendDetectionEnabled: boolean;
  /** ADX threshold to shut down grid (only used if trendDetectionEnabled). */
  trendAdxThreshold: number;
}

export interface NewsEventConfig {
  /** Minutes before event to stop trading. */
  blackoutMinutesBefore: number;
  /** Minutes after event to look for impulse entry. */
  entryWindowMinutesAfter: number;
  /** Minimum first-impulse candle body in pips. */
  minImpulseBodyPips: number;
  /** ATR multiplier for stop loss (wider for news volatility). */
  atrSlMultiplier: number;
  /** ATR multiplier for take profit (larger targets). */
  atrTpMultiplier: number;
}

export interface HybridConfig {
  /** UTC hour at which to switch from London Breakout to Aggressive Scalping. */
  londonEndHour: number;
  /** UTC hour at which to stop all trading (off-hours). */
  scalpingEndHour: number;
}

// ── Main strategy config ──────────────────────────────────────────────────────

export interface StrategyConfig {
  // ── Strategy selection ──────────────────────────────────────────────────────
  strategyType: StrategyType;
  /** When true, switching strategy types applies preset risk/indicator defaults. */
  usePresetRisk: boolean;
  /** Active broker adapter ('deriv' or 'mt5'). */
  broker: 'deriv' | 'mt5';

  // ── Core EMA/RSI parameters (Conservative strategy) ─────────────────────────
  emaFastPeriod: number;
  emaSlowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  // ── Exit levels (fallback when ATR stops are disabled) ───────────────────
  takeProfitPips: number;
  stopLossPips: number;
  trailingStopEnabled: boolean;
  trailingStopPips: number;

  // ── Trend confirmation ────────────────────────────────────────────────────
  /** EMA period used to determine the higher-timeframe trend direction. */
  emaTrendPeriod: number;
  /** ADX period for measuring trend strength. */
  adxPeriod: number;
  /** Minimum ADX value to allow a trade; below this = ranging market (skip). */
  adxThreshold: number;

  // ── ATR-based dynamic stops ───────────────────────────────────────────────
  /** When true, stop loss and take profit are set as multiples of ATR instead
   *  of fixed pips. The computed values are returned inside the Signal object
   *  and override stopLossPips / takeProfitPips in bot.ts and the backtester. */
  useAtrStops: boolean;
  /** ATR lookback period. */
  atrPeriod: number;
  /** Stop loss = atrSlMultiplier × ATR (e.g. 1.5). */
  atrSlMultiplier: number;
  /** Take profit = atrTpMultiplier × ATR (e.g. 3.0 → ~2:1 R:R after spread). */
  atrTpMultiplier: number;

  // ── Entry quality filters ─────────────────────────────────────────────────
  /** Minimum candle body size in pips; filters doji/indecision bars. */
  minBodyPips: number;
  /** Maximum spread in pips before skipping a trade (applied live only). */
  spreadFilterPips: number;

  // ── Session filter ────────────────────────────────────────────────────────
  /** Block trades during low-liquidity UTC hour ranges. */
  sessionFilterEnabled: boolean;
  /**
   * UTC time ranges to block, formatted as "HH:MM-HH:MM".
   * Ranges that cross midnight (e.g. "22:00-01:00") are handled correctly.
   * Example: ["22:00-01:00", "16:00-17:00"]
   */
  blockedHoursUtc: string[];

  // ── Scheduling ────────────────────────────────────────────────────────────
  tradingDays: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
  timezone: string;
  positionSizing: 'fixed' | 'percentage' | 'kelly';
  symbol: string;
  timeframe: string;

  // ── Per-strategy config sections ──────────────────────────────────────────
  aggressive: AggressiveConfig;
  londonBreakout: LondonBreakoutConfig;
  meanReversion: MeanReversionConfig;
  gridTrading: GridTradingConfig;
  newsEvent: NewsEventConfig;
  hybrid: HybridConfig;
}

// Mutable at runtime — the API server may update these values live.
export const strategyConfig: StrategyConfig = {
  // Strategy selection
  strategyType: (process.env.STRATEGY_TYPE as StrategyType) || 'CONSERVATIVE',
  usePresetRisk: process.env.USE_PRESET_RISK !== 'false',
  broker: (process.env.BROKER as 'deriv' | 'mt5') || 'deriv',

  // Core EMA/RSI
  emaFastPeriod: parseEnvNumber(process.env.EMA_FAST_PERIOD, 9),
  emaSlowPeriod: parseEnvNumber(process.env.EMA_SLOW_PERIOD, 21),
  rsiPeriod: parseEnvNumber(process.env.RSI_PERIOD, 14),
  rsiOverbought: parseEnvNumber(process.env.RSI_OVERBOUGHT, 70),
  rsiOversold: parseEnvNumber(process.env.RSI_OVERSOLD, 30),

  // Exit levels (fallback)
  takeProfitPips: parseEnvNumber(process.env.TAKE_PROFIT_PIPS, 8),
  stopLossPips: parseEnvNumber(process.env.STOP_LOSS_PIPS, 5),
  trailingStopEnabled: process.env.TRAILING_STOP_ENABLED === 'true',
  trailingStopPips: parseEnvNumber(process.env.TRAILING_STOP_PIPS, 3),

  // Trend confirmation
  emaTrendPeriod: parseEnvNumber(process.env.EMA_TREND_PERIOD, 50),
  adxPeriod: parseEnvNumber(process.env.ADX_PERIOD, 14),
  adxThreshold: parseEnvNumber(process.env.ADX_THRESHOLD, 25),

  // ATR-based dynamic stops
  useAtrStops: process.env.USE_ATR_STOPS !== 'false', // default true
  atrPeriod: parseEnvNumber(process.env.ATR_PERIOD, 14),
  atrSlMultiplier: parseEnvNumber(process.env.ATR_SL_MULTIPLIER, 1.5),
  atrTpMultiplier: parseEnvNumber(process.env.ATR_TP_MULTIPLIER, 3.0),

  // Entry quality filters
  minBodyPips: parseEnvNumber(process.env.MIN_BODY_PIPS, 5),
  spreadFilterPips: parseEnvNumber(process.env.SPREAD_FILTER_PIPS, 0.5),

  // Session filter
  sessionFilterEnabled: process.env.SESSION_FILTER_ENABLED !== 'false', // default true
  blockedHoursUtc: (process.env.BLOCKED_HOURS_UTC || '22:00-01:00,16:00-17:00').split(','),

  // Scheduling
  tradingDays: (process.env.TRADING_DAYS || 'Mon,Tue,Wed,Thu,Fri').split(','),
  tradingHoursStart: process.env.TRADING_HOURS_START || '08:00',
  tradingHoursEnd: process.env.TRADING_HOURS_END || '17:00',
  timezone: process.env.TRADING_TIMEZONE || 'UTC',
  positionSizing: (process.env.POSITION_SIZING as StrategyConfig['positionSizing']) || 'percentage',
  symbol: process.env.TRADING_SYMBOL || 'XAU_USD',
  timeframe: process.env.TRADING_TIMEFRAME || '1m',

  // ── Per-strategy defaults ───────────────────────────────────────────────────
  aggressive: {
    emaFast: 5,
    emaSlow: 13,
    rsiOverbought: 80,
    rsiOversold: 20,
    adxThreshold: 15,
    useTrendFilter: false,
    breakevenAfterPips: 3,
    trailingActivationPips: 5,
  },

  londonBreakout: {
    asianRangeStartHour: 0,
    asianRangeEndHour: 7,
    breakoutWindowEndHour: 10,
    minRangePips: 10,
    maxRangePips: 50,
    slRangeMultiplier: 0.5,
    tpRangeMultiplier: 1.5,
  },

  meanReversion: {
    bollingerPeriod: 20,
    bollingerStdDev: 2.0,
    rsiOversold: 25,
    rsiOverbought: 75,
    atrSlMultiplier: 1.5,
    atrTpMultiplier: 1.0,
  },

  gridTrading: {
    gridLevels: 5,
    gridSpacing: 2.0,
    lotSizePerLevel: 10,
    takeProfitPerLevel: 1.0,
    maxGridDrawdown: 0.05,
    trendDetectionEnabled: true,
    trendAdxThreshold: 30,
  },

  newsEvent: {
    blackoutMinutesBefore: 5,
    entryWindowMinutesAfter: 3,
    minImpulseBodyPips: 10,
    atrSlMultiplier: 2.0,
    atrTpMultiplier: 3.0,
  },

  hybrid: {
    londonEndHour: 10,
    scalpingEndHour: 21,
  },
};
