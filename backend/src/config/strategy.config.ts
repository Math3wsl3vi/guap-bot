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
  /**
   * Grid execution mode.
   * VIRTUAL = monitor price + fire market orders (Deriv).
   * LIMIT = place real limit orders on broker (MT5).
   * Auto-detected from broker if omitted.
   */
  mode?: 'VIRTUAL' | 'LIMIT';
  /** Stop loss distance per grid level (same units as spacing). Defaults to gridSpacing. */
  stopLossPerLevel?: number;
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
  /**
   * User-configured event times.
   * "HH:MM" for daily recurring (UTC), or full ISO datetime for one-off events.
   */
  scheduledEvents: string[];
}

export interface HybridConfig {
  /** UTC hour at which to switch from London Breakout to Aggressive Scalping. */
  londonEndHour: number;
  /** UTC hour at which to stop all trading (off-hours). */
  scalpingEndHour: number;
}

export interface CoinFlipConfig {
  /** Growth rate per tick (0.01 = 1%, 0.05 = 5%). Higher = tighter barrier = riskier. */
  growthRate: number;
  /** Stake per accumulator contract in USD. */
  stake: number;
  /** Take profit in USD. When payout reaches this, sell the contract. 0 = manual / ride it. */
  takeProfitUSD: number;
  /** Max concurrent accumulator contracts. */
  maxContracts: number;
  /** Minimum seconds between opening new contracts (cooldown). */
  cooldownSeconds: number;
  /** Duration unit for the contract ('t' = ticks). Always 't' for accumulators. */
  durationUnit: string;
  /** Stop the loop when balance drops to this amount. Protects bankroll floor. */
  minBalance: number;
}

export interface RiseFallConfig {
  /** Stake per contract in USD. */
  stake: number;
  /** Duration in ticks (1-10). */
  durationTicks: number;
  /** 'rise' or 'fall' or 'auto' or 'signal'. auto = random, signal = indicator-driven. */
  direction: 'rise' | 'fall' | 'auto' | 'signal';
  /** Max concurrent contracts. */
  maxContracts: number;
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
  /** Signal mode: EMA fast period for direction bias. */
  signalEmaFast: number;
  /** Signal mode: EMA slow period for direction bias. */
  signalEmaSlow: number;
  /** Signal mode: RSI period. */
  signalRsiPeriod: number;
  /** Signal mode: RSI above this = overbought, bias Fall. */
  signalRsiOverbought: number;
  /** Signal mode: RSI below this = oversold, bias Rise. */
  signalRsiOversold: number;
  /** Signal mode: minimum RSI+EMA agreement strength to trade. When false, only requires EMA direction. */
  requireConfluence: boolean;
  /** Signal mode: skip trade when no clear signal (true) or fallback to random (false). */
  skipOnNoSignal: boolean;
  /** Use tick-level prices for indicators instead of 1-min candle closes. Better for short-duration contracts on synthetics. */
  useTickIndicators: boolean;
  /** Tick-level EMA fast period (default 5). Only used when useTickIndicators is true. */
  tickEmaFast: number;
  /** Tick-level EMA slow period (default 13). Only used when useTickIndicators is true. */
  tickEmaSlow: number;
  /** Tick-level RSI period (default 10). Only used when useTickIndicators is true. */
  tickRsiPeriod: number;
  /** Minimum RSI distance from 50 to generate a signal (default 15 → only trade RSI > 65 or < 35). Tick RSI oscillates in a narrow band so this filters out noise. */
  tickRsiMinStrength: number;
}

