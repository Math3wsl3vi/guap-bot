import { IBrokerAdapter, TickData, PlaceOrderResult, AccountInfo } from '../../src/services/IBrokerAdapter';
import { Candle } from '../../src/models/Candle';

/** Convenience type — each adapter method is a jest.Mock. */
export type MockBrokerAdapter = {
  [K in keyof IBrokerAdapter]: jest.Mock;
};

export type MockMT5Adapter = {
  [K in keyof Required<IBrokerAdapter>]: jest.Mock;
};

/**
 * Create a mock IBrokerAdapter with all methods stubbed.
 * Override individual methods as needed in each test.
 */
export function createMockBrokerAdapter(overrides: Partial<Record<string, jest.Mock>> = {}): MockBrokerAdapter {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribeToTicks: jest.fn().mockResolvedValue(undefined),
    getHistoricalCandles: jest.fn().mockResolvedValue([]),
    isConnected: jest.fn().mockReturnValue(true),
    getAccountInfo: jest.fn().mockResolvedValue({
      balance: 10000,
      equity: 10000,
      margin: 0,
      currency: 'USD',
    } as AccountInfo),
    getOpenPositions: jest.fn().mockResolvedValue([]),
    placeOrder: jest.fn().mockResolvedValue({
      dealId: 'mock-deal-1',
      executedPrice: 2700.00,
      size: 1,
      direction: 'BUY',
      symbol: 'XAU_USD',
      openedAt: new Date('2026-01-15T10:00:00Z'),
    } as PlaceOrderResult),
    closePosition: jest.fn().mockResolvedValue({ pnl: 5.0 }),
    updateStopLoss: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a mock IBrokerAdapter that also supports pending order methods (MT5-like).
 */
export function createMockMT5Adapter(overrides: Partial<Record<string, jest.Mock>> = {}): MockMT5Adapter {
  return {
    ...createMockBrokerAdapter(),
    placeLimitOrder: jest.fn().mockResolvedValue({
      dealId: 'mock-limit-1',
      executedPrice: 2698.00,
      size: 0.1,
      direction: 'BUY',
      symbol: 'XAU_USD',
      openedAt: new Date('2026-01-15T10:00:00Z'),
    } as PlaceOrderResult),
    placeStopOrder: jest.fn().mockResolvedValue({
      dealId: 'mock-stop-1',
      executedPrice: 2702.00,
      size: 0.1,
      direction: 'SELL',
      symbol: 'XAU_USD',
      openedAt: new Date('2026-01-15T10:00:00Z'),
    } as PlaceOrderResult),
    cancelOrder: jest.fn().mockResolvedValue(undefined),
    getOpenOrders: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/**
 * Generate a sequence of candles for testing.
 * Produces `count` candles starting at `baseTime`, each 1 minute apart.
 */
export function generateCandles(
  count: number,
  options: {
    basePrice?: number;
    baseTime?: Date;
    /** If provided, uses these close prices to build candles */
    closes?: number[];
    spread?: number;
  } = {},
): Candle[] {
  const {
    basePrice = 2700,
    baseTime = new Date('2026-01-15T10:00:00Z'),
    closes,
    spread = 0.5,
  } = options;

  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const close = closes?.[i] ?? basePrice + (i % 10) * 0.1 - 0.5;
    const open = i === 0 ? basePrice : (closes?.[i - 1] ?? candles[i - 1].close);
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread;

    candles.push({
      timestamp: new Date(baseTime.getTime() + i * 60_000),
      open,
      high,
      low,
      close,
      volume: 100 + i,
    });
  }

  return candles;
}

/**
 * Create a tick at a specific time with bid/ask spread.
 */
export function createTick(
  price: number,
  timestamp: Date,
  symbol = 'XAU_USD',
  spread = 0.30,
): TickData {
  return {
    symbol,
    bid: price - spread / 2,
    ask: price + spread / 2,
    mid: price,
    timestamp,
  };
}
