export interface MACDResult {
  /** MACD line: EMA(fast) - EMA(slow) */
  macd: number[];
  /** Signal line: EMA(signalPeriod) of MACD */
  signal: number[];
  /** Histogram: MACD - Signal */
  histogram: number[];
}

export class TechnicalIndicators {
  /**
   * Exponential Moving Average.
   * Returns an array of the same length as `prices`.
   * The first (period - 1) values are NaN (insufficient data).
   * Seeded from the SMA of the first `period` values, then applies
   * the standard EMA multiplier: k = 2 / (period + 1).
   */
  static calculateEMA(prices: number[], period: number): number[] {
    if (period <= 0) throw new Error('EMA period must be > 0');
    if (prices.length < period) return new Array(prices.length).fill(NaN);

    const k = 2 / (period + 1);
    const result: number[] = new Array(prices.length).fill(NaN);

    // Seed: SMA of first `period` values
    let seed = 0;
    for (let i = 0; i < period; i++) seed += prices[i];
    result[period - 1] = seed / period;

    for (let i = period; i < prices.length; i++) {
      result[i] = prices[i] * k + result[i - 1] * (1 - k);
    }

    return result;
  }
}
