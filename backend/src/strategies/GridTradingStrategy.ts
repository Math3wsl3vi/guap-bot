import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig, GridTradingConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import {
  BaseStrategy,
  Signal,
  GridOrder,
  LifecycleStrategy,
} from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'GridTradingStrategy';

// ─── Internal grid state ──────────────────────────────────────────────────────

export type GridLevelStatus = 'PENDING' | 'FILLED' | 'CANCELLED';

export interface GridLevel {
  price: number;
  direction: 'BUY' | 'SELL';
  orderId: string | null;
  status: GridLevelStatus;
  profitLevel: number;
}

export interface GridState {
  centerPrice: number;
  levels: GridLevel[];
  initialized: boolean;
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class GridTradingStrategy extends BaseStrategy implements LifecycleStrategy {
  readonly name = 'Grid Trading';
  readonly type: StrategyType = 'GRID_TRADING';

  private state: GridState;
  private readonly cfg: GridTradingConfig;
  private readonly adxPeriod: number;

  /** Minimum candles for ADX to be valid: 2 × period + 1. */
  private readonly minCandles: number;

  constructor() {
    super();
    this.cfg = strategyConfig.gridTrading;
    this.adxPeriod = strategyConfig.adxPeriod;
    this.minCandles = this.adxPeriod * 2 + 1;
    this.state = { centerPrice: 0, levels: [], initialized: false };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  initialize(currentPrice: number): Signal {
    const { gridLevels, gridSpacing, lotSizePerLevel, takeProfitPerLevel } = this.cfg;
    const symbol = strategyConfig.symbol;

    this.state.centerPrice = currentPrice;
    this.state.levels = [];

    const gridOrders: GridOrder[] = [];

    // BUY limits below current price
    for (let i = 1; i <= gridLevels; i++) {
      const price = currentPrice - i * gridSpacing;
      const profitLevel = price + takeProfitPerLevel;

      this.state.levels.push({
        price,
        direction: 'BUY',
        orderId: null,
        status: 'PENDING',
        profitLevel,
      });
      gridOrders.push({ symbol, direction: 'BUY', size: lotSizePerLevel, price, profitLevel });
    }

    // SELL limits above current price
    for (let i = 1; i <= gridLevels; i++) {
      const price = currentPrice + i * gridSpacing;
      const profitLevel = price - takeProfitPerLevel;

      this.state.levels.push({
        price,
        direction: 'SELL',
        orderId: null,
        status: 'PENDING',
        profitLevel,
      });
      gridOrders.push({ symbol, direction: 'SELL', size: lotSizePerLevel, price, profitLevel });
    }

    this.state.initialized = true;

    logger.info('Grid initialized', {
      component: COMPONENT,
      center: currentPrice,
      levels: gridLevels,
      spacing: gridSpacing,
      totalOrders: gridOrders.length,
    });

    return {
      action: 'HOLD',
      reason: `Grid initialized: ${gridLevels} levels each side, center $${currentPrice.toFixed(2)}, spacing $${gridSpacing}`,
      strategyType: this.type,
      gridAction: 'INIT',
      gridOrders,
    };
  }

  shutdown(): Signal {
    const cancelOrderIds = this.state.levels
      .filter((l) => l.orderId && l.status === 'PENDING')
      .map((l) => l.orderId!);

    logger.info('Grid shutting down', {
      component: COMPONENT,
      ordersToCancel: cancelOrderIds.length,
    });

    this.state.initialized = false;
    this.state.levels = [];
    this.state.centerPrice = 0;

    return {
      action: 'HOLD',
      reason: `Grid shutdown: cancelling ${cancelOrderIds.length} pending orders`,
      strategyType: this.type,
      gridAction: 'SHUTDOWN',
      cancelOrderIds,
    };
  }

  isGridInitialized(): boolean {
    return this.state.initialized;
  }

  confirmOrderPlaced(price: number, direction: 'BUY' | 'SELL', orderId: string): void {
    const level = this.state.levels.find(
      (l) => l.price === price && l.direction === direction && l.orderId === null,
    );
    if (level) {
      level.orderId = orderId;
      logger.debug('Grid level confirmed placed', {
        component: COMPONENT,
        orderId,
        price,
        direction,
      });
    }
  }

  confirmOrderFilled(orderId: string): void {
    const level = this.state.levels.find(
      (l) => l.orderId === orderId && l.status === 'PENDING',
    );
    if (level) {
      level.status = 'FILLED';
      logger.info('Grid order filled', {
        component: COMPONENT,
        orderId,
        price: level.price,
        direction: level.direction,
      });
    }
  }

  confirmOrdersCancelled(orderIds: string[]): void {
    const idSet = new Set(orderIds);
    for (const level of this.state.levels) {
      if (level.orderId && idSet.has(level.orderId)) {
        level.status = 'CANCELLED';
      }
    }
  }

  getState(): Readonly<GridState> {
    return {
      centerPrice: this.state.centerPrice,
      levels: this.state.levels.map((l) => ({ ...l })),
      initialized: this.state.initialized,
    };
  }

  // ─── Per-candle evaluation ──────────────────────────────────────────────────

  evaluate(candles: readonly Candle[]): Signal {
    if (!this.state.initialized) {
      return {
        action: 'HOLD',
        reason: 'Grid not yet initialized',
        strategyType: this.type,
        gridAction: 'MONITOR',
      };
    }

    const currentPrice = candles[candles.length - 1].close;

    // ── Safety 1: ADX trend detection ─────────────────────────────────────
    if (this.cfg.trendDetectionEnabled && candles.length >= this.minCandles) {
      const { adx } = TechnicalIndicators.calculateADX(candles, this.adxPeriod);
      const adxCurr = adx[adx.length - 1];

      if (!isNaN(adxCurr) && adxCurr > this.cfg.trendAdxThreshold) {
        const shutdownSignal = this.shutdown();
        shutdownSignal.reason = `Strong trend detected: ADX ${adxCurr.toFixed(1)} > ${this.cfg.trendAdxThreshold} — grid shutdown`;
        return shutdownSignal;
      }
    }

    // ── Rebalance check ───────────────────────────────────────────────────
    const drift = Math.abs(currentPrice - this.state.centerPrice);
    const rebalanceThreshold = (this.cfg.gridLevels * this.cfg.gridSpacing) / 2;

    if (drift > rebalanceThreshold) {
      const cancelOrderIds = this.state.levels
        .filter((l) => l.orderId && l.status === 'PENDING')
        .map((l) => l.orderId!);

      const newGridOrders = this.calculateNewGrid(currentPrice);

      // Reset state for the new grid
      this.state.centerPrice = currentPrice;
      this.state.levels = newGridOrders.map((o) => ({
        price: o.price,
        direction: o.direction,
        orderId: null,
        status: 'PENDING' as const,
        profitLevel: o.profitLevel,
      }));

      logger.info('Grid rebalancing', {
        component: COMPONENT,
        drift: drift.toFixed(2),
        threshold: rebalanceThreshold.toFixed(2),
        oldCenter: this.state.centerPrice,
        newCenter: currentPrice,
      });

      return {
        action: 'HOLD',
        reason: `Grid rebalance: price drifted $${drift.toFixed(2)} from center $${this.state.centerPrice.toFixed(2)}`,
        strategyType: this.type,
        gridAction: 'REBALANCE',
        cancelOrderIds,
        gridOrders: newGridOrders,
      };
    }

    // ── Normal monitoring ─────────────────────────────────────────────────
    const pendingCount = this.state.levels.filter((l) => l.status === 'PENDING').length;
    const filledCount = this.state.levels.filter((l) => l.status === 'FILLED').length;

    return {
      action: 'HOLD',
      reason: `Grid healthy: ${pendingCount} pending, ${filledCount} filled, center $${this.state.centerPrice.toFixed(2)}`,
      strategyType: this.type,
      gridAction: 'MONITOR',
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private calculateNewGrid(currentPrice: number): GridOrder[] {
    const { gridLevels, gridSpacing, lotSizePerLevel, takeProfitPerLevel } = this.cfg;
    const symbol = strategyConfig.symbol;
    const orders: GridOrder[] = [];

    for (let i = 1; i <= gridLevels; i++) {
      const buyPrice = currentPrice - i * gridSpacing;
      orders.push({
        symbol,
        direction: 'BUY',
        size: lotSizePerLevel,
        price: buyPrice,
        profitLevel: buyPrice + takeProfitPerLevel,
      });

      const sellPrice = currentPrice + i * gridSpacing;
      orders.push({
        symbol,
        direction: 'SELL',
        size: lotSizePerLevel,
        price: sellPrice,
        profitLevel: sellPrice - takeProfitPerLevel,
      });
    }

    return orders;
  }
}
