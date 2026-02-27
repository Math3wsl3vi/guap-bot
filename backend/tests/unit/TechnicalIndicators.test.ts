import { TechnicalIndicators } from '../../src/indicators/TechnicalIndicators';

describe('TechnicalIndicators', () => {
  // ─── EMA ─────────────────────────────────────────────────────────────────

  describe('calculateEMA', () => {
    it('returns an array of the same length as input', () => {
      expect(TechnicalIndicators.calculateEMA([1, 2, 3, 4, 5], 3)).toHaveLength(5);
    });

    it('fills values before the seed index with NaN', () => {
      const result = TechnicalIndicators.calculateEMA([1, 2, 3, 4, 5], 3);
      expect(isNaN(result[0])).toBe(true);
      expect(isNaN(result[1])).toBe(true);
      expect(isNaN(result[2])).toBe(false); // seed at index period-1
    });

    it('seeds with the SMA of the first `period` values', () => {
      // SMA([1, 2, 3]) = 2
      const result = TechnicalIndicators.calculateEMA([1, 2, 3, 4, 5], 3);
      expect(result[2]).toBe(2);
    });

    it('applies the EMA multiplier k = 2/(period+1) correctly', () => {
      // period=3 → k=0.5
      // result[2]=2 (seed), result[3]=4*0.5 + 2*0.5=3, result[4]=5*0.5 + 3*0.5=4
      const result = TechnicalIndicators.calculateEMA([1, 2, 3, 4, 5], 3);
      expect(result[3]).toBe(3);
      expect(result[4]).toBe(4);
    });

    it('period=1 makes every EMA value equal its price (k=1)', () => {
      const prices = [5, 10, 15, 20];
      const result = TechnicalIndicators.calculateEMA(prices, 1);
      prices.forEach((p, i) => expect(result[i]).toBe(p));
    });

    it('returns all NaN when prices.length < period', () => {
      const result = TechnicalIndicators.calculateEMA([1, 2], 5);
      result.forEach((v) => expect(isNaN(v)).toBe(true));
    });

    it('returns an empty array for empty input', () => {
      expect(TechnicalIndicators.calculateEMA([], 5)).toHaveLength(0);
    });

    it('throws for period <= 0', () => {
      expect(() => TechnicalIndicators.calculateEMA([1, 2, 3], 0)).toThrow();
      expect(() => TechnicalIndicators.calculateEMA([1, 2, 3], -1)).toThrow();
    });

    it('returns the flat price for every valid slot when all prices are equal', () => {
      const prices = new Array(30).fill(100);
      const result = TechnicalIndicators.calculateEMA(prices, 9);
      for (let i = 8; i < prices.length; i++) {
        expect(result[i]).toBeCloseTo(100, 10);
      }
    });

    it('fast EMA tracks price more closely than slow EMA in a trend', () => {
      // Uptrend: fast EMA should be closer to the latest price than slow EMA
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
      const ema21 = TechnicalIndicators.calculateEMA(prices, 21);
      const lastPrice = prices[49];
      expect(Math.abs(ema9[49] - lastPrice)).toBeLessThan(Math.abs(ema21[49] - lastPrice));
    });
  });

  // ─── RSI ─────────────────────────────────────────────────────────────────

  describe('calculateRSI', () => {
    it('returns an array of the same length as input', () => {
      const prices = Array.from({ length: 20 }, (_, i) => i);
      expect(TechnicalIndicators.calculateRSI(prices, 14)).toHaveLength(20);
    });

    it('fills the first `period` values with NaN', () => {
      const prices = Array.from({ length: 20 }, (_, i) => i);
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      for (let i = 0; i < 14; i++) {
        expect(isNaN(result[i])).toBe(true);
      }
      expect(isNaN(result[14])).toBe(false);
    });

    it('returns 100 for a pure uptrend (no losses)', () => {
      const prices = Array.from({ length: 20 }, (_, i) => i);
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      expect(result[14]).toBe(100);
    });

    it('returns 0 for a pure downtrend (no gains)', () => {
      const prices = Array.from({ length: 20 }, (_, i) => 20 - i);
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      expect(result[14]).toBe(0);
    });

    it('returns 50 for equal gains and losses (alternating +1 / -1)', () => {
      // 15 prices: alternating 0/1. Seed period=14 → 7 gains, 7 losses → avgGain=avgLoss=0.5
      const prices = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 0 : 1));
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      expect(result[14]).toBeCloseTo(50, 5);
    });

    it('stays within [0, 100] for all valid values on a price series', () => {
      const prices: number[] = [100];
      for (let i = 1; i < 50; i++) {
        prices.push(Math.max(1, prices[i - 1] + Math.sin(i * 1.7) * 5));
      }
      TechnicalIndicators.calculateRSI(prices, 14).forEach((v) => {
        if (!isNaN(v)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      });
    });

    it('returns all NaN when prices.length < period + 1', () => {
      TechnicalIndicators.calculateRSI([1, 2, 3], 14).forEach((v) =>
        expect(isNaN(v)).toBe(true),
      );
    });

    it('throws for period <= 0', () => {
      expect(() => TechnicalIndicators.calculateRSI([1, 2, 3], 0)).toThrow();
    });

    it('correctly applies Wilder smoothing after the seed index', () => {
      // Alternating series seeded at RSI=50, then one gain → RSI increases
      const prices: number[] = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 0 : 1));
      prices.push(2); // index 15: gain of 1 from price 1

      const result = TechnicalIndicators.calculateRSI(prices, 14);
      expect(result[14]).toBeCloseTo(50, 4);

      // prices[14]=0, prices[15]=2 → gain = 2
      // Wilder: avgGain = (0.5*13 + 2)/14, avgLoss = (0.5*13 + 0)/14
      const avgGain = (0.5 * 13 + 2) / 14;
      const avgLoss = (0.5 * 13) / 14;
      const expected = 100 - 100 / (1 + avgGain / avgLoss);
      expect(result[15]).toBeCloseTo(expected, 4);
    });

    it('RSI increases after a gain from a neutral baseline', () => {
      const prices: number[] = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 0 : 1));
      prices.push(2); // gain
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      expect(result[15]).toBeGreaterThan(result[14]);
    });

    it('RSI decreases after a loss from a neutral baseline', () => {
      const prices = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 1 : 0));
      prices.push(0); // loss from 1 to 0... wait prices[14]=1, prices[15]=0 means loss
      // Actually: series starts at 1,0,1,0,... prices[14]=1, push 0 → loss
      const result = TechnicalIndicators.calculateRSI(prices, 14);
      // Seed at index 14: equal gains/losses → 50
      expect(result[14]).toBeCloseTo(50, 4);
      expect(result[15]).toBeLessThan(result[14]);
    });
  });

  // ─── MACD ────────────────────────────────────────────────────────────────

  describe('calculateMACD', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.4) * 10);

    it('returns macd/signal/histogram arrays of the same length as input', () => {
      const result = TechnicalIndicators.calculateMACD(prices);
      expect(result.macd).toHaveLength(prices.length);
      expect(result.signal).toHaveLength(prices.length);
      expect(result.histogram).toHaveLength(prices.length);
    });

    it('MACD line is NaN for indices before slowPeriod - 1', () => {
      const result = TechnicalIndicators.calculateMACD(prices, 12, 26, 9);
      for (let i = 0; i < 25; i++) {
        expect(isNaN(result.macd[i])).toBe(true);
      }
      expect(isNaN(result.macd[25])).toBe(false);
    });

    it('histogram equals macd minus signal for every valid value', () => {
      const result = TechnicalIndicators.calculateMACD(prices, 12, 26, 9);
      for (let i = 0; i < prices.length; i++) {
        if (!isNaN(result.histogram[i])) {
          expect(result.histogram[i]).toBeCloseTo(result.macd[i] - result.signal[i], 10);
        }
      }
    });

    it('produces at least some valid histogram values with sufficient data', () => {
      const longPrices = Array.from({ length: 100 }, (_, i) => 100 + i * 0.1);
      const result = TechnicalIndicators.calculateMACD(longPrices, 12, 26, 9);
      const valid = result.histogram.filter((v) => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
    });

    it('respects custom fast/slow/signal periods', () => {
      const result = TechnicalIndicators.calculateMACD(prices, 5, 10, 3);
      // slow=10 → MACD valid from index 9
      expect(isNaN(result.macd[8])).toBe(true);
      expect(isNaN(result.macd[9])).toBe(false);
    });

    it('MACD is zero for a flat price series', () => {
      const flatPrices = new Array(60).fill(200);
      const result = TechnicalIndicators.calculateMACD(flatPrices);
      for (let i = 25; i < flatPrices.length; i++) {
        if (!isNaN(result.macd[i])) {
          expect(result.macd[i]).toBeCloseTo(0, 8);
        }
      }
    });
  });
});
