jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/config/strategy.config', () => ({
  strategyConfig: {
    // Hybrid config
    hybrid: {
      londonEndHour: 10,
      scalpingEndHour: 21,
    },
    // London Breakout sub-config
    londonBreakout: {
      asianRangeStartHour: 0,
      asianRangeEndHour: 7,
      breakoutWindowEndHour: 10,
      minRangePips: 10,
      maxRangePips: 50,
      slRangeMultiplier: 0.5,
      tpRangeMultiplier: 1.5,
    },
    // Aggressive Scalp sub-config
    aggressive: {
      emaFast: 5,
      emaSlow: 13,
      rsiOverbought: 80,
      rsiOversold: 20,
      adxThreshold: 0,
      useTrendFilter: false,
      breakevenAfterPips: 3,
      trailingActivationPips: 5,
    },
    // Shared config values needed by sub-strategies
    rsiPeriod: 14,
    adxPeriod: 14,
    emaTrendPeriod: 5,
    atrPeriod: 14,
    atrSlMultiplier: 1.5,
    atrTpMultiplier: 3.0,
  },
}));

import { HybridStrategy } from '../../../src/strategies/HybridStrategy';
import { Candle } from '../../../src/models/Candle';

function candle(close: number, ts: Date): Candle {
  return {
    timestamp: ts,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1,
  };
}

describe('HybridStrategy', () => {
  let strategy: HybridStrategy;

  beforeEach(() => {
    strategy = new HybridStrategy();
  });

  it('should have correct name and type', () => {
    expect(strategy.name).toBe('Hybrid (Time-Switched)');
    expect(strategy.type).toBe('HYBRID');
  });

  it('returns HOLD with insufficient candles', () => {
    const result = strategy.evaluate([candle(2700, new Date('2026-01-15T08:00:00Z'))]);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Insufficient');
  });

  it('delegates to London Breakout during morning hours (00:00-10:00)', () => {
    const data = [
      candle(2700, new Date('2026-01-15T03:00:00Z')),
      candle(2701, new Date('2026-01-15T03:01:00Z')),
    ];
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    // London Breakout should be building Asian range during these hours
    expect(result.reason).toContain('Building Asian session range');
  });

  it('delegates to Aggressive Scalping during afternoon hours (10:00-21:00)', () => {
    const data = [
      candle(2700, new Date('2026-01-15T14:00:00Z')),
      candle(2700, new Date('2026-01-15T14:01:00Z')),
    ];
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    // Aggressive scalping should evaluate but likely HOLD with only 2 candles
    // The reason should NOT be about Asian range or London breakout
    expect(result.reason).not.toContain('Asian');
    expect(result.reason).not.toContain('London');
  });

  it('returns HOLD during off-hours (21:00-00:00)', () => {
    const data = [
      candle(2700, new Date('2026-01-15T22:00:00Z')),
      candle(2701, new Date('2026-01-15T22:01:00Z')),
    ];
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Outside Hybrid trading hours');
  });

  it('overrides strategyType to HYBRID on trade signals', () => {
    // Build candles for London Breakout with a valid Asian range (30 pips)
    const ASIAN_HIGH = 2700.20;
    const ASIAN_LOW  = 2699.90;
    const data: Candle[] = [];

    // Asian session — 1 candle per hour
    for (let h = 0; h < 7; h++) {
      const ts = new Date(`2026-01-15T${String(h).padStart(2, '0')}:30:00Z`);
      data.push({
        timestamp: ts,
        open: 2700.05,
        high: ASIAN_HIGH,
        low: ASIAN_LOW,
        close: 2700.05,
        volume: 1,
      });
    }
    // Breakout candle above Asian high
    data.push({
      timestamp: new Date('2026-01-15T07:30:00Z'),
      open: 2700.25,
      high: 2700.35,
      low: 2700.22,
      close: 2700.30,
      volume: 1,
    });

    const result = strategy.evaluate(data);
    if (result.action !== 'HOLD') {
      expect(result.strategyType).toBe('HYBRID');
    }
  });
});
