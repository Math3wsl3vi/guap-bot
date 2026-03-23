jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/config/strategy.config', () => ({
  strategyConfig: {
    londonBreakout: {
      asianRangeStartHour: 0,
      asianRangeEndHour: 7,
      breakoutWindowEndHour: 10,
      minRangePips: 10,
      maxRangePips: 50,
      slRangeMultiplier: 0.5,
      tpRangeMultiplier: 1.5,
    },
  },
}));

import { LondonBreakoutStrategy } from '../../../src/strategies/LondonBreakoutStrategy';
import { Candle } from '../../../src/models/Candle';

// pipSize=0.01 (default).  30 pips = $0.30 range.
// Asian range: high=2700.20, low=2699.90 → 30 pips (within 10-50 limit).

const ASIAN_HIGH = 2700.20;
const ASIAN_LOW  = 2699.90;
const RANGE_PIPS = (ASIAN_HIGH - ASIAN_LOW) / 0.01; // 30

function candle(close: number, ts: Date, high?: number, low?: number): Candle {
  return {
    timestamp: ts,
    open: close,
    high: high ?? close + 0.02,
    low: low ?? close - 0.02,
    close,
    volume: 1,
  };
}

/** Build 1 candle per hour for the Asian session (00:00-06:59 UTC). */
function buildAsianCandles(date: string, high = ASIAN_HIGH, low = ASIAN_LOW): Candle[] {
  const data: Candle[] = [];
  for (let h = 0; h < 7; h++) {
    const ts = new Date(`${date}T${String(h).padStart(2, '0')}:30:00Z`);
    const mid = (high + low) / 2;
    data.push(candle(mid, ts, high, low));
  }
  return data;
}

describe('LondonBreakoutStrategy', () => {
  let strategy: LondonBreakoutStrategy;

  beforeEach(() => {
    strategy = new LondonBreakoutStrategy();
  });

  it('should have correct name and type', () => {
    expect(strategy.name).toBe('London Breakout');
    expect(strategy.type).toBe('LONDON_BREAKOUT');
  });

  it('returns HOLD with insufficient candles', () => {
    const result = strategy.evaluate([candle(2700, new Date('2026-01-15T08:00:00Z'))]);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Insufficient');
  });

  it('returns HOLD during Asian session (building range)', () => {
    const data = [
      candle(2700, new Date('2026-01-15T03:00:00Z')),
      candle(2701, new Date('2026-01-15T03:01:00Z')),
    ];
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Building Asian session range');
  });

  it('returns BUY when price breaks above Asian high during entry window', () => {
    const data = buildAsianCandles('2026-01-15');
    // Entry window candle: price breaks above ASIAN_HIGH
    data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-15T07:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('BUY');
    expect(result.reason).toContain('Breakout above');
    expect(result.stopLossPips).toBeDefined();
    expect(result.takeProfitPips).toBeDefined();
    expect(result.strategyType).toBe('LONDON_BREAKOUT');
  });

  it('returns SELL when price breaks below Asian low during entry window', () => {
    const data = buildAsianCandles('2026-01-15');
    // Entry window candle: price breaks below ASIAN_LOW
    data.push(candle(ASIAN_LOW - 0.10, new Date('2026-01-15T07:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('SELL');
    expect(result.reason).toContain('Breakout below');
    expect(result.strategyType).toBe('LONDON_BREAKOUT');
  });

  it('returns HOLD when price stays within Asian range during entry window', () => {
    const data = buildAsianCandles('2026-01-15');
    // Price inside range
    const mid = (ASIAN_HIGH + ASIAN_LOW) / 2;
    data.push(candle(mid, new Date('2026-01-15T08:00:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Waiting for breakout');
  });

  it('only allows one trade per day', () => {
    const data = buildAsianCandles('2026-01-15');
    // First breakout
    data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-15T07:30:00Z')));
    const first = strategy.evaluate(data);
    expect(first.action).toBe('BUY');

    // Second breakout attempt same day
    data.push(candle(ASIAN_HIGH + 0.20, new Date('2026-01-15T08:00:00Z')));
    const second = strategy.evaluate(data);
    expect(second.action).toBe('HOLD');
    expect(second.reason).toContain('Already traded today');
  });

  it('returns HOLD outside entry window', () => {
    const data = buildAsianCandles('2026-01-15');
    // After entry window closes at 10:00
    data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-15T10:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Outside London breakout entry window');
  });

  it('resets state on new day', () => {
    const data = buildAsianCandles('2026-01-15');
    data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-15T07:30:00Z')));
    const day1 = strategy.evaluate(data);
    expect(day1.action).toBe('BUY');

    // Day 2 — should reset tradedToday
    const day2Data = [...data, ...buildAsianCandles('2026-01-16')];
    day2Data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-16T08:00:00Z')));
    const result = strategy.evaluate(day2Data);
    expect(result.action).toBe('BUY');
  });

  it('returns HOLD when Asian range is too narrow', () => {
    // Range of only 5 pips (0.05) → below minRangePips=10
    const data: Candle[] = [];
    for (let h = 0; h < 7; h++) {
      const ts = new Date(`2026-01-15T${String(h).padStart(2, '0')}:30:00Z`);
      data.push(candle(2700, ts, 2700.03, 2699.98)); // 5 pips
    }
    data.push(candle(2700.10, new Date('2026-01-15T07:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('too narrow');
  });

  it('returns HOLD when Asian range is too wide', () => {
    // Range of 100 pips (1.00) → above maxRangePips=50
    const data: Candle[] = [];
    for (let h = 0; h < 7; h++) {
      const ts = new Date(`2026-01-15T${String(h).padStart(2, '0')}:30:00Z`);
      data.push(candle(2700, ts, 2700.60, 2699.40)); // 120 pips
    }
    data.push(candle(2701, new Date('2026-01-15T07:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('too wide');
  });

  it('computes SL/TP from range width and multipliers', () => {
    const data = buildAsianCandles('2026-01-15');
    data.push(candle(ASIAN_HIGH + 0.10, new Date('2026-01-15T07:30:00Z')));

    const result = strategy.evaluate(data);
    expect(result.action).toBe('BUY');
    // Range = 30 pips
    // SL = 30 * 0.5 = 15 pips, TP = 30 * 1.5 = 45 pips
    expect(result.stopLossPips).toBeCloseTo(RANGE_PIPS * 0.5, 0);
    expect(result.takeProfitPips).toBeCloseTo(RANGE_PIPS * 1.5, 0);
  });
});
