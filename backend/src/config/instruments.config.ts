export interface InstrumentInfo {
  /** Internal symbol key used throughout the codebase and in .env */
  symbol: string;
  /** Capital.com epic (market identifier sent to the broker API) */
  epic: string;
  /** Human-readable display name */
  label: string;
  /** Market category for UI grouping */
  category: 'metals' | 'forex' | 'crypto' | 'synthetic';
  /**
   * Monetary value of 1 pip per 1 unit of the instrument (in account currency).
   * Used directly in the position sizing formula:
   *   units = riskAmount / (stopLossPips × pipSize)
   *
   * For quote-USD instruments (XAU/USD, EUR/USD) this equals the raw price increment.
   * For JPY pairs the value is approximate (assumes ~150 USDJPY).
   * For synthetic indices, pip size is 0.01 (1 pip = 0.01 price move).
   */
  pipSize: number;
  /** Broker minimum order size in units */
  minPositionSize: number;
  /**
   * When true, this is a Deriv synthetic index (algorithmic, 24/7, no real spread).
   * Used to skip spread filters, session filters, and market-closed handling.
   */
  isSynthetic?: boolean;
}

// minPositionSize = minimum stake in USD on Deriv (all instruments: $1 minimum)
export const INSTRUMENTS: InstrumentInfo[] = [
  // ── Metals ─────────────────────────────────────────────────────────────────
  { symbol: 'XAU_USD', epic: 'GOLD',   label: 'Gold (XAU/USD)',   category: 'metals', pipSize: 0.1,     minPositionSize: 1 },
  { symbol: 'XAG_USD', epic: 'SILVER', label: 'Silver (XAG/USD)', category: 'metals', pipSize: 0.01,    minPositionSize: 1 },

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

  // ── Crypto ─────────────────────────────────────────────────────────────────
  { symbol: 'BTCUSD',  epic: 'cryBTCUSD',  label: 'Bitcoin (BTC/USD)',   category: 'crypto', pipSize: 1,    minPositionSize: 1 },
  { symbol: 'ETHUSD',  epic: 'cryETHUSD',  label: 'Ethereum (ETH/USD)', category: 'crypto', pipSize: 0.1,  minPositionSize: 1 },
  { symbol: 'LTCUSD',  epic: 'cryLTCUSD',  label: 'Litecoin (LTC/USD)', category: 'crypto', pipSize: 0.01, minPositionSize: 1 },

  // ── Synthetic Indices (1-second tick) ──────────────────────────────────────
  { symbol: 'V10_1S',  epic: '1HZ10V',  label: 'Volatility 10 (1s)',  category: 'synthetic', pipSize: 0.001, minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V25_1S',  epic: '1HZ25V',  label: 'Volatility 25 (1s)',  category: 'synthetic', pipSize: 0.001, minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V50_1S',  epic: '1HZ50V',  label: 'Volatility 50 (1s)',  category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V75_1S',  epic: '1HZ75V',  label: 'Volatility 75 (1s)',  category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V100_1S', epic: '1HZ100V', label: 'Volatility 100 (1s)', category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },

  // ── Synthetic Indices (standard 2-second tick) ─────────────────────────────
  { symbol: 'V10',  epic: 'R_10',  label: 'Volatility 10',  category: 'synthetic', pipSize: 0.001, minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V25',  epic: 'R_25',  label: 'Volatility 25',  category: 'synthetic', pipSize: 0.001, minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V50',  epic: 'R_50',  label: 'Volatility 50',  category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V75',  epic: 'R_75',  label: 'Volatility 75',  category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },
  { symbol: 'V100', epic: 'R_100', label: 'Volatility 100',  category: 'synthetic', pipSize: 0.01,  minPositionSize: 0.5, isSynthetic: true },
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
