import { PositionMonitor, StopLossUpdate } from '../../../src/services/PositionMonitor';
import { OrderService } from '../../../src/services/OrderService';
import { MarketDataService } from '../../../src/services/MarketDataService';
import { Position } from '../../../src/models/Position';
import { strategyConfig } from '../../../src/config/strategy.config';
import { IBrokerAdapter } from '../../../src/services/IBrokerAdapter';
import { createMockBrokerAdapter, generateCandles } from '../../helpers/mocks';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const asAdapter = (m: Record<string, jest.Mock>) => m as unknown as IBrokerAdapter;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake open Position */
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'deal-1',
    brokerId: 'deal-1',
    symbol: 'XAU_USD',
    type: 'BUY',
    entryPrice: 2700.0,
    currentPrice: 2700.0,
    stopLoss: 2695.0,
    takeProfit: 2710.0,
    quantity: 1,
    unrealisedPnL: 0,
    unrealisedPnLPercent: 0,
    openedAt: new Date('2026-01-15T10:00:00Z'),
    trailingStopActive: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PositionMonitor', () => {
  let adapter: ReturnType<typeof createMockBrokerAdapter>;
  let orderService: OrderService;
  let marketData: MarketDataService;
  let monitor: PositionMonitor;

  beforeEach(() => {
    adapter = createMockBrokerAdapter();
    orderService = new OrderService(asAdapter(adapter));
    marketData = new MarketDataService(asAdapter(adapter));
    monitor = new PositionMonitor(orderService, marketData);

    // Defaults: both enabled
    strategyConfig.trailingStopEnabled = true;
    strategyConfig.breakevenEnabled = true;
    strategyConfig.trailingActivationPips = 5; // 5 pips = $0.05 for XAU
    strategyConfig.trailingStopPips = 3;       // 3 pips trail = $0.03
    strategyConfig.breakevenTriggerPips = 3;   // 3 pips = $0.03
    strategyConfig.useAtrTrailing = false;
    strategyConfig.symbol = 'XAU_USD';         // pipSize = 0.01
  });

  afterEach(() => {
    monitor.stop();
  });

  // ─── Breakeven ────────────────────────────────────────────────────────────

  describe('breakeven', () => {
    beforeEach(() => {
      strategyConfig.trailingStopEnabled = false; // Isolate breakeven tests
    });

    it('should move SL to entry when profit exceeds breakevenTriggerPips (BUY)', async () => {
      // Entry at 2700, current at 2700.05 → 5 pips profit (>= 3 pips trigger)
      const pos = makePosition({ currentPrice: 2700.05 });
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.05, stopLevel: 2695, profitLevel: 2710, pnl: 5, openedAt: pos.openedAt },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2700.0);

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.breakevenApplied).toBe(true);
      expect(tracked.currentSL).toBe(2700.0);
    });

    it('should move SL to entry when profit exceeds breakevenTriggerPips (SELL)', async () => {
      // Entry at 2700, current at 2699.95 → 5 pips profit for SELL
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2699.95, stopLevel: 2705, profitLevel: 2690, pnl: 5, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2700.0);

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.breakevenApplied).toBe(true);
    });

    it('should NOT move breakeven if profit is below trigger', async () => {
      // Entry at 2700, current at 2700.02 → 2 pips profit (< 3 trigger)
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.02, stopLevel: 2695, profitLevel: 2710, pnl: 2, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).not.toHaveBeenCalled();
    });

    it('should NOT move breakeven for BUY if new SL would be worse', async () => {
      // Edge case: SL is already above entry (e.g. trailing moved it before)
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.10, stopLevel: 2700.05, profitLevel: 2710, pnl: 10, openedAt: new Date() },
      ]);

      await monitor.tick();

      // Breakeven would be 2700, but current SL is 2700.05 — should not downgrade
      expect(adapter.updateStopLoss).not.toHaveBeenCalled();
    });

    it('should only apply breakeven once', async () => {
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.05, stopLevel: 2695, profitLevel: 2710, pnl: 5, openedAt: new Date() },
      ]);

      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenCalledTimes(1);

      // Second tick — breakeven already applied, should not call again (for breakeven)
      adapter.updateStopLoss.mockClear();
      // Disable trailing to isolate breakeven test
      strategyConfig.trailingStopEnabled = false;
      await monitor.tick();
      expect(adapter.updateStopLoss).not.toHaveBeenCalled();
    });
  });

  // ─── Trailing Stop ────────────────────────────────────────────────────────

  describe('trailing stop', () => {
    beforeEach(() => {
      strategyConfig.breakevenEnabled = false; // Isolate trailing tests
    });

    it('should activate trailing and update SL when profit exceeds activation pips (BUY)', async () => {
      // 5 pips activation, 3 pips trail distance → entry=2700, price=2700.08 (8 pips profit)
      // Trail SL = 2700.08 - 0.03 = 2700.05
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2700.08 - 0.03);

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.trailingActive).toBe(true);
      expect(tracked.trailingStopLevel).toBeCloseTo(2700.05);
      expect(tracked.currentSL).toBeCloseTo(2700.05);
    });

    it('should activate trailing and update SL (SELL)', async () => {
      // SELL at 2700, price at 2699.90 → 10 pips profit → trail SL = 2699.90 + 0.03 = 2699.93
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2699.90, stopLevel: 2705, profitLevel: 2690, pnl: 10, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2699.90 + 0.03);

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.trailingActive).toBe(true);
      expect(tracked.trailingStopLevel).toBeCloseTo(2699.93);
    });

    it('should NOT activate trailing if profit is below activation threshold', async () => {
      // 3 pips profit, activation is 5
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.03, stopLevel: 2695, profitLevel: 2710, pnl: 3, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(adapter.updateStopLoss).not.toHaveBeenCalled();
      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.trailingActive).toBe(false);
    });

    it('should ratchet SL up (BUY) — never move it backwards', async () => {
      // Tick 1: price at 2700.08 → trail SL = 2700.05
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenLastCalledWith('deal-1', expect.closeTo(2700.05, 5));

      // Tick 2: price moves up to 2700.12 → trail SL = 2700.09 (should update)
      adapter.updateStopLoss.mockClear();
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.12, stopLevel: 2700.05, profitLevel: 2710, pnl: 12, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenLastCalledWith('deal-1', expect.closeTo(2700.09, 5));

      // Tick 3: price drops to 2700.07 → trail SL would be 2700.04, but existing is 2700.09 — NO update
      adapter.updateStopLoss.mockClear();
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.07, stopLevel: 2700.09, profitLevel: 2710, pnl: 7, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).not.toHaveBeenCalled();

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.trailingStopLevel).toBeCloseTo(2700.09); // Not downgraded
    });

    it('should ratchet SL down (SELL) — never move it backwards', async () => {
      // Tick 1: SELL at 2700, price at 2699.90 → trail SL = 2699.93
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2699.90, stopLevel: 2705, profitLevel: 2690, pnl: 10, openedAt: new Date() },
      ]);
      await monitor.tick();

      // Tick 2: price at 2699.80 → trail SL = 2699.83 (lower → update)
      adapter.updateStopLoss.mockClear();
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2699.80, stopLevel: 2699.93, profitLevel: 2690, pnl: 20, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenLastCalledWith('deal-1', expect.closeTo(2699.83, 5));

      // Tick 3: price bounces to 2699.92 → trail SL would be 2699.95, but 2699.83 is lower → no update
      adapter.updateStopLoss.mockClear();
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2699.92, stopLevel: 2699.83, profitLevel: 2690, pnl: 8, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).not.toHaveBeenCalled();
    });
  });

  // ─── ATR-based trailing ───────────────────────────────────────────────────

  describe('ATR-based trailing', () => {
    beforeEach(() => {
      strategyConfig.breakevenEnabled = false;
      strategyConfig.useAtrTrailing = true;
      strategyConfig.trailingAtrMultiplier = 1.0;
      strategyConfig.atrPeriod = 14;
    });

    it('should use ATR-based trail distance when enabled', async () => {
      // Generate enough candles for ATR(14) calculation
      const candles = generateCandles(20, { basePrice: 2700, spread: 0.10 });
      // Inject candles into marketData by accessing the private array via prototype
      (marketData as unknown as { candles: typeof candles }).candles = candles;

      // Price at 2700.10 → 10 pips profit (activates at 5)
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.10, stopLevel: 2695, profitLevel: 2710, pnl: 10, openedAt: new Date() },
      ]);

      await monitor.tick();

      // The ATR value depends on the generated candle data — just verify the method was called
      expect(adapter.updateStopLoss).toHaveBeenCalledTimes(1);
      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.trailingActive).toBe(true);
      expect(tracked.trailingStopLevel).not.toBeNull();
    });

    it('should fall back to fixed pips if not enough candles for ATR', async () => {
      // Only 5 candles — not enough for ATR(14)
      const candles = generateCandles(5, { basePrice: 2700 });
      (marketData as unknown as { candles: typeof candles }).candles = candles;

      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.10, stopLevel: 2695, profitLevel: 2710, pnl: 10, openedAt: new Date() },
      ]);

      await monitor.tick();

      // Falls back to fixed: 2700.10 - 3 pips * 0.01 = 2700.07
      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', expect.closeTo(2700.07, 5));
    });
  });

  // ─── Combined breakeven + trailing ────────────────────────────────────────

  describe('breakeven + trailing combined', () => {
    it('should apply breakeven first, then trailing takes over', async () => {
      strategyConfig.breakevenEnabled = true;
      strategyConfig.trailingStopEnabled = true;
      strategyConfig.breakevenTriggerPips = 3; // BE at 3 pips
      strategyConfig.trailingActivationPips = 5; // Trail at 5 pips

      // Tick 1: 4 pips profit → breakeven fires (>=3), trailing doesn't (< 5)
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.04, stopLevel: 2695, profitLevel: 2710, pnl: 4, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', 2700.0); // Breakeven

      // Tick 2: 8 pips profit → trailing activates, SL = 2700.08 - 0.03 = 2700.05
      adapter.updateStopLoss.mockClear();
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2700, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', expect.closeTo(2700.05, 5));

      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.breakevenApplied).toBe(true);
      expect(tracked.trailingActive).toBe(true);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should skip tick if both trailing and breakeven are disabled', async () => {
      strategyConfig.trailingStopEnabled = false;
      strategyConfig.breakevenEnabled = false;

      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.10, stopLevel: 2695, profitLevel: 2710, pnl: 10, openedAt: new Date() },
      ]);

      await monitor.tick();
      expect(adapter.getOpenPositions).not.toHaveBeenCalled(); // Short-circuits before fetching
    });

    it('should clean up tracked state when positions are closed', async () => {
      // Tick 1: position exists
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(monitor.getTrackedPositions().has('deal-1')).toBe(true);

      // Tick 2: position no longer exists
      adapter.getOpenPositions.mockResolvedValue([]);
      await monitor.tick();
      expect(monitor.getTrackedPositions().has('deal-1')).toBe(false);
    });

    it('should handle multiple positions independently', async () => {
      strategyConfig.breakevenEnabled = false;

      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
        { dealId: 'deal-2', symbol: 'XAU_USD', direction: 'SELL', size: 1, entryLevel: 2700, currentLevel: 2700.02, stopLevel: 2705, profitLevel: 2690, pnl: -2, openedAt: new Date() },
      ]);

      await monitor.tick();

      // deal-1 has 8 pips profit → trailing activates
      // deal-2 is losing → no trailing
      expect(adapter.updateStopLoss).toHaveBeenCalledTimes(1);
      expect(adapter.updateStopLoss).toHaveBeenCalledWith('deal-1', expect.closeTo(2700.05, 5));

      const t1 = monitor.getTrackedPositions().get('deal-1')!;
      const t2 = monitor.getTrackedPositions().get('deal-2')!;
      expect(t1.trailingActive).toBe(true);
      expect(t2.trailingActive).toBe(false);
    });

    it('should handle broker errors gracefully', async () => {
      adapter.getOpenPositions.mockRejectedValue(new Error('Connection lost'));

      // Should not throw
      await expect(monitor.tick()).resolves.not.toThrow();
    });

    it('should handle updateStopLoss failure gracefully', async () => {
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);
      adapter.updateStopLoss.mockRejectedValue(new Error('Broker rejected'));

      // Should not throw — error is caught internally
      await expect(monitor.tick()).resolves.not.toThrow();

      // State should NOT be updated since the broker call failed
      const tracked = monitor.getTrackedPositions().get('deal-1')!;
      expect(tracked.currentSL).toBe(2695); // Unchanged
    });
  });

  // ─── Events ───────────────────────────────────────────────────────────────

  describe('events', () => {
    it('should emit sl:update on breakeven', async () => {
      const events: StopLossUpdate[] = [];
      monitor.on('sl:update', (update: StopLossUpdate) => events.push(update));

      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.05, stopLevel: 2695, profitLevel: 2710, pnl: 5, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(events).toHaveLength(2); // breakeven + trailing (both fire at 5 pips)
      const beEvent = events.find((e) => e.reason === 'breakeven')!;
      expect(beEvent).toBeDefined();
      expect(beEvent.oldSL).toBe(2695);
      expect(beEvent.newSL).toBe(2700);
      expect(beEvent.brokerId).toBe('deal-1');
    });

    it('should emit sl:update on trailing stop', async () => {
      strategyConfig.breakevenEnabled = false;
      const events: StopLossUpdate[] = [];
      monitor.on('sl:update', (update: StopLossUpdate) => events.push(update));

      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);

      await monitor.tick();

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('trailing');
      expect(events[0].trailingActive).toBe(true);
      expect(events[0].trailingStopLevel).toBeCloseTo(2700.05);
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and stop cleanly', () => {
      expect(monitor.isRunning()).toBe(false);
      monitor.start();
      expect(monitor.isRunning()).toBe(true);
      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it('should clear tracked state on stop', async () => {
      adapter.getOpenPositions.mockResolvedValue([
        { dealId: 'deal-1', symbol: 'XAU_USD', direction: 'BUY', size: 1, entryLevel: 2700, currentLevel: 2700.08, stopLevel: 2695, profitLevel: 2710, pnl: 8, openedAt: new Date() },
      ]);
      await monitor.tick();
      expect(monitor.getTrackedPositions().size).toBe(1);

      monitor.stop();
      expect(monitor.getTrackedPositions().size).toBe(0);
    });

    it('should not start twice', () => {
      monitor.start();
      monitor.start(); // idempotent
      expect(monitor.isRunning()).toBe(true);
      monitor.stop();
    });
  });
});
