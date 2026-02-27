import 'dotenv/config';
import { parseEnvNumber } from '../utils/helpers';

export interface StrategyConfig {
  // ── Core EMA/RSI parameters ──────────────────────────────────────────────
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
}

// Mutable at runtime — the API server may update these values live.
export const strategyConfig: StrategyConfig = {
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
};
