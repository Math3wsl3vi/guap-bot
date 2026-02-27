jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../src/config/strategy.config', () => ({
  strategyConfig: {
    emaFastPeriod: 9,
    emaSlowPeriod: 21,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    takeProfitPips: 8,
    stopLossPips: 5,
    trailingStopEnabled: false,
    trailingStopPips: 3,
    symbol: 'XAU_USD',
    timeframe: '1m',
  },
}));

import { MarketDataService } from '../../src/services/MarketDataService';
import { IBrokerAdapter, TickData } from '../../src/services/IBrokerAdapter';
import { Candle } from '../../src/models/Candle';

// ─── Adapter mock factory ─────────────────────────────────────────────────

function makeMockAdapter(): jest.Mocked<IBrokerAdapter> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribeToTicks: jest.fn().mockResolvedValue(undefined),
    getHistoricalCandles: jest.fn().mockResolvedValue([]),
    isConnected: jest.fn().mockReturnValue(true),
    getAccountInfo: jest.fn(),
    getOpenPositions: jest.fn(),
    placeOrder: jest.fn(),
    closePosition: jest.fn(),
    updateStopLoss: jest.fn(),
  } as unknown as jest.Mocked<IBrokerAdapter>;
}

function makeTick(mid: number, timestamp: Date): TickData {
  return { symbol: 'XAU_USD', bid: mid - 0.5, ask: mid + 0.5, mid, timestamp };
}

// Helper: start service and capture the subscribed tick callback
async function startAndCaptureTick(
  adapter: jest.Mocked<IBrokerAdapter>,
): Promise<{ svc: MarketDataService; onTick: (t: TickData) => void }> {
  let onTick!: (t: TickData) => void;
  adapter.subscribeToTicks.mockImplementation(async (_sym, cb) => {
    onTick = cb;
  });
  const svc = new MarketDataService(adapter);
  await svc.start();
  return { svc, onTick };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('MarketDataService — candle building', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores historical warmup candles in the rolling window', async () => {
    const adapter = makeMockAdapter();
    const historical: Candle[] = [
      { timestamp: new Date('2024-01-01T09:00:00Z'), open: 2000, high: 2001, low: 1999, close: 2000, volume: 5 },
      { timestamp: new Date('2024-01-01T09:01:00Z'), open: 2000, high: 2002, low: 1998, close: 2001, volume: 7 },
    ];
    adapter.getHistoricalCandles.mockResolvedValue(historical);
    const { svc } = await startAndCaptureTick(adapter);

    expect(svc.getCandles()).toHaveLength(2);
    await svc.stop();
  });

  it('does not emit candle:close when the first tick arrives (bar still open)', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);
    const emitted: Candle[] = [];
    svc.on('candle:close', (c: Candle) => emitted.push(c));

    const t0 = new Date('2024-01-01T10:00:00Z');
    onTick(makeTick(2000, t0));

    expect(emitted).toHaveLength(0);
    await svc.stop();
  });

  it('does not emit candle:close for ticks within the same minute', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);
    const emitted: Candle[] = [];
    svc.on('candle:close', (c: Candle) => emitted.push(c));

    const t0 = new Date('2024-01-01T10:00:00Z');
    onTick(makeTick(2000, t0));
    onTick(makeTick(2001, new Date(t0.getTime() + 20_000)));  // same minute
    onTick(makeTick(2002, new Date(t0.getTime() + 50_000)));  // same minute

    expect(emitted).toHaveLength(0);
    await svc.stop();
  });

  it('emits candle:close when a tick from the next minute arrives', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);
    const emitted: Candle[] = [];
    svc.on('candle:close', (c: Candle) => emitted.push(c));

    const t0 = new Date('2024-01-01T10:00:00Z');
    onTick(makeTick(2000, t0));
    onTick(makeTick(2005, new Date(t0.getTime() + 60_000))); // next minute → close previous

    expect(emitted).toHaveLength(1);
    await svc.stop();
  });

  it('emits a candle with correct OHLCV values', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);
    const emitted: Candle[] = [];
    svc.on('candle:close', (c: Candle) => emitted.push(c));

    const t0 = new Date('2024-01-01T10:00:00Z');
    onTick(makeTick(2000, t0));                                   // open
    onTick(makeTick(2010, new Date(t0.getTime() + 10_000)));      // high candidate
    onTick(makeTick(1995, new Date(t0.getTime() + 30_000)));      // low candidate
    onTick(makeTick(2003, new Date(t0.getTime() + 50_000)));      // close candidate
    onTick(makeTick(2005, new Date(t0.getTime() + 60_000)));      // next minute → triggers close

    const bar = emitted[0];
    expect(bar.open).toBe(2000);
    expect(bar.high).toBe(2010);
    expect(bar.low).toBe(1995);
    expect(bar.close).toBe(2003);
    expect(bar.volume).toBe(4); // 4 ticks in the bar
    await svc.stop();
  });

  it('emits one candle for each completed minute', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);
    const emitted: Candle[] = [];
    svc.on('candle:close', (c: Candle) => emitted.push(c));

    const base = new Date('2024-01-01T10:00:00Z').getTime();
    for (let minute = 0; minute < 4; minute++) {
      onTick(makeTick(2000 + minute, new Date(base + minute * 60_000)));
    }

    // 3 completed bars (minute 0, 1, 2); minute 3 is still open
    expect(emitted).toHaveLength(3);
    await svc.stop();
  });

  it('caps the rolling window at 200 candles', async () => {
    const adapter = makeMockAdapter();
    const { svc, onTick } = await startAndCaptureTick(adapter);

    const base = new Date('2024-01-01T10:00:00Z').getTime();
    // Push 205 completed candles
    for (let i = 0; i < 206; i++) {
      onTick(makeTick(2000 + i * 0.1, new Date(base + i * 60_000)));
    }

    expect(svc.getCandles().length).toBeLessThanOrEqual(200);
    await svc.stop();
  });
});

