import { MarketDataService } from '../../../src/services/MarketDataService';
import { createMockBrokerAdapter, createTick, generateCandles } from '../../helpers/mocks';
import { IBrokerAdapter, TickData } from '../../../src/services/IBrokerAdapter';
import { Candle } from '../../../src/models/Candle';
import { strategyConfig } from '../../../src/config/strategy.config';

const asAdapter = (m: Record<string, jest.Mock>) => m as unknown as IBrokerAdapter;

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('MarketDataService', () => {
  let adapter: ReturnType<typeof createMockBrokerAdapter>;
  let service: MarketDataService;
  let tickCallback: ((tick: TickData) => void) | null;

  const originalSymbol = strategyConfig.symbol;
  const originalTimeframe = strategyConfig.timeframe;

  beforeEach(() => {
    strategyConfig.symbol = 'XAU_USD';
    strategyConfig.timeframe = '1m';

    adapter = createMockBrokerAdapter();
    tickCallback = null;

    // Capture the tick callback when subscribeToTicks is called
    (adapter.subscribeToTicks as jest.Mock).mockImplementation(
      (_symbol: string, cb: (tick: TickData) => void) => {
        tickCallback = cb;
        return Promise.resolve();
      },
    );

    service = new MarketDataService(asAdapter(adapter));
  });

  afterEach(async () => {
    strategyConfig.symbol = originalSymbol;
    strategyConfig.timeframe = originalTimeframe;
    await service.stop().catch(() => {});
  });

  // ── Start / Stop ──────────────────────────────────────────────────────────

  describe('start()', () => {
    it('should connect to the broker and subscribe to ticks', async () => {
      await service.start();

      expect(adapter.connect).toHaveBeenCalled();
      expect(adapter.subscribeToTicks).toHaveBeenCalledWith('XAU_USD', expect.any(Function));
    });

    it('should load historical candles on warmup', async () => {
      const historicalCandles = generateCandles(50, { basePrice: 2700 });
      (adapter.getHistoricalCandles as jest.Mock).mockResolvedValue(historicalCandles);

      await service.start();

      expect(adapter.getHistoricalCandles).toHaveBeenCalledWith('XAU_USD', '1m', 100);
      expect(service.getCandles().length).toBe(50);
    });

    it('should start with empty candles if historical fetch fails', async () => {
      (adapter.getHistoricalCandles as jest.Mock).mockRejectedValue(new Error('Network error'));

      await service.start();

      expect(service.getCandles().length).toBe(0);
    });
  });

  describe('stop()', () => {
    it('should disconnect the adapter', async () => {
      await service.start();
      await service.stop();

      expect(adapter.disconnect).toHaveBeenCalled();
    });
  });

  // ── Tick Processing & Candle Building ────────────────────────────────────────

  describe('tick aggregation', () => {
    beforeEach(async () => {
      (adapter.getHistoricalCandles as jest.Mock).mockResolvedValue([]);
      await service.start();
    });

    it('should build a candle from ticks in the same minute', () => {
      const baseTime = new Date('2026-01-15T10:00:00Z');

      tickCallback!(createTick(2700, new Date(baseTime.getTime())));
      tickCallback!(createTick(2702, new Date(baseTime.getTime() + 10_000)));
      tickCallback!(createTick(2698, new Date(baseTime.getTime() + 20_000)));
      tickCallback!(createTick(2701, new Date(baseTime.getTime() + 30_000)));

      // No candle:close yet because the minute hasn't ended
      expect(service.getCandles().length).toBe(0);
    });

    it('should emit candle:close when a new minute starts', (done) => {
      const minute1 = new Date('2026-01-15T10:00:00Z');
      const minute2 = new Date('2026-01-15T10:01:00Z');

      service.on('candle:close', (candle: Candle) => {
        expect(candle.open).toBe(2700);
        expect(candle.high).toBe(2702);
        expect(candle.low).toBe(2698);
        expect(candle.close).toBe(2701);
        expect(candle.volume).toBe(4);
        expect(candle.timestamp).toEqual(minute1);
        done();
      });

      // Minute 1 ticks
      tickCallback!(createTick(2700, new Date(minute1.getTime())));
      tickCallback!(createTick(2702, new Date(minute1.getTime() + 10_000)));
      tickCallback!(createTick(2698, new Date(minute1.getTime() + 20_000)));
      tickCallback!(createTick(2701, new Date(minute1.getTime() + 50_000)));

      // First tick of minute 2 triggers close of minute 1
      tickCallback!(createTick(2703, minute2));
    });

    it('should track last tick for spread checking', () => {
      expect(service.getLastTick()).toBeNull();

      const tick = createTick(2700, new Date('2026-01-15T10:00:00Z'));
      tickCallback!(tick);

      expect(service.getLastTick()).toBeDefined();
      expect(service.getLastTick()!.mid).toBe(2700);
    });

    it('should maintain a rolling window of candles (max 200)', (done) => {
      // Pre-fill with 199 historical candles
      const historical = generateCandles(199, { basePrice: 2700 });
      // Manually set candles via a second start
      (adapter.getHistoricalCandles as jest.Mock).mockResolvedValue(historical);

      // Recreate service to get the historical candles
      service = new MarketDataService(asAdapter(adapter));
      (adapter.subscribeToTicks as jest.Mock).mockImplementation(
        (_s: string, cb: (tick: TickData) => void) => {
          tickCallback = cb;
          return Promise.resolve();
        },
      );

      service.start().then(() => {
        expect(service.getCandles().length).toBe(199);

        let closeCount = 0;
        service.on('candle:close', () => {
          closeCount++;
          if (closeCount === 2) {
            // 199 + 2 = 201, but capped at 200
            expect(service.getCandles().length).toBe(200);
            done();
          }
        });

        // Generate 3 minutes of ticks to close 2 candles
        const base = new Date('2026-01-15T13:20:00Z');
        tickCallback!(createTick(2700, new Date(base.getTime())));
        tickCallback!(createTick(2701, new Date(base.getTime() + 60_000)));
        tickCallback!(createTick(2702, new Date(base.getTime() + 120_000)));
      });
    });
  });

  // ── Reconnection ──────────────────────────────────────────────────────────

  describe('reconnection', () => {
    it('should emit fatal after max reconnect attempts', (done) => {
      (adapter.connect as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      service.on('fatal', (err: Error) => {
        expect(err.message).toContain('Max WebSocket reconnect');
        done();
      });

      // Patch setTimeout to fire immediately for test speed
      jest.useFakeTimers();
      service.start().then(() => {
        // Run through all 10 reconnect timers
        for (let i = 0; i < 15; i++) {
          jest.runAllTimers();
        }
      });

      // Need to flush async between timer fires
      const flush = async () => {
        for (let i = 0; i < 15; i++) {
          jest.runAllTimers();
          await Promise.resolve();
        }
      };
      flush();
    });

    afterEach(() => {
      jest.useRealTimers();
    });
  });
});
