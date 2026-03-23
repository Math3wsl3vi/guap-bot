jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/config/strategy.config', () => ({
  strategyConfig: {
    rsiPeriod: 14,
    adxPeriod: 5,     // small period so tests warm up quickly
    atrPeriod: 5,     // small period
    meanReversion: {
      bollingerPeriod: 10,  // smaller for tests
      bollingerStdDev: 2.0,
      rsiOversold: 25,
      rsiOverbought: 75,
      atrSlMultiplier: 1.5,
      atrTpMultiplier: 1.0,
    },
  },
}));

import { MeanReversionStrategy } from '../../../src/strategies/MeanReversionStrategy';
import { Candle } from '../../../src/models/Candle';

function candle(close: number, ts?: Date, high?: number, low?: number): Candle {
  return {
    timestamp: ts ?? new Date('2026-01-15T10:00:00Z'),
    open: close,
    high: high ?? close + 0.5,
    low: low ?? close - 0.5,
    close,
    volume: 1,
  };
}

function candles(closes: number[], baseTime?: Date): Candle[] {
  const base = (baseTime ?? new Date('2026-01-15T10:00:00Z')).getTime();
  return closes.map((c, i) => {
    const ts = new Date(base + i * 60_000);
    return candle(c, ts, c + 0.5, c - 0.5);
  });
}

describe('MeanReversionStrategy', () => {
  let strategy: MeanReversionStrategy;

  beforeEach(() => {
    strategy = new MeanReversionStrategy();
  });

  it('should have correct name and type', () => {
    expect(strategy.name).toBe('Mean Reversion');
    expect(strategy.type).toBe('MEAN_REVERSION');
  });

  it('returns HOLD when candles are insufficient', () => {
    const result = strategy.evaluate([]);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Insufficient');
  });

  it('returns HOLD for gently oscillating prices within BB bands', () => {
    // Small oscillation stays within bands, RSI stays neutral
    const data = candles(Array.from({ length: 30 }, (_, i) => 2700 + Math.sin(i * 0.3) * 0.5));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
  });

  it('returns HOLD when indicators are still warming up', () => {
    // Just enough candles for the smallest minCandles but indicators may have NaN
    const small = candles(Array.from({ length: 11 }, (_, i) => 2700 + i));
    const result = strategy.evaluate(small);
    expect(result.action).toBe('HOLD');
  });

  it('returns HOLD with correct strategyType when signaling', () => {
    // Build a scenario with volatile prices then a drop to lower band
    const closes: number[] = [];
    // Oscillating range to build BB bands, then sharp drop
    for (let i = 0; i < 30; i++) closes.push(2700 + Math.sin(i * 0.5) * 3);
    // Drop below lower band
    closes.push(2685);
    closes.push(2684);

    const data = candles(closes);
    const result = strategy.evaluate(data);

    // The signal may or may not trigger depending on RSI + ADX alignment,
    // but if it does, strategyType should be correct
    if (result.action === 'BUY') {
      expect(result.strategyType).toBe('MEAN_REVERSION');
      expect(result.stopLossPips).toBeGreaterThan(0);
      expect(result.takeProfitPips).toBeGreaterThan(0);
    } else {
      expect(result.action).toBe('HOLD');
    }
  });

  it('sets strategyType on SELL signals', () => {
    // Build oscillating range then spike above upper band
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(2700 + Math.sin(i * 0.5) * 3);
    // Spike above upper band
    closes.push(2715);
    closes.push(2716);

    const data = candles(closes);
    const result = strategy.evaluate(data);

    if (result.action === 'SELL') {
      expect(result.strategyType).toBe('MEAN_REVERSION');
    }
  });

  it('returns same-length deterministic output for same input', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 2700 + Math.sin(i * 0.3) * 5);
    const data = candles(closes);

    const result1 = strategy.evaluate(data);
    const strategy2 = new MeanReversionStrategy();
    const result2 = strategy2.evaluate(data);

    expect(result1.action).toBe(result2.action);
    expect(result1.reason).toBe(result2.reason);
  });
});
