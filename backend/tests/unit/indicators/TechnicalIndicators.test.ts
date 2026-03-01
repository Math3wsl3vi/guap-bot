import { TechnicalIndicators } from '../../../src/indicators/TechnicalIndicators';
import { generateCandles } from '../../helpers/mocks';

describe('TechnicalIndicators', () => {
  // ── EMA ────────────────────────────────────────────────────────────────────

  describe('calculateEMA()', () => {
    it('should return NaN for indices before the period', () => {
      const prices = [1, 2, 3, 4, 5];
      const ema = TechnicalIndicators.calculateEMA(prices, 3);

      expect(ema[0]).toBeNaN();
      expect(ema[1]).toBeNaN();
      expect(ema[2]).not.toBeNaN(); // First valid at index period-1
    });

    it('should seed EMA with SMA of first period values', () => {
      const prices = [10, 20, 30, 40, 50];
      const ema = TechnicalIndicators.calculateEMA(prices, 3);

      // SMA(10,20,30) = 20
      expect(ema[2]).toBe(20);
    });

    it('should apply EMA multiplier correctly', () => {
      const prices = [10, 20, 30, 40];
      const ema = TechnicalIndicators.calculateEMA(prices, 3);

      // k = 2 / (3 + 1) = 0.5
      // ema[2] = 20 (SMA seed)
      // ema[3] = 40 * 0.5 + 20 * 0.5 = 30
      expect(ema[3]).toBe(30);
    });

    it('should return all NaN when prices length < period', () => {
      const prices = [1, 2];
      const ema = TechnicalIndicators.calculateEMA(prices, 5);
      ema.forEach(v => expect(v).toBeNaN());
    });

    it('should throw when period <= 0', () => {
      expect(() => TechnicalIndicators.calculateEMA([1, 2, 3], 0)).toThrow();
      expect(() => TechnicalIndicators.calculateEMA([1, 2, 3], -1)).toThrow();
    });

    it('should return same-length array as input', () => {
      const prices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ema = TechnicalIndicators.calculateEMA(prices, 3);
      expect(ema.length).toBe(prices.length);
    });
  });

  // ── RSI ────────────────────────────────────────────────────────────────────

  describe('calculateRSI()', () => {
    it('should return NaN for the first period values', () => {
      const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
      const rsi = TechnicalIndicators.calculateRSI(prices, 14);

      for (let i = 0; i <= 13; i++) {
        expect(rsi[i]).toBeNaN();
      }
      expect(rsi[14]).not.toBeNaN();
    });

    it('should return 100 when all price changes are positive', () => {
      // Strictly increasing prices
      const prices = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
      const rsi = TechnicalIndicators.calculateRSI(prices, 5);

      // All gains, no losses → RSI = 100
      const validRsi = rsi.filter(v => !isNaN(v));
      validRsi.forEach(v => expect(v).toBeCloseTo(100, 1));
    });

    it('should return values between 0 and 100', () => {
      // Mixed prices
      const prices = [100, 102, 99, 103, 97, 105, 101, 98, 104, 100, 106, 99, 103, 97, 102, 100];
      const rsi = TechnicalIndicators.calculateRSI(prices, 5);

      rsi.filter(v => !isNaN(v)).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    it('should return same-length array as input', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
      const rsi = TechnicalIndicators.calculateRSI(prices, 14);
      expect(rsi.length).toBe(prices.length);
    });

    it('should throw when period <= 0', () => {
      expect(() => TechnicalIndicators.calculateRSI([1, 2, 3], 0)).toThrow();
    });
  });

  // ── ATR ────────────────────────────────────────────────────────────────────

  describe('calculateATR()', () => {
    it('should return NaN for the first (period - 1) values', () => {
      const candles = generateCandles(20, { basePrice: 2700 });
      const atr = TechnicalIndicators.calculateATR(candles, 5);

      for (let i = 0; i < 4; i++) {
        expect(atr[i]).toBeNaN();
      }
      expect(atr[4]).not.toBeNaN();
    });

    it('should return positive values after warmup', () => {
      const candles = generateCandles(30, { basePrice: 2700, spread: 1 });
      const atr = TechnicalIndicators.calculateATR(candles, 14);

      const valid = atr.filter(v => !isNaN(v));
      valid.forEach(v => expect(v).toBeGreaterThan(0));
    });

    it('should return same-length array as candles', () => {
      const candles = generateCandles(30, { basePrice: 2700 });
      const atr = TechnicalIndicators.calculateATR(candles, 14);
      expect(atr.length).toBe(candles.length);
    });

    it('should throw when period <= 0', () => {
      const candles = generateCandles(20);
      expect(() => TechnicalIndicators.calculateATR(candles, 0)).toThrow();
    });
  });

  // ── ADX ────────────────────────────────────────────────────────────────────

  describe('calculateADX()', () => {
    it('should require 2*period + 1 candles for valid ADX', () => {
      const candles = generateCandles(10, { basePrice: 2700 });
      const { adx } = TechnicalIndicators.calculateADX(candles, 14);
      // 10 < 2*14 + 1 = 29, so all NaN
      adx.forEach(v => expect(v).toBeNaN());
    });

    it('should produce valid ADX after sufficient candles', () => {
      const candles = generateCandles(50, { basePrice: 2700, spread: 2 });
      const { adx, plusDI, minusDI } = TechnicalIndicators.calculateADX(candles, 14);

      const validAdx = adx.filter(v => !isNaN(v));
      expect(validAdx.length).toBeGreaterThan(0);

      // ADX should be between 0 and 100
      validAdx.forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    it('should return +DI and -DI components', () => {
      const candles = generateCandles(50, { basePrice: 2700, spread: 2 });
      const { plusDI, minusDI } = TechnicalIndicators.calculateADX(candles, 14);

      expect(plusDI.length).toBe(candles.length);
      expect(minusDI.length).toBe(candles.length);
    });

    it('should throw when period <= 0', () => {
      const candles = generateCandles(30);
      expect(() => TechnicalIndicators.calculateADX(candles, 0)).toThrow();
    });
  });

  // ── MACD ───────────────────────────────────────────────────────────────────

  describe('calculateMACD()', () => {
    it('should return macd, signal, and histogram arrays', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
      const result = TechnicalIndicators.calculateMACD(prices);

      expect(result.macd.length).toBe(prices.length);
      expect(result.signal.length).toBe(prices.length);
      expect(result.histogram.length).toBe(prices.length);
    });

    it('should have NaN values before slow period', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      const result = TechnicalIndicators.calculateMACD(prices, 12, 26, 9);

      // MACD line first valid at index 25 (slowPeriod - 1)
      expect(result.macd[24]).toBeNaN();
      expect(result.macd[25]).not.toBeNaN();
    });

    it('should use default periods 12/26/9', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      const result = TechnicalIndicators.calculateMACD(prices);

      // Signal EMA needs signalPeriod (9) valid MACD values
      // First valid MACD at index 25, so signal first valid at 25 + 8 = 33
      expect(result.signal[32]).toBeNaN();
      expect(result.signal[33]).not.toBeNaN();
    });
  });
});
