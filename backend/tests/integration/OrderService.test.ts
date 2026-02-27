jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { OrderService } from '../../src/services/OrderService';
import { IBrokerAdapter, PlaceOrderResult, BrokerPosition } from '../../src/services/IBrokerAdapter';
import { Trade } from '../../src/models/Trade';

// ─── Adapter mock factory ─────────────────────────────────────────────────

function makeMockAdapter(): jest.Mocked<IBrokerAdapter> {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    subscribeToTicks: jest.fn(),
    getHistoricalCandles: jest.fn(),
    isConnected: jest.fn(),
    getAccountInfo: jest.fn(),
    getOpenPositions: jest.fn(),
    placeOrder: jest.fn(),
    closePosition: jest.fn(),
    updateStopLoss: jest.fn(),
  } as unknown as jest.Mocked<IBrokerAdapter>;
}

const GOOD_ORDER_RESULT: PlaceOrderResult = {
  dealId: 'deal-123',
  executedPrice: 2000,
  size: 100,
  direction: 'BUY',
  symbol: 'XAU_USD',
  openedAt: new Date('2024-01-01T10:00:00Z'),
};

const OPEN_TRADE: Trade = {
  id: 'trade-1',
  brokerId: 'deal-123',
  symbol: 'XAU_USD',
  type: 'BUY',
  entryPrice: 2000,
  stopLoss: 1995,
  takeProfit: 2008,
  quantity: 100,
  profitLoss: 0,
  profitLossPercent: 0,
  status: 'OPEN',
  openedAt: new Date('2024-01-01T10:00:00Z'),
};

// ─── placeMarketOrder ────────────────────────────────────────────────────

describe('OrderService.placeMarketOrder', () => {
  // Make retries instantaneous by removing the sleep delay
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === 'function') (fn as () => void)();
      return 0 as unknown as NodeJS.Timeout;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a Trade with correct fields on success', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder.mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008);

    expect(trade.symbol).toBe('XAU_USD');
    expect(trade.type).toBe('BUY');
    expect(trade.entryPrice).toBe(2000);
    expect(trade.brokerId).toBe('deal-123');
    expect(trade.status).toBe('OPEN');
    expect(trade.quantity).toBe(100);
    expect(trade.stopLoss).toBe(1995);
    expect(trade.takeProfit).toBe(2008);
    expect(typeof trade.id).toBe('string');
    expect(trade.id.length).toBeGreaterThan(0);
  });

  it('attaches the optional strategy signal to the trade', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder.mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008, 'EMA cross');
    expect(trade.strategySignal).toBe('EMA cross');
  });

  it('retries on ECONNRESET (transient network error)', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(2);
    expect(trade.entryPrice).toBe(2000);
  });

  it('retries on ETIMEDOUT', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('retries on a 5xx broker error', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a non-retryable error', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder.mockRejectedValue(new Error('invalid symbol'));
    const svc = new OrderService(adapter);

    await expect(svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008)).rejects.toThrow();
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all 3 retry attempts', async () => {
    const adapter = makeMockAdapter();
    const retryableErr = new Error('ECONNRESET');
    adapter.placeOrder.mockRejectedValue(retryableErr);
    const svc = new OrderService(adapter);

    await expect(svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008)).rejects.toThrow();
    expect(adapter.placeOrder).toHaveBeenCalledTimes(3);
  });

  it('succeeds on the third attempt after two transient failures', async () => {
    const adapter = makeMockAdapter();
    adapter.placeOrder
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue(GOOD_ORDER_RESULT);
    const svc = new OrderService(adapter);

    const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 100, 1995, 2008);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(3);
    expect(trade.status).toBe('OPEN');
  });
});

// ─── closePosition ───────────────────────────────────────────────────────