describe('MarketDataService — reconnect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('resets reconnect attempt counter on successful connection', async () => {
    const adapter = makeMockAdapter();
    const svc = new MarketDataService(adapter);
    await svc.start();

    expect((svc as unknown as { reconnectAttempts: number }).reconnectAttempts).toBe(0);
    await svc.stop();
  });

  it('schedules a reconnect after a connection failure', async () => {
    const adapter = makeMockAdapter();
    adapter.connect.mockRejectedValueOnce(new Error('network error'));
    adapter.connect.mockResolvedValue(undefined);

    const svc = new MarketDataService(adapter);
    // First call throws → schedules reconnect timer
    await svc.start();

    // Should have called connect once (failed) — reconnect timer is pending
    expect(adapter.connect).toHaveBeenCalledTimes(1);
    expect((svc as unknown as { reconnectAttempts: number }).reconnectAttempts).toBe(1);

    // Advance timers to trigger first reconnect (1 s)
    await jest.advanceTimersByTimeAsync(1_100);

    expect(adapter.connect).toHaveBeenCalledTimes(2);
    await svc.stop();
  });

  it('uses exponential backoff: second delay is longer than first', async () => {
    const adapter = makeMockAdapter();
    // Always fail to observe timer scheduling
    adapter.connect.mockRejectedValue(new Error('down'));
    adapter.subscribeToTicks.mockResolvedValue(undefined);
    adapter.getHistoricalCandles.mockResolvedValue([]);

    const svc = new MarketDataService(adapter);
    // Limit attempts so we don't wait forever
    (svc as unknown as { maxReconnectAttempts: number }).maxReconnectAttempts = 3;

    await svc.start(); // attempt 1 fails

    await jest.advanceTimersByTimeAsync(1_100); // fires reconnect #1 (1s delay)
    expect(adapter.connect).toHaveBeenCalledTimes(2); // attempt 2 fails

    await jest.advanceTimersByTimeAsync(2_100); // fires reconnect #2 (2s delay)
    expect(adapter.connect).toHaveBeenCalledTimes(3); // attempt 3 fails

    await svc.stop();
  });

  it('emits a fatal event after exhausting all reconnect attempts', async () => {
    const adapter = makeMockAdapter();
    adapter.connect.mockRejectedValue(new Error('persistent failure'));

    const svc = new MarketDataService(adapter);
    (svc as unknown as { maxReconnectAttempts: number }).maxReconnectAttempts = 2;

    const fatalErrors: Error[] = [];
    svc.on('fatal', (e: Error) => fatalErrors.push(e));

    await svc.start(); // attempt 1 fails
    await jest.advanceTimersByTimeAsync(1_100); // attempt 2 fails
    await jest.advanceTimersByTimeAsync(2_100); // exhausted → fatal

    expect(fatalErrors).toHaveLength(1);
    expect(fatalErrors[0].message).toContain('Max WebSocket reconnect attempts exceeded');
    await svc.stop();
  });

  it('does not schedule a reconnect after stop() is called', async () => {
    const adapter = makeMockAdapter();
    adapter.connect.mockRejectedValue(new Error('down'));

    const svc = new MarketDataService(adapter);
    (svc as unknown as { maxReconnectAttempts: number }).maxReconnectAttempts = 3;

    await svc.start(); // first attempt fails, reconnect timer scheduled
    await svc.stop();  // should cancel the timer

    const connectCallsAfterStop = adapter.connect.mock.calls.length;
    await jest.advanceTimersByTimeAsync(5_000); // advance well past any scheduled timer

    expect(adapter.connect).toHaveBeenCalledTimes(connectCallsAfterStop); // no extra calls
  });
});
