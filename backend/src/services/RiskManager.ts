import { riskConfig } from '../config/risk.config';
import { Position } from '../models/Position';
import { logger } from '../utils/logger';

const COMPONENT = 'RiskManager';

export interface RiskState {
  dailyLoss: number;        // Realised loss today (positive = loss, e.g. 150 means -$150)
  peakEquity: number;       // Highest equity reached (for drawdown tracking)
  circuitBreakerActive: boolean;
  circuitBreakerReason?: string;
}

export class RiskManager {
  private state: RiskState;

  constructor(initialEquity: number) {
    this.state = {
      dailyLoss: 0,
      peakEquity: initialEquity,
      circuitBreakerActive: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Position sizing
  // ---------------------------------------------------------------------------

  /**
   * Calculate position size (units / lots) given a fixed pip stop loss.
   *
   * Formula: units = (accountBalance * riskPercent) / (stopLossPips * pipValue)
   *
   * For XAU/USD, 1 pip ≈ $0.01 per ounce (i.e. pipValue = 0.01 per unit).
   * Callers should pass the correct pipValue for their instrument.
   *
   * @param accountBalance  Current account balance in account currency
   * @param riskPercent     Fraction of balance to risk, e.g. 0.01 for 1%
   * @param stopLossPips    Distance to stop loss in pips
   * @param pipValue        Monetary value of 1 pip per 1 unit of the instrument (default 0.01)
   * @returns               Position size in units, floored to 2 decimal places
   */
  calculatePositionSize(
    accountBalance: number,
    riskPercent: number,
    stopLossPips: number,
    pipValue = 0.01,
  ): number {
    if (accountBalance <= 0) throw new Error('accountBalance must be > 0');
    if (riskPercent <= 0 || riskPercent > 1) throw new Error('riskPercent must be in (0, 1]');
    if (stopLossPips <= 0) throw new Error('stopLossPips must be > 0');
    if (pipValue <= 0) throw new Error('pipValue must be > 0');

    const riskAmount = accountBalance * riskPercent;
    const raw = riskAmount / (stopLossPips * pipValue);
    const size = Math.floor(raw * 100) / 100; // floor to 2dp to avoid over-sizing

    logger.debug('Position size calculated', {
      component: COMPONENT,
      accountBalance,
      riskPercent,
      stopLossPips,
      pipValue,
      riskAmount,
      size,
    });

    return size;
  }

  // ---------------------------------------------------------------------------
  // Trade gate
  // ---------------------------------------------------------------------------

  /**
   * Returns true if a new trade may be opened.
   * Checks: circuit breaker → open position count → daily loss → drawdown.
   */
  canOpenTrade(
    currentPositions: Position[],
    accountEquity: number,
  ): boolean {
    if (this.state.circuitBreakerActive) {
      logger.warn('Trade blocked — circuit breaker is active', {
        component: COMPONENT,
        reason: this.state.circuitBreakerReason,
      });
      return false;
    }

    if (currentPositions.length >= riskConfig.maxOpenPositions) {
      logger.info('Trade blocked — max open positions reached', {
        component: COMPONENT,
        openPositions: currentPositions.length,
        max: riskConfig.maxOpenPositions,
      });
      return false;
    }

    // Re-evaluate circuit breaker with current equity (daily loss + drawdown)
    this.evaluateCircuitBreakers(accountEquity);
    if (this.state.circuitBreakerActive) {
      logger.warn('Trade blocked — circuit breaker tripped during pre-trade check', {
        component: COMPONENT,
        reason: this.state.circuitBreakerReason,
      });
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Circuit breaker management
  // ---------------------------------------------------------------------------

  /**
   * Record a realised loss/gain after a trade closes.
   * Pass a positive value for a loss, negative for a gain.
   * Then re-check circuit breakers.
   *
   * @param amount  Signed P&L in account currency (negative = profit, positive = loss)
   * @param accountEquity  Current account equity after the trade
   */
  recordTradePnL(amount: number, accountEquity: number): void {
    if (amount > 0) {
      this.state.dailyLoss += amount;
    }
    // Track peak equity for drawdown calculation
    if (accountEquity > this.state.peakEquity) {
      this.state.peakEquity = accountEquity;
    }
    this.evaluateCircuitBreakers(accountEquity);
  }

  /**
   * Reset daily loss counter (call at the start of each trading day).
   */
  resetDailyLoss(): void {
    logger.info('Daily loss counter reset', {
      component: COMPONENT,
      previousDailyLoss: this.state.dailyLoss,
    });
    this.state.dailyLoss = 0;

    // Re-evaluate: drawdown circuit breaker persists across days, daily one is cleared
    if (
      this.state.circuitBreakerActive &&
      this.state.circuitBreakerReason?.startsWith('Daily loss')
    ) {
      this.state.circuitBreakerActive = false;
      this.state.circuitBreakerReason = undefined;
      logger.info('Daily-loss circuit breaker cleared after daily reset', { component: COMPONENT });
    }
  }

  /**
   * Manually disengage the circuit breaker (operator override).
   * Use with caution — typically only after investigating the trigger cause.
   */
  resetCircuitBreaker(): void {
    logger.warn('Circuit breaker manually reset by operator', { component: COMPONENT });
    this.state.circuitBreakerActive = false;
    this.state.circuitBreakerReason = undefined;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  getState(): Readonly<RiskState> {
    return { ...this.state };
  }

  isCircuitBreakerActive(): boolean {
    return this.state.circuitBreakerActive;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private evaluateCircuitBreakers(accountEquity: number): void {
    if (this.state.circuitBreakerActive) return; // already tripped

    const dailyLossLimit = this.state.peakEquity * riskConfig.maxDailyLoss;
    if (this.state.dailyLoss >= dailyLossLimit) {
      this.tripCircuitBreaker(
        `Daily loss limit reached: $${this.state.dailyLoss.toFixed(2)} >= $${dailyLossLimit.toFixed(2)} (${(riskConfig.maxDailyLoss * 100).toFixed(1)}% of peak equity)`,
      );
      return;
    }

    if (this.state.peakEquity > 0) {
      const drawdown = (this.state.peakEquity - accountEquity) / this.state.peakEquity;
      if (drawdown >= riskConfig.maxDrawdown) {
        this.tripCircuitBreaker(
          `Max drawdown reached: ${(drawdown * 100).toFixed(2)}% >= ${(riskConfig.maxDrawdown * 100).toFixed(1)}% (equity $${accountEquity.toFixed(2)}, peak $${this.state.peakEquity.toFixed(2)})`,
        );
      }
    }
  }

  private tripCircuitBreaker(reason: string): void {
    this.state.circuitBreakerActive = true;
    this.state.circuitBreakerReason = reason;
    logger.error(`CIRCUIT BREAKER TRIPPED — all trading halted: ${reason}`, {
      component: COMPONENT,
    });
  }
}
