import { OrderService } from '../../../src/services/OrderService';
import { Trade } from '../../../src/models/Trade';
import { createMockBrokerAdapter, createMockMT5Adapter } from '../../helpers/mocks';
import { IBrokerAdapter, PlaceOrderResult } from '../../../src/services/IBrokerAdapter';

/* Helper: cast mock adapter to IBrokerAdapter for constructors */
const asAdapter = (m: Record<string, jest.Mock>) => m as unknown as IBrokerAdapter;

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('OrderService', () => {
  // ── Market Orders ────────────────────────────────────────────────────────────

  describe('placeMarketOrder()', () => {
    it('should place a market order and return a Trade in OPEN status', async () => {
      const adapter = createMockBrokerAdapter();
      const svc = new OrderService(asAdapter(adapter));

      const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 1, 2695, 2710, 'EMA cross');

      expect(adapter.placeOrder).toHaveBeenCalledWith({
        symbol: 'XAU_USD',
        direction: 'BUY',
        size: 1,
        stopLevel: 2695,
        profitLevel: 2710,
      });

      expect(trade.status).toBe('OPEN');
      expect(trade.symbol).toBe('XAU_USD');
      expect(trade.type).toBe('BUY');
      expect(trade.quantity).toBe(1);
      expect(trade.stopLoss).toBe(2695);
      expect(trade.takeProfit).toBe(2710);
      expect(trade.entryPrice).toBe(2700);
      expect(trade.strategySignal).toBe('EMA cross');
      expect(trade.id).toBeTruthy();
      expect(trade.brokerId).toBe('mock-deal-1');
    });

    it('should retry on transient errors', async () => {
      const adapter = createMockBrokerAdapter();
      let calls = 0;
      (adapter.placeOrder as jest.Mock).mockImplementation(() => {
        calls++;
        if (calls < 3) throw new Error('ECONNRESET');
        return Promise.resolve({
          dealId: 'retry-deal',
          executedPrice: 2700,
          size: 1,
          direction: 'BUY',
          symbol: 'XAU_USD',
          openedAt: new Date(),
        } as PlaceOrderResult);
      });

      const svc = new OrderService(asAdapter(adapter));
      const trade = await svc.placeMarketOrder('XAU_USD', 'BUY', 1, 2695, 2710);

      expect(trade.brokerId).toBe('retry-deal');
      expect(calls).toBe(3);
    });

    it('should throw after max retries on persistent transient errors', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.placeOrder as jest.Mock).mockRejectedValue(new Error('ECONNRESET'));

      const svc = new OrderService(asAdapter(adapter));

      await expect(
        svc.placeMarketOrder('XAU_USD', 'BUY', 1, 2695, 2710),
      ).rejects.toThrow('ECONNRESET');
    });

    it('should not retry on non-transient errors', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.placeOrder as jest.Mock).mockRejectedValue(new Error('Insufficient funds'));

      const svc = new OrderService(asAdapter(adapter));

      await expect(
        svc.placeMarketOrder('XAU_USD', 'BUY', 1, 2695, 2710),
      ).rejects.toThrow('Insufficient funds');

      expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
    });
  });

  // ── Close Position ──────────────────────────────────────────────────────────

  describe('closePosition()', () => {
    it('should close a position and return P&L from broker', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.closePosition as jest.Mock).mockResolvedValue({ pnl: 15.50 });

      const svc = new OrderService(asAdapter(adapter));
      const openTrade: Trade = {
        id: 'trade-1',
        brokerId: 'deal-1',
        symbol: 'XAU_USD',
        type: 'BUY',
        entryPrice: 2700,
        stopLoss: 2695,
        takeProfit: 2710,
        quantity: 1,
        profitLoss: 0,
        profitLossPercent: 0,
        status: 'OPEN',
        openedAt: new Date('2026-01-15T10:00:00Z'),
      };

      const result = await svc.closePosition('deal-1', 2705, openTrade);

      expect(adapter.closePosition).toHaveBeenCalledWith('deal-1');
      expect(result.profitLoss).toBe(15.50); // Broker-reported P&L
      expect(result.status).toBe('CLOSED');
      expect(result.closedAt).toBeDefined();
    });

    it('should fall back to calculated P&L when broker does not provide it', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.closePosition as jest.Mock).mockResolvedValue({});

      const svc = new OrderService(asAdapter(adapter));
      const openTrade: Trade = {
        id: 'trade-1',
        brokerId: 'deal-1',
        symbol: 'XAU_USD',
        type: 'BUY',
        entryPrice: 2700,
        stopLoss: 2695,
        takeProfit: 2710,
        quantity: 2,
        profitLoss: 0,
        profitLossPercent: 0,
        status: 'OPEN',
        openedAt: new Date('2026-01-15T10:00:00Z'),
      };

      const result = await svc.closePosition('deal-1', 2705, openTrade);

      // (2705 - 2700) * 2 = 10
      expect(result.profitLoss).toBe(10);
    });

    it('should calculate correct P&L for SELL positions', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.closePosition as jest.Mock).mockResolvedValue({});

      const svc = new OrderService(asAdapter(adapter));
      const openTrade: Trade = {
        id: 'trade-1',
        brokerId: 'deal-1',
        symbol: 'XAU_USD',
        type: 'SELL',
        entryPrice: 2700,
        stopLoss: 2705,
        takeProfit: 2690,
        quantity: 2,
        profitLoss: 0,
        profitLossPercent: 0,
        status: 'OPEN',
        openedAt: new Date('2026-01-15T10:00:00Z'),
      };

      const result = await svc.closePosition('deal-1', 2695, openTrade);

      // (2700 - 2695) * 2 = 10
      expect(result.profitLoss).toBe(10);
    });
  });

  // ── Update Stop Loss ────────────────────────────────────────────────────────

  describe('updateStopLoss()', () => {
    it('should forward stop loss update to the adapter', async () => {
      const adapter = createMockBrokerAdapter();
      const svc = new OrderService(asAdapter(adapter));

      await svc.updateStopLoss('deal-1', 2698);

      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2698);
    });
  });

  // ── Limit Orders (Grid Trading / MT5) ───────────────────────────────────────

  describe('placeLimitOrder()', () => {
    it('should place a limit order when adapter supports it', async () => {
      const adapter = createMockMT5Adapter();
      const svc = new OrderService(asAdapter(adapter));

      const order = await svc.placeLimitOrder({
        symbol: 'XAU_USD',
        direction: 'BUY',
        size: 0.1,
        price: 2698,
        profitLevel: 2700,
      });

      expect(adapter.placeLimitOrder).toHaveBeenCalled();
      expect(order.orderId).toBe('mock-limit-1');
      expect(order.type).toBe('LIMIT');
      expect(order.direction).toBe('BUY');
      expect(order.price).toBe(2698);
    });

    it('should throw when adapter does not support limit orders', async () => {
      const adapter = createMockBrokerAdapter(); // No placeLimitOrder
      const svc = new OrderService(asAdapter(adapter));

      await expect(
        svc.placeLimitOrder({
          symbol: 'XAU_USD',
          direction: 'BUY',
          size: 0.1,
          price: 2698,
        }),
      ).rejects.toThrow('does not support limit orders');
    });
  });

  describe('placeStopOrder()', () => {
    it('should place a stop order when adapter supports it', async () => {
      const adapter = createMockMT5Adapter();
      const svc = new OrderService(asAdapter(adapter));

      const order = await svc.placeStopOrder({
        symbol: 'XAU_USD',
        direction: 'SELL',
        size: 0.1,
        price: 2702,
      });

      expect(adapter.placeStopOrder).toHaveBeenCalled();
      expect(order.type).toBe('STOP');
    });

    it('should throw when adapter does not support stop orders', async () => {
      const adapter = createMockBrokerAdapter();
      const svc = new OrderService(asAdapter(adapter));

      await expect(
        svc.placeStopOrder({
          symbol: 'XAU_USD',
          direction: 'SELL',
          size: 0.1,
          price: 2702,
        }),
      ).rejects.toThrow('does not support stop orders');
    });
  });

  describe('cancelOrder()', () => {
    it('should cancel an order when adapter supports it', async () => {
      const adapter = createMockMT5Adapter();
      const svc = new OrderService(asAdapter(adapter));

      await svc.cancelOrder('order-123');

      expect(adapter.cancelOrder).toHaveBeenCalledWith('order-123');
    });

    it('should throw when adapter does not support cancel', async () => {
      const adapter = createMockBrokerAdapter();
      const svc = new OrderService(asAdapter(adapter));

      await expect(svc.cancelOrder('order-123')).rejects.toThrow(
        'does not support pending orders',
      );
    });
  });

  describe('cancelAllOrders()', () => {
    it('should cancel all open orders', async () => {
      const adapter = createMockMT5Adapter();
      (adapter.getOpenOrders as jest.Mock).mockResolvedValue([
        { orderId: 'o1', symbol: 'XAU_USD', direction: 'BUY', type: 'LIMIT', size: 0.1, price: 2698, openedAt: new Date() },
        { orderId: 'o2', symbol: 'XAU_USD', direction: 'SELL', type: 'LIMIT', size: 0.1, price: 2702, openedAt: new Date() },
      ]);

      const svc = new OrderService(asAdapter(adapter));
      const count = await svc.cancelAllOrders();

      expect(count).toBe(2);
      expect(adapter.cancelOrder).toHaveBeenCalledWith('o1');
      expect(adapter.cancelOrder).toHaveBeenCalledWith('o2');
    });
  });

  describe('getOpenOrders()', () => {
    it('should return empty array when adapter has no getOpenOrders', async () => {
      const adapter = createMockBrokerAdapter();
      const svc = new OrderService(asAdapter(adapter));

      const orders = await svc.getOpenOrders();
      expect(orders).toEqual([]);
    });

    it('should return orders from adapter when supported', async () => {
      const adapter = createMockMT5Adapter();
      const mockOrders = [
        { orderId: 'o1', symbol: 'XAU_USD', direction: 'BUY' as const, type: 'LIMIT' as const, size: 0.1, price: 2698, openedAt: new Date() },
      ];
      (adapter.getOpenOrders as jest.Mock).mockResolvedValue(mockOrders);

      const svc = new OrderService(asAdapter(adapter));
      const orders = await svc.getOpenOrders();

      expect(orders.length).toBe(1);
      expect(orders[0].orderId).toBe('o1');
    });
  });

  // ── Open Positions ──────────────────────────────────────────────────────────

  describe('getOpenPositions()', () => {
    it('should map broker positions to internal Position model', async () => {
      const adapter = createMockBrokerAdapter();
      (adapter.getOpenPositions as jest.Mock).mockResolvedValue([
        {
          dealId: 'pos-1',
          symbol: 'XAU_USD',
          direction: 'BUY',
          size: 1,
          entryLevel: 2700,
          currentLevel: 2705,
          stopLevel: 2695,
          profitLevel: 2710,
          pnl: 5,
          openedAt: new Date('2026-01-15T10:00:00Z'),
        },
      ]);

      const svc = new OrderService(asAdapter(adapter));
      const positions = await svc.getOpenPositions();

      expect(positions.length).toBe(1);
      expect(positions[0].id).toBe('pos-1');
      expect(positions[0].entryPrice).toBe(2700);
      expect(positions[0].currentPrice).toBe(2705);
      expect(positions[0].unrealisedPnL).toBe(5);
      expect(positions[0].type).toBe('BUY');
    });
  });
});