describe('OrderService.closePosition', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === 'function') (fn as () => void)();
      return 0 as unknown as NodeJS.Timeout;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns CLOSED status', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const update = await svc.closePosition('deal-123', 2010, OPEN_TRADE);
    expect(update.status).toBe('CLOSED');
  });

  it('calculates positive P&L for a winning BUY trade', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    // BUY at 2000, exit at 2010: pnl = (2010 - 2000) * 100 = 1000
    const update = await svc.closePosition('deal-123', 2010, OPEN_TRADE);
    expect(update.profitLoss).toBeCloseTo(1000, 4);
    expect(update.profitLoss!).toBeGreaterThan(0);
  });

  it('calculates negative P&L for a losing BUY trade', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    // BUY at 2000, exit at 1995: pnl = (1995 - 2000) * 100 = -500
    const update = await svc.closePosition('deal-123', 1995, OPEN_TRADE);
    expect(update.profitLoss).toBeCloseTo(-500, 4);
    expect(update.profitLoss!).toBeLessThan(0);
  });

  it('calculates positive P&L for a winning SELL trade', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const sellTrade: Trade = { ...OPEN_TRADE, type: 'SELL' };
    // SELL at 2000, exit at 1990: pnl = (2000 - 1990) * 100 = 1000
    const update = await svc.closePosition('deal-123', 1990, sellTrade);
    expect(update.profitLoss).toBeCloseTo(1000, 4);
  });

  it('calculates negative P&L for a losing SELL trade', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const sellTrade: Trade = { ...OPEN_TRADE, type: 'SELL' };
    // SELL at 2000, exit at 2010: pnl = (2000 - 2010) * 100 = -1000
    const update = await svc.closePosition('deal-123', 2010, sellTrade);
    expect(update.profitLoss).toBeCloseTo(-1000, 4);
  });

  it('sets closedAt to the current time', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const before = Date.now();
    const update = await svc.closePosition('deal-123', 2010, OPEN_TRADE);
    const after = Date.now();

    const closedAt = update.closedAt!.getTime();
    expect(closedAt).toBeGreaterThanOrEqual(before);
    expect(closedAt).toBeLessThanOrEqual(after);
  });

  it('sets the exit price on the update', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const update = await svc.closePosition('deal-123', 2010, OPEN_TRADE);
    expect(update.exitPrice).toBe(2010);
  });

  it('retries on transient close errors', async () => {
    const adapter = makeMockAdapter();
    adapter.closePosition
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    const update = await svc.closePosition('deal-123', 2010, OPEN_TRADE);
    expect(adapter.closePosition).toHaveBeenCalledTimes(2);
    expect(update.status).toBe('CLOSED');
  });
});

// ─── updateStopLoss ──────────────────────────────────────────────────────

describe('OrderService.updateStopLoss', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === 'function') (fn as () => void)();
      return 0 as unknown as NodeJS.Timeout;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates to the adapter with correct arguments', async () => {
    const adapter = makeMockAdapter();
    adapter.updateStopLoss.mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    await svc.updateStopLoss('deal-123', 1998);
    expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-123', 1998);
  });

  it('retries on transient SL update errors', async () => {
    const adapter = makeMockAdapter();
    adapter.updateStopLoss
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(undefined);
    const svc = new OrderService(adapter);

    await svc.updateStopLoss('deal-123', 1998);
    expect(adapter.updateStopLoss).toHaveBeenCalledTimes(2);
  });
});

// ─── getOpenPositions ────────────────────────────────────────────────────

describe('OrderService.getOpenPositions', () => {
  it('maps broker positions to internal Position model', async () => {
    const adapter = makeMockAdapter();
    const brokerPosition: BrokerPosition = {
      dealId: 'deal-456',
      symbol: 'XAU_USD',
      direction: 'BUY',
      size: 50,
      entryLevel: 2000,
      currentLevel: 2010,
      stopLevel: 1995,
      profitLevel: 2015,
      pnl: 500,
      openedAt: new Date('2024-01-01T10:00:00Z'),
    };
    adapter.getOpenPositions.mockResolvedValue([brokerPosition]);
    const svc = new OrderService(adapter);

    const positions = await svc.getOpenPositions();
    expect(positions).toHaveLength(1);
    const pos = positions[0];
    expect(pos.brokerId).toBe('deal-456');
    expect(pos.symbol).toBe('XAU_USD');
    expect(pos.type).toBe('BUY');
    expect(pos.quantity).toBe(50);
    expect(pos.entryPrice).toBe(2000);
    expect(pos.currentPrice).toBe(2010);
    expect(pos.stopLoss).toBe(1995);
    expect(pos.takeProfit).toBe(2015);
    expect(pos.unrealisedPnL).toBe(500);
  });

  it('returns an empty array when broker has no open positions', async () => {
    const adapter = makeMockAdapter();
    adapter.getOpenPositions.mockResolvedValue([]);
    const svc = new OrderService(adapter);

    const positions = await svc.getOpenPositions();
    expect(positions).toHaveLength(0);
  });
});
