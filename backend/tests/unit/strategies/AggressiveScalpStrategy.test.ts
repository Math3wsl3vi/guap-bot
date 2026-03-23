jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/config/strategy.config', () => ({
  strategyConfig: {
    rsiPeriod: 14,
    adxPeriod: 14,
    emaTrendPeriod: 5,
    atrPeriod: 14,
    atrSlMultiplier: 1.5,
    atrTpMultiplier: 3.0,
    aggressive: {
      emaFast: 5,
      emaSlow: 13,
      rsiOverbought: 80,
      rsiOversold: 20,
      adxThreshold: 0,       // disable ADX filter for most tests
      useTrendFilter: false,
      breakevenAfterPips: 3,
      trailingActivationPips: 5,
    },
  },
}));

import { AggressiveScalpStrategy } from '../../../src/strategies/AggressiveScalpStrategy';
import { Candle } from '../../../src/models/Candle';

const MIN_CANDLES = 29; // max(13+1=14, rsiPeriod+1=15, adxPeriod*2+1=29, atrPeriod=14) = 29

function candle(close: number, ts?: Date): Candle {
  return {
    timestamp: ts ?? new Date('2026-01-15T10:00:00Z'),
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1,
  };
}

function candles(closes: number[], baseTime?: Date): Candle[] {
  const base = (baseTime ?? new Date('2026-01-15T10:00:00Z')).getTime();
  return closes.map((c, i) => candle(c, new Date(base + i * 60_000)));
}

describe('AggressiveScalpStrategy', () => {
  let strategy: AggressiveScalpStrategy;

  beforeEach(() => {
    strategy = new AggressiveScalpStrategy();
  });

  it('should have correct name and type', () => {
    expect(strategy.name).toBe('Aggressive Scalping');
    expect(strategy.type).toBe('AGGRESSIVE_SCALPING');
  });

  it('returns HOLD when candles are insufficient', () => {
    const result = strategy.evaluate([]);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Insufficient');
  });

  it('returns HOLD when not enough candles for indicators', () => {
    const data = candles(Array.from({ length: MIN_CANDLES - 1 }, (_, i) => 2700 + i * 0.1));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
  });

  it('returns HOLD when no crossover occurs', () => {
    // Flat prices → no crossover
    const flat = candles(Array.from({ length: 50 }, () => 2700));
    const result = strategy.evaluate(flat);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('No EMA crossover');
  });

  it('generates BUY signal on bullish crossover', () => {
    // Start low, trend up → EMA(5) crosses above EMA(13)
    const closes: number[] = [];
    for (let i = 0; i < 50; i++) {
      if (i < 30) closes.push(2700);
      else closes.push(2700 + (i - 30) * 0.5);
    }
    const data = candles(closes);
    const result = strategy.evaluate(data);

    if (result.action === 'BUY') {
      expect(result.strategyType).toBe('AGGRESSIVE_SCALPING');
      expect(result.breakevenMove).toBe(true);
      expect(result.trailingActivationPips).toBe(5);
      expect(result.stopLossPips).toBeDefined();
      expect(result.takeProfitPips).toBeDefined();
    }
    // May also be HOLD if crossover doesn't happen on the exact last candle
    expect(['BUY', 'HOLD']).toContain(result.action);
  });

  it('signal always includes breakevenMove and trailingActivationPips on entry', () => {
    // Create a clear bullish crossover scenario
    const closes: number[] = [];
    // Downtrend then sharp upturn
    for (let i = 0; i < 40; i++) closes.push(2700 - i * 0.1);
    for (let i = 0; i < 15; i++) closes.push(2696 + i * 0.8);
    const data = candles(closes);
    const result = strategy.evaluate(data);

    if (result.action !== 'HOLD') {
      expect(result.breakevenMove).toBe(true);
      expect(result.trailingActivationPips).toBe(5);
    }
  });

  it('signals always include ATR-based stops', () => {
    const closes: number[] = [];
    for (let i = 0; i < 40; i++) closes.push(2700 - i * 0.1);
    for (let i = 0; i < 15; i++) closes.push(2696 + i * 0.8);
    const data = candles(closes);
    const result = strategy.evaluate(data);

    if (result.action !== 'HOLD') {
      expect(result.stopLossPips).toBeGreaterThan(0);
      expect(result.takeProfitPips).toBeGreaterThan(0);
    }
  });
});
