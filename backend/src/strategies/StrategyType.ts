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
  | 'HYBRID';

export const ALL_STRATEGY_TYPES: readonly StrategyType[] = [
  'CONSERVATIVE',
  'AGGRESSIVE_SCALPING',
  'LONDON_BREAKOUT',
  'MEAN_REVERSION',
  'GRID_TRADING',
  'NEWS_EVENT',
  'HYBRID',
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
};
