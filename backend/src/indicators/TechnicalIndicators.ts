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

  /**
   * Relative Strength Index using Wilder's smoothed average (the standard).
   * Returns an array of the same length as `prices`.
   * The first `period` values are NaN.
   */
  static calculateRSI(prices: number[], period: number = 14): number[] {
    if (period <= 0) throw new Error('RSI period must be > 0');
    if (prices.length < period + 1) return new Array(prices.length).fill(NaN);

    const result: number[] = new Array(prices.length).fill(NaN);

    // Seed: average gain/loss over first `period` intervals
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const delta = prices[i] - prices[i - 1];
      if (delta > 0) avgGain += delta;
      else avgLoss += -delta;
    }
    avgGain /= period;
    avgLoss /= period;

    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    // Wilder's smoothing for subsequent values
    for (let i = period + 1; i < prices.length; i++) {
      const delta = prices[i] - prices[i - 1];
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? -delta : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return result;
  }

  /**
   * MACD with configurable periods (defaults: 12/26/9).
   * Returns arrays of the same length as `prices`; early values are NaN.
   */
  static calculateMACD(
    prices: number[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9,
  ): MACDResult {
    const emaFast = TechnicalIndicators.calculateEMA(prices, fastPeriod);
    const emaSlow = TechnicalIndicators.calculateEMA(prices, slowPeriod);

    // MACD line — only valid from index (slowPeriod - 1) onward
    const macdLine: number[] = new Array(prices.length).fill(NaN);
    for (let i = slowPeriod - 1; i < prices.length; i++) {
      if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
        macdLine[i] = emaFast[i] - emaSlow[i];
      }
    }

    // Extract valid MACD values and their original indices for signal EMA
    const validMacd: number[] = [];
    const validIndices: number[] = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (!isNaN(macdLine[i])) {
        validMacd.push(macdLine[i]);
        validIndices.push(i);
      }
    }

    const signalEMA = TechnicalIndicators.calculateEMA(validMacd, signalPeriod);

    // Map signal EMA back to original indices
    const signal: number[] = new Array(prices.length).fill(NaN);
    const histogram: number[] = new Array(prices.length).fill(NaN);
    for (let j = 0; j < validIndices.length; j++) {
      const idx = validIndices[j];
      if (!isNaN(signalEMA[j])) {
        signal[idx] = signalEMA[j];
        histogram[idx] = macdLine[idx] - signalEMA[j];
      }
    }

    return { macd: macdLine, signal, histogram };
  }
}
