import { GridTradingStrategy, GridLevel } from '../../../src/strategies/GridTradingStrategy';
import { strategyConfig } from '../../../src/config/strategy.config';
import { generateCandles } from '../../helpers/mocks';

// Suppress logger output
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('GridTradingStrategy', () => {
  let strategy: GridTradingStrategy;

  // Snapshot defaults so we can restore after each test
  const originalGridConfig = { ...strategyConfig.gridTrading };
  const originalSymbol = strategyConfig.symbol;
  const originalAdxPeriod = strategyConfig.adxPeriod;

  beforeEach(() => {
    // Reset grid config to known defaults
    Object.assign(strategyConfig.gridTrading, {
      gridLevels: 5,
      gridSpacing: 2.0,
      lotSizePerLevel: 10,
      takeProfitPerLevel: 1.0,
      maxGridDrawdown: 0.05,
      trendDetectionEnabled: true,
      trendAdxThreshold: 30,
    });
    strategyConfig.symbol = 'XAU_USD';
    strategyConfig.adxPeriod = 14;

    strategy = new GridTradingStrategy();
  });

  afterEach(() => {
    Object.assign(strategyConfig.gridTrading, originalGridConfig);
    strategyConfig.symbol = originalSymbol;
    strategyConfig.adxPeriod = originalAdxPeriod;
  });

  // ── Initialization ──────────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('should create grid levels above and below current price', () => {
      const signal = strategy.initialize(2700);

      expect(signal.action).toBe('HOLD');
      expect(signal.gridAction).toBe('INIT');
      expect(signal.gridOrders).toBeDefined();
      expect(signal.gridOrders!.length).toBe(10); // 5 above + 5 below
    });

    it('should create BUY limits below and SELL limits above current price', () => {
      const signal = strategy.initialize(2700);
      const orders = signal.gridOrders!;

      const buyOrders = orders.filter(o => o.direction === 'BUY');
      const sellOrders = orders.filter(o => o.direction === 'SELL');

      expect(buyOrders.length).toBe(5);
      expect(sellOrders.length).toBe(5);

      // All BUY orders should be below 2700
      buyOrders.forEach(o => expect(o.price).toBeLessThan(2700));
      // All SELL orders should be above 2700
      sellOrders.forEach(o => expect(o.price).toBeGreaterThan(2700));
    });

    it('should space grid levels correctly', () => {
      const signal = strategy.initialize(2700);
      const orders = signal.gridOrders!;

      const buyOrders = orders.filter(o => o.direction === 'BUY').sort((a, b) => b.price - a.price);
      // First BUY should be at 2700 - 2 = 2698
      expect(buyOrders[0].price).toBe(2698);
      expect(buyOrders[1].price).toBe(2696);
      expect(buyOrders[2].price).toBe(2694);
    });

    it('should set correct take profit levels', () => {
      const signal = strategy.initialize(2700);
      const orders = signal.gridOrders!;

      const buyOrder = orders.find(o => o.direction === 'BUY' && o.price === 2698)!;
      // TP = price + takeProfitPerLevel = 2698 + 1 = 2699
      expect(buyOrder.profitLevel).toBe(2699);

      const sellOrder = orders.find(o => o.direction === 'SELL' && o.price === 2702)!;
      // TP = price - takeProfitPerLevel = 2702 - 1 = 2701
      expect(sellOrder.profitLevel).toBe(2701);
    });

    it('should set lot size from config', () => {
      const signal = strategy.initialize(2700);
      signal.gridOrders!.forEach(o => {
        expect(o.size).toBe(10);
      });
    });

    it('should mark grid as initialized', () => {
      expect(strategy.isGridInitialized()).toBe(false);
      strategy.initialize(2700);
      expect(strategy.isGridInitialized()).toBe(true);
    });

    it('should set center price in state', () => {
      strategy.initialize(2700);
      const state = strategy.getState();
      expect(state.centerPrice).toBe(2700);
    });
  });

  // ── Order confirmation ──────────────────────────────────────────────────────

  describe('confirmOrderPlaced()', () => {
    it('should assign orderId to the matching grid level', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-123');

      const state = strategy.getState();
      const level = state.levels.find(l => l.price === 2698 && l.direction === 'BUY');
      expect(level?.orderId).toBe('order-123');
    });

    it('should not affect levels with non-matching price/direction', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-123');

      const state = strategy.getState();
      const sellLevel = state.levels.find(l => l.price === 2702 && l.direction === 'SELL');
      expect(sellLevel?.orderId).toBeNull();
    });
  });

  describe('confirmOrderFilled()', () => {
    it('should mark the matching level as FILLED', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-123');
      strategy.confirmOrderFilled('order-123');

      const state = strategy.getState();
      const level = state.levels.find(l => l.orderId === 'order-123');
      expect(level?.status).toBe('FILLED');
    });

    it('should do nothing for unknown order IDs', () => {
      strategy.initialize(2700);
      strategy.confirmOrderFilled('nonexistent');

      const state = strategy.getState();
      state.levels.forEach(l => expect(l.status).toBe('PENDING'));
    });
  });

  describe('confirmOrdersCancelled()', () => {
    it('should mark multiple levels as CANCELLED', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-1');
      strategy.confirmOrderPlaced(2696, 'BUY', 'order-2');
      strategy.confirmOrdersCancelled(['order-1', 'order-2']);

      const state = strategy.getState();
      const cancelled = state.levels.filter(l => l.status === 'CANCELLED');
      expect(cancelled.length).toBe(2);
    });
  });

  // ── Shutdown ────────────────────────────────────────────────────────────────

  describe('shutdown()', () => {
    it('should return cancelOrderIds for all PENDING levels', () => {
      strategy.initialize(2700);
      // Confirm a few orders placed
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-1');
      strategy.confirmOrderPlaced(2702, 'SELL', 'order-2');

      const signal = strategy.shutdown();

      expect(signal.gridAction).toBe('SHUTDOWN');
      expect(signal.cancelOrderIds).toContain('order-1');
      expect(signal.cancelOrderIds).toContain('order-2');
    });

    it('should not include FILLED orders in cancelOrderIds', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-1');
      strategy.confirmOrderFilled('order-1');
      strategy.confirmOrderPlaced(2702, 'SELL', 'order-2');

      const signal = strategy.shutdown();
      expect(signal.cancelOrderIds).not.toContain('order-1');
      expect(signal.cancelOrderIds).toContain('order-2');
    });

    it('should reset grid state after shutdown', () => {
      strategy.initialize(2700);
      strategy.shutdown();

      expect(strategy.isGridInitialized()).toBe(false);
      const state = strategy.getState();
      expect(state.levels.length).toBe(0);
      expect(state.centerPrice).toBe(0);
    });
  });

  // ── Evaluate (per-candle health check) ──────────────────────────────────────

  describe('evaluate()', () => {
    it('should return HOLD with MONITOR when grid is healthy', () => {
      strategy.initialize(2700);
      const candles = generateCandles(30, { basePrice: 2700 });

      const signal = strategy.evaluate(candles);

      expect(signal.action).toBe('HOLD');
      expect(signal.gridAction).toBe('MONITOR');
    });

    it('should return HOLD if grid is not initialized', () => {
      const candles = generateCandles(30, { basePrice: 2700 });
      const signal = strategy.evaluate(candles);

      expect(signal.action).toBe('HOLD');
      expect(signal.reason).toContain('not yet initialized');
    });

    it('should trigger REBALANCE when price drifts beyond threshold', () => {
      strategy.initialize(2700);

      // Grid levels = 5, spacing = 2, so rebalance threshold = (5 * 2) / 2 = 5
      // Create candles with close price at 2706 (drift = 6 > 5)
      const candles = generateCandles(30, {
        basePrice: 2706,
        closes: Array(30).fill(2706),
      });

      const signal = strategy.evaluate(candles);

      expect(signal.gridAction).toBe('REBALANCE');
      expect(signal.cancelOrderIds).toBeDefined();
      expect(signal.gridOrders).toBeDefined();
      expect(signal.gridOrders!.length).toBe(10); // New full grid
    });

    it('should not rebalance within drift threshold', () => {
      strategy.initialize(2700);

      // Drift of 3 < threshold of 5
      const candles = generateCandles(30, {
        basePrice: 2703,
        closes: Array(30).fill(2703),
      });

      const signal = strategy.evaluate(candles);
      expect(signal.gridAction).toBe('MONITOR');
    });
  });

  // ── getState() ──────────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('should return a copy (not a reference) of the internal state', () => {
      strategy.initialize(2700);
      const state1 = strategy.getState();
      const state2 = strategy.getState();

      expect(state1).toEqual(state2);
      expect(state1.levels).not.toBe(state2.levels); // Different array instances
    });

    it('should reflect correct counts of PENDING and FILLED levels', () => {
      strategy.initialize(2700);
      strategy.confirmOrderPlaced(2698, 'BUY', 'order-1');
      strategy.confirmOrderFilled('order-1');

      const state = strategy.getState();
      const pending = state.levels.filter(l => l.status === 'PENDING');
      const filled = state.levels.filter(l => l.status === 'FILLED');

      expect(pending.length).toBe(9);
      expect(filled.length).toBe(1);
    });
  });
});
