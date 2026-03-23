/**
 * All available trading strategy types.
 *
 * CONSERVATIVE / AGGRESSIVE_SCALPING / LONDON_BREAKOUT / MEAN_REVERSION / NEWS_EVENT / HYBRID
 * work with any broker (market orders only).
 *
 * GRID_TRADING requires a broker that supports pending/limit orders (e.g. MT5).
 */
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

export const ALL_STRATEGY_TYPES: readonly StrategyType[] = [
  'CONSERVATIVE',
  'AGGRESSIVE_SCALPING',
  'LONDON_BREAKOUT',
  'MEAN_REVERSION',
  'GRID_TRADING',
  'NEWS_EVENT',
  'HYBRID',
  'COIN_FLIP',
  'RISE_FALL',
  'EVEN_ODD',
  'DIGIT_OVER_UNDER',
  'MARTINGALE',
  'ACCUMULATOR_LADDER',
  'MOMENTUM_RISE_FALL',
  'DIGIT_SNIPER',
  'VOLATILITY_BREAKOUT',
  'HEDGED_ACCUMULATOR',
  'ALL_IN_RECOVERY',
] as const;

export interface StrategyMeta {
  type: StrategyType;
  label: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresMT5: boolean;
}

export const STRATEGY_META: Record<StrategyType, StrategyMeta> = {
  CONSERVATIVE: {
    type: 'CONSERVATIVE',
    label: 'Conservative EMA Scalp',
    description: 'Strict EMA(9/21) crossover with 6 confirmation filters. Low frequency, high precision.',
    riskLevel: 'LOW',
    requiresMT5: false,
  },
  AGGRESSIVE_SCALPING: {
    type: 'AGGRESSIVE_SCALPING',
    label: 'Aggressive Scalping',
    description: 'Fast EMAs(5/13), loosened filters, breakeven moves, trailing stops. Higher frequency.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  LONDON_BREAKOUT: {
    type: 'LONDON_BREAKOUT',
    label: 'London Breakout',
    description: 'Trades the London session open breakout from the Asian session range.',
    riskLevel: 'MEDIUM',
    requiresMT5: false,
  },
  MEAN_REVERSION: {
    type: 'MEAN_REVERSION',
    label: 'Mean Reversion',
    description: 'Bollinger Band + RSI bounce trading at band extremes. Targets mean (SMA) reversion.',
    riskLevel: 'MEDIUM',
    requiresMT5: false,
  },
  GRID_TRADING: {
    type: 'GRID_TRADING',
    label: 'Grid Trading',
    description: 'Multi-level limit orders at price intervals. Requires MT5 broker for pending orders.',
    riskLevel: 'HIGH',
    requiresMT5: true,
  },
  NEWS_EVENT: {
    type: 'NEWS_EVENT',
    label: 'News Event',
    description: 'Impulse trading around high-impact economic releases (NFP, CPI, FOMC).',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  HYBRID: {
    type: 'HYBRID',
    label: 'Hybrid (Time-Switched)',
    description: 'London Breakout in the morning, Aggressive Scalping rest of day. Time-switched composite.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  COIN_FLIP: {
    type: 'COIN_FLIP',
    label: 'Coin Flip (Accumulator)',
    description: 'Accumulator options — stake compounds each tick the price stays in range. High risk, exponential growth.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  RISE_FALL: {
    type: 'RISE_FALL',
    label: 'Rise/Fall',
    description: 'Binary options — signal-driven or manual. Use EMA/RSI indicators to pick Rise vs Fall for an edge above 51.3%.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  EVEN_ODD: {
    type: 'EVEN_ODD',
    label: 'Even/Odd',
    description: 'Digit options — predict if last digit of price is even or odd. True 50/50, ~95% payout.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  DIGIT_OVER_UNDER: {
    type: 'DIGIT_OVER_UNDER',
    label: 'Digit Over/Under',
    description: 'Digit options — predict if last digit is over/under a barrier. Adjustable probability vs payout.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  MARTINGALE: {
    type: 'MARTINGALE',
    label: 'Martingale Recovery',
    description: 'Rise/Fall with doubling stakes after each loss. One win recovers all losses. High blow-up risk.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  ACCUMULATOR_LADDER: {
    type: 'ACCUMULATOR_LADDER',
    label: 'Accumulator Ladder',
    description: 'Lower growth rate ACCU for wider barriers. Duration-based exits instead of fixed TP. Compounding runs.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  MOMENTUM_RISE_FALL: {
    type: 'MOMENTUM_RISE_FALL',
    label: 'Momentum Rise/Fall',
    description: 'EMA-filtered rapid-fire Rise/Fall. Spam contracts in trend direction until signal flips.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  DIGIT_SNIPER: {
    type: 'DIGIT_SNIPER',
    label: 'Digit Sniper',
    description: 'DIGITMATCH on multiple digits simultaneously. 10:1 payout per digit, multi-coverage for higher hit rate.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  VOLATILITY_BREAKOUT: {
    type: 'VOLATILITY_BREAKOUT',
    label: 'Volatility Breakout',
    description: 'Turbos on Crash/Boom indices. Buy after consecutive bleed ticks, betting on the spike.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  HEDGED_ACCUMULATOR: {
    type: 'HEDGED_ACCUMULATOR',
    label: 'Hedged Accumulator',
    description: 'Two opposing ACCU contracts simultaneously. One knocked out, the other compounds in trending markets.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
  ALL_IN_RECOVERY: {
    type: 'ALL_IN_RECOVERY',
    label: 'All-In Recovery',
    description: 'Aggressive recovery mode. Larger stakes + higher growth when balance drops below threshold. Demo only.',
    riskLevel: 'HIGH',
    requiresMT5: false,
  },
};
