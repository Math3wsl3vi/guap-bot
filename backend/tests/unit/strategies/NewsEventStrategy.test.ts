jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStrategyConfig = {
  atrPeriod: 5,
  newsEvent: {
    blackoutMinutesBefore: 5,
    entryWindowMinutesAfter: 3,
    minImpulseBodyPips: 10,
    atrSlMultiplier: 2.0,
    atrTpMultiplier: 3.0,
    scheduledEvents: [] as string[],
  },
};

jest.mock('../../../src/config/strategy.config', () => ({
  strategyConfig: mockStrategyConfig,
}));

import { NewsEventStrategy } from '../../../src/strategies/NewsEventStrategy';
import { Candle } from '../../../src/models/Candle';

function candle(close: number, ts: Date, open?: number): Candle {
  const o = open ?? close;
  return {
    timestamp: ts,
    open: o,
    high: Math.max(o, close) + 0.5,
    low: Math.min(o, close) - 0.5,
    close,
    volume: 1,
  };
}

function makeCandles(count: number, close: number, baseTime: Date): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i < count; i++) {
    result.push(candle(close + (i % 3) * 0.1, new Date(baseTime.getTime() + i * 60_000)));
  }
  return result;
}

describe('NewsEventStrategy', () => {
  beforeEach(() => {
    mockStrategyConfig.newsEvent.scheduledEvents = [];
  });

  it('should have correct name and type', () => {
    const strategy = new NewsEventStrategy();
    expect(strategy.name).toBe('News Event');
    expect(strategy.type).toBe('NEWS_EVENT');
  });

  it('returns HOLD when no events are scheduled', () => {
    const strategy = new NewsEventStrategy();
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:00:00Z'));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('No news events scheduled');
  });

  it('returns HOLD when candles are insufficient', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    const data = [candle(2700, new Date('2026-01-15T14:28:00Z'))];
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('Insufficient');
  });

  it('returns HOLD during blackout window', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    // 3 minutes before event → within 5-minute blackout
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:20:00Z'));
    // Last candle at 14:27 → 3 min before 14:30
    data.push(candle(2700, new Date('2026-01-15T14:27:00Z')));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('blackout');
  });

  it('returns BUY on strong bullish impulse after event', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    // Build warmup candles before event
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:19:00Z'));
    // Candle right after event with strong bullish body (open=2700, close=2702 → 200 pips at 0.01)
    data.push(candle(2702, new Date('2026-01-15T14:31:00Z'), 2700));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('BUY');
    expect(result.strategyType).toBe('NEWS_EVENT');
    expect(result.stopLossPips).toBeGreaterThan(0);
    expect(result.takeProfitPips).toBeGreaterThan(0);
  });

  it('returns SELL on strong bearish impulse after event', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:19:00Z'));
    // Strong bearish: open=2700, close=2698 → 200 pips
    data.push(candle(2698, new Date('2026-01-15T14:31:00Z'), 2700));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('SELL');
    expect(result.strategyType).toBe('NEWS_EVENT');
  });

  it('returns HOLD when impulse candle body is too small', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:19:00Z'));
    // Tiny body: open=2700, close=2700.05 → 5 pips (< 10 min)
    data.push(candle(2700.05, new Date('2026-01-15T14:31:00Z'), 2700));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('impulse too small');
  });

  it('returns HOLD outside any event window', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['14:30'];
    const strategy = new NewsEventStrategy();
    // 2 hours after event → outside entry window
    const data = makeCandles(10, 2700, new Date('2026-01-15T16:20:00Z'));
    data.push(candle(2705, new Date('2026-01-15T16:30:00Z'), 2700));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('No active news event window');
  });

  it('handles ISO datetime events', () => {
    mockStrategyConfig.newsEvent.scheduledEvents = ['2026-01-15T14:30:00Z'];
    const strategy = new NewsEventStrategy();
    const data = makeCandles(10, 2700, new Date('2026-01-15T14:19:00Z'));
    data.push(candle(2702, new Date('2026-01-15T14:31:00Z'), 2700));
    const result = strategy.evaluate(data);
    expect(result.action).toBe('BUY');
  });
});
