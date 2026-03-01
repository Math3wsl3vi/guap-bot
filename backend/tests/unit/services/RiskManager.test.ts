import { RiskManager } from '../../../src/services/RiskManager';
import { riskConfig } from '../../../src/config/risk.config';
import { Position } from '../../../src/models/Position';

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('RiskManager', () => {
  // Snapshot defaults
  const originalConfig = { ...riskConfig };

  beforeEach(() => {
    Object.assign(riskConfig, {
      maxRiskPerTrade: 0.01,
      maxDailyLoss: 0.03,
      maxDrawdown: 0.15,
      maxOpenPositions: 3,
      minRiskRewardRatio: 1.5,
      maxSlippagePips: 2,
      stalePositionTimeoutMinutes: 30,
      minPositionSize: 1,
    });
  });

  afterEach(() => {
    Object.assign(riskConfig, originalConfig);
  });

  // ── Position Sizing ─────────────────────────────────────────────────────────

  describe('calculatePositionSize()', () => {
    it('should calculate correct position size', () => {
      const rm = new RiskManager(10000);
      // balance=10000, risk=1%, SL=5 pips, pipValue=0.01
      // riskAmount = 100, size = 100 / (5 * 0.01) = 2000
      const size = rm.calculatePositionSize(10000, 0.01, 5, 0.01);
      expect(size).toBe(2000);
    });

    it('should floor the result to 2 decimal places', () => {
      const rm = new RiskManager(10000);
      // riskAmount = 100, size = 100 / (3 * 0.01) = 3333.33...
      const size = rm.calculatePositionSize(10000, 0.01, 3, 0.01);
      expect(size).toBe(3333.33);
    });

    it('should throw when accountBalance is 0 or negative', () => {
      const rm = new RiskManager(10000);
      expect(() => rm.calculatePositionSize(0, 0.01, 5)).toThrow('accountBalance must be > 0');
      expect(() => rm.calculatePositionSize(-100, 0.01, 5)).toThrow('accountBalance must be > 0');
    });

    it('should throw when riskPercent is out of (0, 1]', () => {
      const rm = new RiskManager(10000);
      expect(() => rm.calculatePositionSize(10000, 0, 5)).toThrow('riskPercent must be in (0, 1]');
      expect(() => rm.calculatePositionSize(10000, 1.5, 5)).toThrow('riskPercent must be in (0, 1]');
    });

    it('should throw when stopLossPips is 0 or negative', () => {
      const rm = new RiskManager(10000);
      expect(() => rm.calculatePositionSize(10000, 0.01, 0)).toThrow('stopLossPips must be > 0');
    });

    it('should use default pipValue of 0.01', () => {
      const rm = new RiskManager(10000);
      const size = rm.calculatePositionSize(10000, 0.01, 5);
      // 100 / (5 * 0.01) = 2000
      expect(size).toBe(2000);
    });
  });

  // ── Trade Gate ──────────────────────────────────────────────────────────────

  describe('canOpenTrade()', () => {
    it('should allow trade when all conditions are met', () => {
      const rm = new RiskManager(10000);
      const result = rm.canOpenTrade([], 10000);
      expect(result).toBe(true);
    });

    it('should block when max open positions is reached', () => {
      const rm = new RiskManager(10000);
      const positions: Position[] = Array.from({ length: 3 }, (_, i) => ({
        id: `pos-${i}`,
        symbol: 'XAU_USD',
        type: 'BUY' as const,
        entryPrice: 2700,
        currentPrice: 2700,
        stopLoss: 2695,
        takeProfit: 2710,
        quantity: 1,
        unrealisedPnL: 0,
        unrealisedPnLPercent: 0,
        openedAt: new Date(),
        trailingStopActive: false,
      }));

      expect(rm.canOpenTrade(positions, 10000)).toBe(false);
    });

    it('should block when circuit breaker is active', () => {
      const rm = new RiskManager(10000);
      // Trip the circuit breaker via daily loss
      rm.recordTradePnL(500, 9500); // loss > 3% of 10000 = 300
      expect(rm.canOpenTrade([], 9500)).toBe(false);
    });

    it('should block when daily loss limit is hit during check', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(250, 9750);
      // Not yet tripped (250 < 300), but equity drop triggers drawdown check
      expect(rm.canOpenTrade([], 9750)).toBe(true);

      rm.recordTradePnL(60, 9690);
      // Now 310 > 300 (3% of 10000 peak equity)
      expect(rm.canOpenTrade([], 9690)).toBe(false);
    });
  });

  // ── Circuit Breaker ─────────────────────────────────────────────────────────

  describe('circuit breaker', () => {
    it('should trip on daily loss exceeding limit', () => {
      const rm = new RiskManager(10000);
      // 3% of 10000 = 300
      rm.recordTradePnL(350, 9650);

      expect(rm.isCircuitBreakerActive()).toBe(true);
      const state = rm.getState();
      expect(state.circuitBreakerReason).toContain('Daily loss limit');
    });

    it('should trip on max drawdown exceeding limit', () => {
      const rm = new RiskManager(10000);
      // 15% drawdown = equity at 8500
      rm.recordTradePnL(0, 8400); // 16% drawdown

      expect(rm.isCircuitBreakerActive()).toBe(true);
      const state = rm.getState();
      expect(state.circuitBreakerReason).toContain('Max drawdown');
    });

    it('should track peak equity correctly', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(-100, 10100); // Profit (negative = gain) — this doesn't add to dailyLoss
      // Peak should now be 10100

      const state = rm.getState();
      expect(state.peakEquity).toBe(10100);
    });

    it('should not trip circuit breaker on profitable trades', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(-50, 10050); // Profit

      expect(rm.isCircuitBreakerActive()).toBe(false);
      expect(rm.getState().dailyLoss).toBe(0); // Only losses count
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────────

  describe('resetDailyLoss()', () => {
    it('should clear the daily loss counter', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(200, 9800);

      rm.resetDailyLoss();
      expect(rm.getState().dailyLoss).toBe(0);
    });

    it('should clear daily-loss circuit breaker but not drawdown breaker', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(350, 9650);
      expect(rm.isCircuitBreakerActive()).toBe(true);

      rm.resetDailyLoss();
      // Daily loss circuit breaker should be cleared
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });
  });

  describe('resetCircuitBreaker()', () => {
    it('should manually clear the circuit breaker', () => {
      const rm = new RiskManager(10000);
      rm.recordTradePnL(350, 9650);
      expect(rm.isCircuitBreakerActive()).toBe(true);

      rm.resetCircuitBreaker();
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });
  });

  // ── State ──────────────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('should return the current risk state', () => {
      const rm = new RiskManager(10000);
      const state = rm.getState();

      expect(state.dailyLoss).toBe(0);
      expect(state.peakEquity).toBe(10000);
      expect(state.circuitBreakerActive).toBe(false);
    });
  });
});
