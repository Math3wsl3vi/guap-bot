import { TimeframeAggregator } from '../../../src/services/TimeframeAggregator';
import { Candle, Timeframe } from '../../../src/models/Candle';
import { generateCandles } from '../../helpers/mocks';

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

/** Create a single candle at a specific minute offset from a base time. */
function candle(minuteOffset: number, price: number, baseTime = new Date('2026-01-15T10:00:00Z')): Candle {
  return {
    timestamp: new Date(baseTime.getTime() + minuteOffset * 60_000),
    open: price,
    high: price + 0.5,
    low: price - 0.5,
    close: price + 0.1,
    volume: 10,
  };
}

describe('TimeframeAggregator', () => {
  let aggregator: TimeframeAggregator;

  beforeEach(() => {
    aggregator = new TimeframeAggregator();
  });

  describe('5m aggregation', () => {
    it('should close a 5m bar after 5 one-minute candles', () => {
      const emitted: Candle[] = [];
      aggregator.on('candle:close:5m', (c: Candle) => emitted.push(c));

      // Feed 5 candles at minutes 0-4 (10:00 - 10:04) — all belong to same 5m interval
      for (let i = 0; i < 5; i++) {
        aggregator.onCandleClose(candle(i, 2700 + i));
      }

      // No 5m candle yet — the bar hasn't closed until a candle from the next interval arrives
      expect(emitted).toHaveLength(0);

      // Feed minute 5 (10:05) — new 5m interval, closes the previous one
      aggregator.onCandleClose(candle(5, 2705));
      expect(emitted).toHaveLength(1);

      const bar = emitted[0];
      expect(bar.timestamp).toEqual(new Date('2026-01-15T10:00:00Z'));
      expect(bar.open).toBe(2700);        // open of first 1m candle
      expect(bar.close).toBe(2704.1);     // close of last 1m candle (2704 + 0.1)
      expect(bar.high).toBeGreaterThanOrEqual(2704.5); // max high across all 5 candles
      expect(bar.low).toBeLessThanOrEqual(2699.5);     // min low across all 5 candles
    });

    it('should accumulate volume across 1m candles', () => {
      const emitted: Candle[] = [];
      aggregator.on('candle:close:5m', (c: Candle) => emitted.push(c));

      for (let i = 0; i < 6; i++) {
        aggregator.onCandleClose(candle(i, 2700));
      }

      expect(emitted).toHaveLength(1);
      // 5 candles × 10 volume each = 50
      expect(emitted[0].volume).toBe(50);
    });
  });

  describe('15m aggregation', () => {
    it('should close a 15m bar after 15 one-minute candles', () => {
      const emitted: Candle[] = [];
      aggregator.on('candle:close:15m', (c: Candle) => emitted.push(c));

      // Feed 15 candles (10:00 - 10:14)
      for (let i = 0; i < 15; i++) {
        aggregator.onCandleClose(candle(i, 2700));
      }
      expect(emitted).toHaveLength(0);

      // Feed minute 15 (10:15) — closes the 10:00-10:14 bar
      aggregator.onCandleClose(candle(15, 2700));
      expect(emitted).toHaveLength(1);
      expect(emitted[0].timestamp).toEqual(new Date('2026-01-15T10:00:00Z'));
    });
  });

  describe('1h aggregation', () => {
    it('should close a 1h bar after 60 one-minute candles', () => {
      const emitted: Candle[] = [];
      aggregator.on('candle:close:1h', (c: Candle) => emitted.push(c));

      // Feed 60 candles (10:00 - 10:59)
      for (let i = 0; i < 60; i++) {
        aggregator.onCandleClose(candle(i, 2700));
      }
      expect(emitted).toHaveLength(0);

      // Feed minute 60 (11:00) — closes the 10:00 bar
      aggregator.onCandleClose(candle(60, 2700));
      expect(emitted).toHaveLength(1);
      expect(emitted[0].timestamp).toEqual(new Date('2026-01-15T10:00:00Z'));
    });
  });

  describe('multiple timeframes emit simultaneously', () => {
    it('should emit 5m and 15m at minute 15', () => {
      const emitted5m: Candle[] = [];
      const emitted15m: Candle[] = [];
      aggregator.on('candle:close:5m', (c: Candle) => emitted5m.push(c));
      aggregator.on('candle:close:15m', (c: Candle) => emitted15m.push(c));

      // Feed 16 candles — minutes 0..15
      for (let i = 0; i <= 15; i++) {
        aggregator.onCandleClose(candle(i, 2700));
      }

      // At minute 5, 10, 15 → 3 x 5m bars closed (bars at :00, :05, :10)
      expect(emitted5m).toHaveLength(3);
      // At minute 15 → 1 x 15m bar closed (bar at :00)
      expect(emitted15m).toHaveLength(1);
    });
  });

  describe('getCandles()', () => {
    it('should return completed candles for a timeframe', () => {
      // Feed 11 candles (minutes 0..10) — produces 2 completed 5m bars
      for (let i = 0; i <= 10; i++) {
        aggregator.onCandleClose(candle(i, 2700));
      }

      const candles5m = aggregator.getCandles('5m');
      expect(candles5m).toHaveLength(2);
    });

    it('should return empty for 1m (managed externally)', () => {
      expect(aggregator.getCandles('1m')).toHaveLength(0);
    });
  });

  describe('buildFromHistory()', () => {
    it('should build HTF windows from historical 1m candles without emitting events', () => {
      const listener = jest.fn();
      aggregator.on('candle:close:5m', listener);

      // Generate 30 candles (30 minutes of data)
      const historical = generateCandles(30);
      aggregator.buildFromHistory(historical);

      // Should NOT have emitted events during replay
      expect(listener).not.toHaveBeenCalled();

      // But should have built the 5m window (30 min / 5 = up to 5 closed bars + partial)
      const candles5m = aggregator.getCandles('5m');
      expect(candles5m.length).toBeGreaterThan(0);
      expect(candles5m.length).toBeLessThanOrEqual(6);
    });

    it('should restore listeners after buildFromHistory', () => {
      const listener = jest.fn();
      aggregator.on('candle:close:5m', listener);

      // Build from history (suppresses events)
      const historical = generateCandles(10);
      aggregator.buildFromHistory(historical);
      expect(listener).not.toHaveBeenCalled();

      // Now feed live candles — events should fire again
      // The last historical candle is at minute 9. To close a 5m bar we need to cross
      // into the next 5m interval.
      const baseTime = historical[0].timestamp;
      // Feed candles at minutes 10-15 to close the 10-14 bar
      for (let i = 10; i <= 15; i++) {
        aggregator.onCandleClose({
          timestamp: new Date(baseTime.getTime() + i * 60_000),
          open: 2700,
          high: 2701,
          low: 2699,
          close: 2700.5,
          volume: 10,
        });
      }

      // Should have emitted at least one 5m candle
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('OHLCV correctness', () => {
    it('should use open from first candle and close from last candle in interval', () => {
      const emitted: Candle[] = [];
      aggregator.on('candle:close:5m', (c: Candle) => emitted.push(c));

      const prices = [100, 105, 95, 110, 102];
      for (let i = 0; i < 5; i++) {
        aggregator.onCandleClose({
          timestamp: new Date('2026-01-15T10:00:00Z').getTime() + i * 60_000
            ? new Date(new Date('2026-01-15T10:00:00Z').getTime() + i * 60_000)
            : new Date('2026-01-15T10:00:00Z'),
          open: prices[i],
          high: prices[i] + 2,
          low: prices[i] - 2,
          close: prices[i] + 1,
          volume: 5,
        });
      }

      // Close the bar by starting next interval
      aggregator.onCandleClose({
        timestamp: new Date(new Date('2026-01-15T10:00:00Z').getTime() + 5 * 60_000),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 5,
      });

      expect(emitted).toHaveLength(1);
      const bar = emitted[0];
      expect(bar.open).toBe(100);          // open of first 1m candle
      expect(bar.close).toBe(103);         // close of last 1m candle (102 + 1)
      expect(bar.high).toBe(112);          // max high = 110 + 2
      expect(bar.low).toBe(93);            // min low = 95 - 2
      expect(bar.volume).toBe(25);         // 5 × 5
    });
  });

  describe('window size limit', () => {
    it('should cap the window at 200 candles', () => {
      // To get 200+ completed 5m candles, we need 200+ × 5 + 1 = 1001+ one-minute candles
      // That's a lot, so let's use seedHistorical instead
      const historicalCandles: Candle[] = [];
      for (let i = 0; i < 250; i++) {
        historicalCandles.push({
          timestamp: new Date(new Date('2026-01-15T00:00:00Z').getTime() + i * 5 * 60_000),
          open: 2700,
          high: 2701,
          low: 2699,
          close: 2700,
          volume: 10,
        });
      }

      aggregator.seedHistorical('5m', historicalCandles);
      const result = aggregator.getCandles('5m');
      expect(result).toHaveLength(200);
    });
  });

  describe('static helpers', () => {
    it('should return correct duration for timeframes', () => {
      expect(TimeframeAggregator.durationMs('1m')).toBe(60_000);
      expect(TimeframeAggregator.durationMs('5m')).toBe(300_000);
      expect(TimeframeAggregator.durationMs('15m')).toBe(900_000);
      expect(TimeframeAggregator.durationMs('1h')).toBe(3_600_000);
      expect(TimeframeAggregator.durationMs('4h')).toBe(14_400_000);
    });

    it('should list higher timeframes', () => {
      expect(TimeframeAggregator.timeframes).toEqual(['5m', '15m', '1h', '4h']);
    });
  });
});
