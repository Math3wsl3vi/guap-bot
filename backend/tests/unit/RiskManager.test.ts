// Mock the logger to prevent file I/O during tests
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Mock risk config with known, stable values so tests are environment-independent
jest.mock('../../src/config/risk.config', () => ({
  riskConfig: {
    maxRiskPerTrade: 0.01,
    maxDailyLoss: 0.03,      // 3%
    maxDrawdown: 0.15,        // 15%
    maxOpenPositions: 3,
    minRiskRewardRatio: 1.5,
    maxSlippagePips: 2,
    stalePositionTimeoutMinutes: 30,
  },
}));

import { RiskManager } from '../../src/services/RiskManager';
import { Position } from '../../src/models/Position';

// Minimal Position factory
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'p1',
    brokerId: 'b1',
    symbol: 'XAU_USD',
    type: 'BUY',
    entryPrice: 2000,
    currentPrice: 2000,
    stopLoss: 1995,
    takeProfit: 2010,
    quantity: 100,
    unrealisedPnL: 0,
    unrealisedPnLPercent: 0,
    openedAt: new Date(),
    trailingStopActive: false,
    ...overrides,
  };
}

describe('RiskManager', () => {
  // ─── calculatePositionSize ──────────────────────────────────────────────

  describe('calculatePositionSize', () => {
    it('calculates correct position size for standard inputs', () => {
      const rm = new RiskManager(10_000);
      // riskAmount = 10000 * 0.01 = 100
      // raw = 100 / (5 * 0.01) = 2000
      expect(rm.calculatePositionSize(10_000, 0.01, 5, 0.01)).toBe(2000);
    });

    it('floors result to 2 decimal places (no over-sizing)', () => {
      const rm = new RiskManager(10_000);
      // riskAmount = 10000 * 0.005 = 50
      // raw = 50 / (3 * 0.01) = 1666.666... → floored to 1666.66
      const size = rm.calculatePositionSize(10_000, 0.005, 3, 0.01);
      expect(size).toBe(1666.66);
    });

    it('scales correctly with different account balances', () => {
      const rm = new RiskManager(20_000);
      const sizeSmall = rm.calculatePositionSize(10_000, 0.01, 5, 0.01);
      const sizeLarge = rm.calculatePositionSize(20_000, 0.01, 5, 0.01);
      expect(sizeLarge).toBe(sizeSmall * 2);
    });

    it('throws when accountBalance <= 0', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.calculatePositionSize(0, 0.01, 5, 0.01)).toThrow();
      expect(() => rm.calculatePositionSize(-100, 0.01, 5, 0.01)).toThrow();
    });

    it('throws when riskPercent is out of range', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.calculatePositionSize(10_000, 0, 5, 0.01)).toThrow();
      expect(() => rm.calculatePositionSize(10_000, 1.1, 5, 0.01)).toThrow();
    });

    it('throws when stopLossPips <= 0', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.calculatePositionSize(10_000, 0.01, 0, 0.01)).toThrow();
    });

    it('throws when pipValue <= 0', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.calculatePositionSize(10_000, 0.01, 5, 0)).toThrow();
    });

    it('allows riskPercent = 1 (100% of account at risk)', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.calculatePositionSize(10_000, 1, 5, 0.01)).not.toThrow();
    });
  });

  // ─── canOpenTrade ────────────────────────────────────────────────────────

  describe('canOpenTrade', () => {
    it('returns true when no positions and circuit breaker is inactive', () => {
      const rm = new RiskManager(10_000);
      expect(rm.canOpenTrade([], 10_000)).toBe(true);
    });

    it('returns false when circuit breaker is already active', () => {
      const rm = new RiskManager(10_000);
      // Trip via max drawdown (equity drops 15%)
      rm.recordTradePnL(0, 8_500); // drawdown = (10000-8500)/10000 = 15%
      expect(rm.isCircuitBreakerActive()).toBe(true);
      expect(rm.canOpenTrade([], 8_500)).toBe(false);
    });

    it('returns false when max open positions (3) is reached', () => {
      const rm = new RiskManager(10_000);
      const positions = [makePosition(), makePosition({ id: 'p2' }), makePosition({ id: 'p3' })];
      expect(rm.canOpenTrade(positions, 10_000)).toBe(false);
    });

    it('allows trading with fewer than max positions', () => {
      const rm = new RiskManager(10_000);
      const positions = [makePosition(), makePosition({ id: 'p2' })];
      expect(rm.canOpenTrade(positions, 10_000)).toBe(true);
    });

    it('trips the circuit breaker mid-check if daily loss limit is just reached', () => {
      const rm = new RiskManager(10_000);
      // Manually set dailyLoss just below limit then check
      rm.recordTradePnL(299, 9_701); // 299 < 300 → no trip
      expect(rm.canOpenTrade([], 9_701)).toBe(true);
      rm.recordTradePnL(1, 9_700);   // 300 >= 300 → trip
      expect(rm.canOpenTrade([], 9_700)).toBe(false);
    });
  });

  // ─── Circuit breaker — daily loss ────────────────────────────────────────

  describe('circuit breaker — daily loss limit', () => {
    it('does not trip when daily loss is below the limit', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(299, 9_701); // limit = 10000 * 0.03 = 300
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });

    it('trips exactly at the daily loss limit (>=)', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(300, 9_700); // 300 >= 300
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });

    it('trips above the daily loss limit', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(500, 9_500);
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });

    it('accumulates loss across multiple losing trades', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(150, 9_850);
      expect(rm.isCircuitBreakerActive()).toBe(false);
      rm.recordTradePnL(150, 9_700); // total = 300 → trip
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });

    it('does not accumulate gains (negative amount ignored)', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(-200, 10_200); // gain — should not affect dailyLoss
      expect(rm.getState().dailyLoss).toBe(0);
    });
  });

  // ─── Circuit breaker — max drawdown ──────────────────────────────────────

  describe('circuit breaker — max drawdown', () => {
    it('does not trip when drawdown is below 15%', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(0, 8_501); // drawdown = 14.99%
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });

    it('trips exactly at 15% drawdown', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(0, 8_500); // drawdown = (10000-8500)/10000 = 15%
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });

    it('trips beyond 15% drawdown', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(0, 8_000); // drawdown = 20%
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });

    it('updates peak equity when equity rises above previous peak', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(-500, 10_500); // profit: equity above initial → new peak
      const state = rm.getState();
      expect(state.peakEquity).toBe(10_500);
    });

    it('uses updated peak for drawdown calculation', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(-500, 10_500); // peak → 10500
      rm.recordTradePnL(0, 9_000);     // drawdown = (10500-9000)/10500 ≈ 14.3% → no trip
      expect(rm.isCircuitBreakerActive()).toBe(false);
      rm.recordTradePnL(0, 8_900);     // drawdown = (10500-8900)/10500 ≈ 15.2% → trip
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });
  });

  // ─── resetDailyLoss ──────────────────────────────────────────────────────

  describe('resetDailyLoss', () => {
    it('clears the daily loss counter', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(150, 9_850);
      rm.resetDailyLoss();
      expect(rm.getState().dailyLoss).toBe(0);
    });

    it('clears a daily-loss circuit breaker', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(300, 9_700); // trip via daily loss
      expect(rm.isCircuitBreakerActive()).toBe(true);
      rm.resetDailyLoss();
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });

    it('does NOT clear a drawdown circuit breaker (persists across days)', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(0, 8_500); // trip via drawdown
      expect(rm.isCircuitBreakerActive()).toBe(true);
      rm.resetDailyLoss();
      expect(rm.isCircuitBreakerActive()).toBe(true);
    });
  });

  // ─── resetCircuitBreaker ─────────────────────────────────────────────────

  describe('resetCircuitBreaker', () => {
    it('clears an active daily-loss circuit breaker', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(300, 9_700);
      rm.resetCircuitBreaker();
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });

    it('clears an active drawdown circuit breaker', () => {
      const rm = new RiskManager(10_000);
      rm.recordTradePnL(0, 8_500);
      rm.resetCircuitBreaker();
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });

    it('is a no-op when circuit breaker is not active', () => {
      const rm = new RiskManager(10_000);
      expect(() => rm.resetCircuitBreaker()).not.toThrow();
      expect(rm.isCircuitBreakerActive()).toBe(false);
    });
  });

  // ─── getState ────────────────────────────────────────────────────────────

  describe('getState', () => {
    it('returns a snapshot (not a live reference)', () => {
      const rm = new RiskManager(10_000);
      const state1 = rm.getState();
      rm.recordTradePnL(100, 9_900);
      const state2 = rm.getState();
      expect(state1.dailyLoss).toBe(0);
      expect(state2.dailyLoss).toBe(100);
    });

    it('reflects initial equity as peakEquity', () => {
      const rm = new RiskManager(15_000);
      expect(rm.getState().peakEquity).toBe(15_000);
    });

    it('starts with circuit breaker inactive', () => {
      const rm = new RiskManager(10_000);
      expect(rm.getState().circuitBreakerActive).toBe(false);
    });
  });
});