export interface EvenOddConfig {
  /** Stake per contract in USD. */
  stake: number;
  /** Duration in ticks (1-10). */
  durationTicks: number;
  /** 'even' or 'odd' or 'auto' (auto = random). */
  prediction: 'even' | 'odd' | 'auto';
  /** Max concurrent contracts. */
  maxContracts: number;
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface DigitOverUnderConfig {
  /** Stake per contract in USD. */
  stake: number;
  /** Duration in ticks (1-10). */
  durationTicks: number;
  /** 'over' or 'under'. */
  direction: 'over' | 'under';
  /** Barrier digit (0-9). Over barrier=4 means last digit > 4. */
  barrier: number;
  /** Max concurrent contracts. */
  maxContracts: number;
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface MartingaleConfig {
  /** Base stake (first bet) in USD. */
  baseStake: number;
  /** Multiplier after each loss (2 = classic Martingale). */
  multiplier: number;
  /** Max consecutive losses before stopping (safety limit). */
  maxConsecutiveLosses: number;
  /** Contract type: 'rise_fall' or 'even_odd'. */
  contractType: 'rise_fall' | 'even_odd';
  /** Duration in ticks per contract. */
  durationTicks: number;
  /** Direction mode: 'auto' (random), 'signal' (EMA/RSI filtered). */
  directionMode: 'auto' | 'signal';
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
  /** Max total session loss before stopping. */
  maxSessionLoss: number;
  /** EMA fast period for signal mode. */
  signalEmaFast: number;
  /** EMA slow period for signal mode. */
  signalEmaSlow: number;
}

export interface AccumulatorLadderConfig {
  /** Growth rate per tick (0.01 = 1%, 0.02 = 2%, 0.03 = 3%). Lower = wider barrier. */
  growthRate: number;
  /** Stake per contract in USD. */
  stake: number;
  /** Max duration in seconds before closing. 0 = ride until knocked out. */
  maxDurationSeconds: number;
  /** Target profit percentage of stake to close (e.g. 0.5 = 50% profit). 0 = ride until duration/knockout. */
  targetProfitPercent: number;
  /** Max concurrent contracts. */
  maxContracts: number;
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface MomentumRiseFallConfig {
  /** Stake per contract in USD. */
  stake: number;
  /** Duration in ticks per contract. */
  durationTicks: number;
  /** EMA fast period for momentum direction. */
  emaFast: number;
  /** EMA slow period for momentum direction. */
  emaSlow: number;
  /** Max contracts to fire per signal burst. */
  maxBurstContracts: number;
  /** Seconds between rapid-fire contracts in a burst. */
  burstIntervalSeconds: number;
  /** Cooldown seconds after burst completes before re-evaluating signal. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
  /** Stop firing if signal flips mid-burst. */
  stopOnSignalFlip: boolean;
}

export interface DigitSniperConfig {
  /** Stake per digit in USD (total cost = stake × number of digits). */
  stakePerDigit: number;
  /** Duration in ticks per contract. */
  durationTicks: number;
  /** Which digits to cover (e.g. [3, 5, 7] = bet on match 3, 5, and 7). */
  targetDigits: number[];
  /** Max concurrent rounds (each round = N simultaneous contracts). */
  maxConcurrentRounds: number;
  /** Cooldown between rounds in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface VolatilityBreakoutConfig {
  /** Stake per turbo contract in USD. */
  stake: number;
  /** Target index: 'BOOM500', 'BOOM1000', 'CRASH500', 'CRASH1000'. */
  targetIndex: 'BOOM500' | 'BOOM1000' | 'CRASH500' | 'CRASH1000';
  /** Consecutive ticks in bleed direction before buying. */
  consecutiveTickThreshold: number;
  /** Turbo contract duration in minutes. */
  turboDurationMinutes: number;
  /** Max concurrent turbo contracts. */
  maxContracts: number;
  /** Cooldown between contracts in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface HedgedAccumulatorConfig {
  /** Growth rate per tick (0.01 = 1%, 0.05 = 5%). */
  growthRate: number;
  /** Stake per contract in USD (each side gets this stake). Total cost = 2× stake. */
  stakePerSide: number;
  /** Take profit in USD for the surviving side. 0 = ride until knocked out. */
  takeProfitUSD: number;
  /** Max concurrent hedge pairs. */
  maxPairs: number;
  /** Cooldown between opening new pairs in seconds. */
  cooldownSeconds: number;
  /** Stop trading when balance drops to this. */
  minBalance: number;
}

export interface AllInRecoveryConfig {
  /** Balance threshold to trigger recovery mode. */
  triggerBalance: number;
  /** Stake in recovery mode (larger than normal). */
  recoveryStake: number;
  /** Growth rate for accumulator recovery (higher than normal). */
  recoveryGrowthRate: number;
  /** Take profit in USD per recovery trade. */
  recoveryTakeProfitUSD: number;
  /** Contract type in recovery: 'accumulator', 'rise_fall', 'even_odd'. */
  recoveryContractType: 'accumulator' | 'rise_fall' | 'even_odd';
  /** Max recovery attempts before stopping. */
  maxRecoveryAttempts: number;
  /** Cooldown between recovery trades in seconds. */
  cooldownSeconds: number;
  /** Absolute minimum balance — hard stop. */
  hardStopBalance: number;
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

  // ── Trailing stop & breakeven execution ─────────────────────────────────
  /** Pips in profit before activating the trailing stop. */
  trailingActivationPips: number;
  /** When true, use ATR × trailingAtrMultiplier as trail distance instead of fixed pips. */
  useAtrTrailing: boolean;
  /** Trail distance = trailingAtrMultiplier × ATR (only used when useAtrTrailing is true). */
  trailingAtrMultiplier: number;
  /** When true, move SL to entry price once profit exceeds breakevenTriggerPips. */
  breakevenEnabled: boolean;
  /** Pips in profit before moving SL to breakeven (entry price). */
  breakevenTriggerPips: number;
  /** How often (ms) the position monitor checks open positions for trailing/breakeven updates. */
  positionMonitorIntervalMs: number;

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

  // Trailing stop & breakeven execution
  trailingActivationPips: parseEnvNumber(process.env.TRAILING_ACTIVATION_PIPS, 5),
  useAtrTrailing: process.env.USE_ATR_TRAILING === 'true',
  trailingAtrMultiplier: parseEnvNumber(process.env.TRAILING_ATR_MULTIPLIER, 1.0),
  breakevenEnabled: process.env.BREAKEVEN_ENABLED === 'true',
  breakevenTriggerPips: parseEnvNumber(process.env.BREAKEVEN_TRIGGER_PIPS, 5),
  positionMonitorIntervalMs: parseEnvNumber(process.env.POSITION_MONITOR_INTERVAL_MS, 5000),

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
    minRangePips: 50,
    maxRangePips: 400,
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
    lotSizePerLevel: 1,
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
    scheduledEvents: [],
  },

  hybrid: {
    londonEndHour: 10,
    scalpingEndHour: 21,
  },

  coinFlip: {
    growthRate: 0.05,
    stake: 1,
    takeProfitUSD: 0.50,
    maxContracts: 1,
    cooldownSeconds: 5,
    durationUnit: 't',
    minBalance: 1,
  },

  riseFall: {
    stake: 1,
    durationTicks: 5,
    direction: 'signal',
    maxContracts: 1,
    cooldownSeconds: 3,
    minBalance: 1,
    signalEmaFast: 9,
    signalEmaSlow: 21,
    signalRsiPeriod: 14,
    signalRsiOverbought: 70,
    signalRsiOversold: 30,
    requireConfluence: false,
    skipOnNoSignal: true,
    useTickIndicators: false,
    tickEmaFast: 5,
    tickEmaSlow: 13,
    tickRsiPeriod: 10,
    tickRsiMinStrength: 15,
  },

  evenOdd: {
    stake: 1,
    durationTicks: 5,
    prediction: 'auto',
    maxContracts: 1,
    cooldownSeconds: 3,
    minBalance: 1,
  },

  digitOverUnder: {
    stake: 1,
    durationTicks: 5,
    direction: 'over',
    barrier: 4,
    maxContracts: 1,
    cooldownSeconds: 3,
    minBalance: 1,
  },

  martingale: {
    baseStake: 1,
    multiplier: 2,
    maxConsecutiveLosses: 6,
    contractType: 'rise_fall',
    durationTicks: 5,
    directionMode: 'signal',
    cooldownSeconds: 3,
    minBalance: 1,
    maxSessionLoss: 50,
    signalEmaFast: 9,
    signalEmaSlow: 21,
  },

  accumulatorLadder: {
    growthRate: 0.01,
    stake: 5,
    maxDurationSeconds: 60,
    targetProfitPercent: 0.5,
    maxContracts: 1,
    cooldownSeconds: 5,
    minBalance: 1,
  },

  momentumRiseFall: {
    stake: 1,
    durationTicks: 5,
    emaFast: 5,
    emaSlow: 13,
    maxBurstContracts: 5,
    burstIntervalSeconds: 3,
    cooldownSeconds: 10,
    minBalance: 1,
    stopOnSignalFlip: true,
  },

  digitSniper: {
    stakePerDigit: 0.50,
    durationTicks: 5,
    targetDigits: [3, 5, 7],
    maxConcurrentRounds: 1,
    cooldownSeconds: 5,
    minBalance: 1,
  },

  volatilityBreakout: {
    stake: 5,
    targetIndex: 'BOOM500',
    consecutiveTickThreshold: 10,
    turboDurationMinutes: 5,
    maxContracts: 1,
    cooldownSeconds: 10,
    minBalance: 1,
  },

  hedgedAccumulator: {
    growthRate: 0.03,
    stakePerSide: 1,
    takeProfitUSD: 2,
    maxPairs: 1,
    cooldownSeconds: 10,
    minBalance: 1,
  },

  allInRecovery: {
    triggerBalance: 60,
    recoveryStake: 15,
    recoveryGrowthRate: 0.05,
    recoveryTakeProfitUSD: 2,
    recoveryContractType: 'accumulator',
    maxRecoveryAttempts: 5,
    cooldownSeconds: 5,
    hardStopBalance: 10,
  },
};
