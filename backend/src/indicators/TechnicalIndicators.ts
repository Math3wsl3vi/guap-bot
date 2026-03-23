export interface BollingerBandsResult {
  /** Upper band: SMA + stdDev × multiplier */
  upper: number[];
  /** Middle band: Simple Moving Average */
  middle: number[];
  /** Lower band: SMA - stdDev × multiplier */
  lower: number[];
}

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
   * Average True Range (ATR) using Wilder's smoothing.
   * Accepts an array of OHLC candle objects (only high, low, close are used).
   * Returns an array of the same length as `candles`.
   * The first (period - 1) values are NaN.
   */
  static calculateATR(
    candles: readonly { high: number; low: number; close: number }[],
    period: number = 14,
  ): number[] {
    if (period <= 0) throw new Error('ATR period must be > 0');
    const n = candles.length;
    if (n < period + 1) return new Array(n).fill(NaN);

    // True Range: max of (H-L), |H-prevClose|, |L-prevClose|
    const tr: number[] = new Array(n).fill(NaN);
    tr[0] = candles[0].high - candles[0].low;
    for (let i = 1; i < n; i++) {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      tr[i] = Math.max(hl, hc, lc);
    }

    const result: number[] = new Array(n).fill(NaN);
    // Seed: SMA of first `period` TRs (bars 0..period-1)
    let seed = 0;
    for (let i = 0; i < period; i++) seed += tr[i];
    result[period - 1] = seed / period;

    // Wilder's smoothing: ATR[i] = (ATR[i-1] * (period-1) + TR[i]) / period
    for (let i = period; i < n; i++) {
      result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
    }

    return result;
  }

  /**
   * Average Directional Index (ADX) with +DI and -DI components.
   * Uses Wilder's smoothing throughout.
   * Requires at least 2×period + 1 candles for the first valid ADX value.
   * Returns NaN-filled arrays when data is insufficient.
   */
  static calculateADX(
    candles: readonly { high: number; low: number; close: number }[],
    period: number = 14,
  ): { plusDI: number[]; minusDI: number[]; adx: number[] } {
    if (period <= 0) throw new Error('ADX period must be > 0');
    const n = candles.length;
    const empty = () => new Array(n).fill(NaN);
    if (n < period * 2 + 1) return { plusDI: empty(), minusDI: empty(), adx: empty() };

    const plusDI: number[] = new Array(n).fill(NaN);
    const minusDI: number[] = new Array(n).fill(NaN);
    const adx: number[] = new Array(n).fill(NaN);

    // Raw directional movements and True Range indexed by candle pair.
    // rawXxx[j] corresponds to candles[j + 1] (we start from bar 1).
    const rawTR: number[] = new Array(n - 1).fill(0);
    const rawPDM: number[] = new Array(n - 1).fill(0);
    const rawMDM: number[] = new Array(n - 1).fill(0);

    for (let i = 1; i < n; i++) {
      const upMove = candles[i].high - candles[i - 1].high;
      const dnMove = candles[i - 1].low - candles[i].low;
      rawPDM[i - 1] = upMove > dnMove && upMove > 0 ? upMove : 0;
      rawMDM[i - 1] = dnMove > upMove && dnMove > 0 ? dnMove : 0;

      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      rawTR[i - 1] = Math.max(hl, hc, lc);
    }

    // Seed Wilder's smoothed values from raw[0..period-1]
    let sTR = rawTR.slice(0, period).reduce((a, b) => a + b, 0);
    let sPDM = rawPDM.slice(0, period).reduce((a, b) => a + b, 0);
    let sMDM = rawMDM.slice(0, period).reduce((a, b) => a + b, 0);

    const toDI = (pdm: number, mdm: number, tRng: number) => ({
      pdi: tRng > 0 ? (100 * pdm) / tRng : 0,
      mdi: tRng > 0 ? (100 * mdm) / tRng : 0,
    });
    const toDX = (pdi: number, mdi: number) =>
      pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;

    // First DI at candle index `period` (seed uses raw[0..period-1] = candles 1..period)
    let { pdi, mdi } = toDI(sPDM, sMDM, sTR);
    plusDI[period] = pdi;
    minusDI[period] = mdi;

    // Collect DX values; once we have `period` of them, seed ADX as their SMA
    const dxSeed: number[] = [toDX(pdi, mdi)];

    // j is the raw array index; candle index = j + 1
    for (let j = period; j < rawTR.length; j++) {
      sTR = sTR - sTR / period + rawTR[j];
      sPDM = sPDM - sPDM / period + rawPDM[j];
      sMDM = sMDM - sMDM / period + rawMDM[j];
      ({ pdi, mdi } = toDI(sPDM, sMDM, sTR));

      plusDI[j + 1] = pdi;
      minusDI[j + 1] = mdi;
      const dx = toDX(pdi, mdi);

      if (dxSeed.length < period) {
        dxSeed.push(dx);
        if (dxSeed.length === period) {
          // Seed ADX as SMA of the first `period` DX values
          adx[j + 1] = dxSeed.reduce((a, b) => a + b, 0) / period;
        }
      } else {
        // Wilder's smoothing for subsequent ADX values
        adx[j + 1] = (adx[j] * (period - 1) + dx) / period;
      }
    }

    return { plusDI, minusDI, adx };
  }

  /**
   * Bollinger Bands using a rolling SMA and standard deviation.
   * Returns arrays of the same length as `prices`.
   * The first (period - 1) values are NaN.
   */
  static calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2.0,
  ): BollingerBandsResult {
    if (period <= 0) throw new Error('Bollinger Bands period must be > 0');
    const n = prices.length;
    if (n < period) {
      return {
        upper: new Array(n).fill(NaN),
        middle: new Array(n).fill(NaN),
        lower: new Array(n).fill(NaN),
      };
    }

    const upper: number[] = new Array(n).fill(NaN);
    const middle: number[] = new Array(n).fill(NaN);
    const lower: number[] = new Array(n).fill(NaN);

    for (let i = period - 1; i < n; i++) {
      // SMA over window [i - period + 1 .. i]
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += prices[j];
      const sma = sum / period;

      // Standard deviation over the same window
      let sqSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = prices[j] - sma;
        sqSum += diff * diff;
      }
      const stdDev = Math.sqrt(sqSum / period);

      middle[i] = sma;
      upper[i] = sma + stdDevMultiplier * stdDev;
      lower[i] = sma - stdDevMultiplier * stdDev;
    }

    return { upper, middle, lower };
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
