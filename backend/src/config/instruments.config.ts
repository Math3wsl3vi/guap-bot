export interface InstrumentInfo {
  /** Internal symbol key used throughout the codebase and in .env */
  symbol: string;
  /** Capital.com epic (market identifier sent to the broker API) */
  epic: string;
  /** Human-readable display name */
  label: string;
  /** Market category for UI grouping */
  category: 'metals' | 'forex' | 'crypto';
  /**
   * Monetary value of 1 pip per 1 unit of the instrument (in account currency).
   * Used directly in the position sizing formula:
   *   units = riskAmount / (stopLossPips × pipSize)
   *
   * For quote-USD instruments (XAU/USD, EUR/USD) this equals the raw price increment.
   * For JPY pairs the value is approximate (assumes ~150 USDJPY).
   */
  pipSize: number;
  /** Broker minimum order size in units */
  minPositionSize: number;
}

// minPositionSize = minimum stake in USD on Deriv (all instruments: $1 minimum)
export const INSTRUMENTS: InstrumentInfo[] = [
  // ── Metals ─────────────────────────────────────────────────────────────────
  { symbol: 'XAU_USD', epic: 'GOLD',   label: 'Gold (XAU/USD)',   category: 'metals', pipSize: 0.01,    minPositionSize: 1 },
  { symbol: 'XAG_USD', epic: 'SILVER', label: 'Silver (XAG/USD)', category: 'metals', pipSize: 0.001,   minPositionSize: 1 },

  // ── Forex Majors ────────────────────────────────────────────────────────────
  { symbol: 'EURUSD',  epic: 'EURUSD',  label: 'EUR/USD', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'GBPUSD',  epic: 'GBPUSD',  label: 'GBP/USD', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'USDJPY',  epic: 'USDJPY',  label: 'USD/JPY', category: 'forex', pipSize: 0.01,   minPositionSize: 1 },
  { symbol: 'USDCHF',  epic: 'USDCHF',  label: 'USD/CHF', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'AUDUSD',  epic: 'AUDUSD',  label: 'AUD/USD', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'USDCAD',  epic: 'USDCAD',  label: 'USD/CAD', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'NZDUSD',  epic: 'NZDUSD',  label: 'NZD/USD', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },

  // ── Forex Minors ────────────────────────────────────────────────────────────
  { symbol: 'EURGBP',  epic: 'EURGBP',  label: 'EUR/GBP', category: 'forex', pipSize: 0.0001, minPositionSize: 1 },
  { symbol: 'EURJPY',  epic: 'EURJPY',  label: 'EUR/JPY', category: 'forex', pipSize: 0.01,   minPositionSize: 1 },
  { symbol: 'GBPJPY',  epic: 'GBPJPY',  label: 'GBP/JPY', category: 'forex', pipSize: 0.01,   minPositionSize: 1 },
];

/**
 * Look up instrument config by internal symbol.
 * Falls back to a sensible generic default so the bot doesn't hard-crash on an
 * unknown symbol — callers should still log a warning if this happens.
 */
export function getInstrumentConfig(symbol: string): InstrumentInfo {
  const found = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!found) {
    return {
      symbol,
      epic: symbol,
      label: symbol,
      category: 'forex',
      pipSize: 0.0001,
      minPositionSize: 1000,
    };
  }
  return found;
}

/**
 * Symbol map for the CapitalComAdapter: internal symbol → Capital.com epic.
 * Includes underscore-style aliases (e.g. EUR_USD → EURUSD) so legacy env
 * values continue to work.
 */
export const SYMBOL_MAP: Record<string, string> = {
  // Canonical entries derived from INSTRUMENTS
  ...Object.fromEntries(INSTRUMENTS.map((i) => [i.symbol, i.epic])),

  // Underscore-style aliases for instruments typically set in .env
  EUR_USD: 'EURUSD',
  GBP_USD: 'GBPUSD',
  USD_JPY: 'USDJPY',
  USD_CHF: 'USDCHF',
  AUD_USD: 'AUDUSD',
  USD_CAD: 'USDCAD',
  NZD_USD: 'NZDUSD',
  EUR_GBP: 'EURGBP',
  EUR_JPY: 'EURJPY',
  GBP_JPY: 'GBPJPY',
  XAG_USD: 'SILVER',
  XAUUSD: 'GOLD',    // no-underscore gold alias
};
