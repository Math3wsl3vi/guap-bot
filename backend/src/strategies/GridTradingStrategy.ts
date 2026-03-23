import { Candle } from '../models/Candle';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig, GridTradingConfig } from '../config/strategy.config';
import { logger } from '../utils/logger';
import {
  BaseStrategy,
  Signal,
  GridOrder,
  GridMode,
  VirtualFill,
  LifecycleStrategy,
} from './BaseStrategy';
import { StrategyType } from './StrategyType';

const COMPONENT = 'GridTradingStrategy';

// ─── Internal grid state ──────────────────────────────────────────────────────

export type GridLevelStatus =
  | 'PENDING'     // Limit order placed on broker (LIMIT mode)
  | 'WATCHING'    // Virtual level waiting for price crossing (VIRTUAL mode)
  | 'TRIGGERED'   // Price crossed level — market order in flight (VIRTUAL mode)
  | 'FILLED'      // Position opened (either mode)
  | 'CANCELLED';  // Level cancelled (rebalance/shutdown)

export interface GridLevel {
  price: number;
  direction: 'BUY' | 'SELL';
  orderId: string | null;
  status: GridLevelStatus;
  profitLevel: number;
  stopLevel: number;
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
  private readonly mode: GridMode;
  private readonly slPerLevel: number;

  /** Minimum candles for ADX to be valid: 2 × period + 1. */
  private readonly minCandles: number;

  constructor() {
    super();
    this.cfg = strategyConfig.gridTrading;
    this.adxPeriod = strategyConfig.adxPeriod;
    this.minCandles = this.adxPeriod * 2 + 1;
    this.mode = this.cfg.mode ?? (strategyConfig.broker === 'mt5' ? 'LIMIT' : 'VIRTUAL');
    this.slPerLevel = this.cfg.stopLossPerLevel ?? this.cfg.gridSpacing;
    this.state = { centerPrice: 0, levels: [], initialized: false };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  getGridMode(): GridMode {
    return this.mode;
  }

  initialize(currentPrice: number): Signal {
    const { gridLevels, gridSpacing, lotSizePerLevel, takeProfitPerLevel } = this.cfg;
    const symbol = strategyConfig.symbol;
    const isVirtual = this.mode === 'VIRTUAL';
    const initialStatus: GridLevelStatus = isVirtual ? 'WATCHING' : 'PENDING';

    this.state.centerPrice = currentPrice;
    this.state.levels = [];

    const gridOrders: GridOrder[] = [];

    // BUY limits below current price
    for (let i = 1; i <= gridLevels; i++) {
      const price = currentPrice - i * gridSpacing;
      const profitLevel = price + takeProfitPerLevel;
      const stopLevel = price - this.slPerLevel;

      this.state.levels.push({
        price,
        direction: 'BUY',
        orderId: null,
        status: initialStatus,
        profitLevel,
        stopLevel,
      });

      if (!isVirtual) {
        gridOrders.push({ symbol, direction: 'BUY', size: lotSizePerLevel, price, profitLevel });
      }
    }

    // SELL limits above current price
    for (let i = 1; i <= gridLevels; i++) {
      const price = currentPrice + i * gridSpacing;
      const profitLevel = price - takeProfitPerLevel;
      const stopLevel = price + this.slPerLevel;

      this.state.levels.push({
        price,
        direction: 'SELL',
        orderId: null,
        status: initialStatus,
        profitLevel,
        stopLevel,
      });

      if (!isVirtual) {
        gridOrders.push({ symbol, direction: 'SELL', size: lotSizePerLevel, price, profitLevel });
      }
    }

    this.state.initialized = true;

    logger.info('Grid initialized', {
      component: COMPONENT,
      mode: this.mode,
      center: currentPrice,
      levels: gridLevels,
      spacing: gridSpacing,
      totalOrders: isVirtual ? this.state.levels.length : gridOrders.length,
    });

    return {
      action: 'HOLD',
      reason: `Grid initialized (${this.mode}): ${gridLevels} levels each side, center $${currentPrice.toFixed(2)}, spacing $${gridSpacing}`,
      strategyType: this.type,
      gridAction: 'INIT',
      gridOrders: isVirtual ? undefined : gridOrders,
    };
  }

  shutdown(): Signal {
    // In VIRTUAL mode there are no broker-side orders to cancel
    const cancelOrderIds = this.mode === 'LIMIT'
      ? this.state.levels
          .filter((l) => l.orderId && l.status === 'PENDING')
          .map((l) => l.orderId!)
      : [];

    logger.info('Grid shutting down', {
      component: COMPONENT,
      mode: this.mode,
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

  // ─── Virtual grid: price crossing detection ────────────────────────────────

  checkPriceCrossings(candle: Candle, maxFills: number): Signal {
    if (!this.state.initialized || this.mode !== 'VIRTUAL') {
      return {
        action: 'HOLD',
        reason: 'Not in virtual mode or not initialized',
        strategyType: this.type,
        gridAction: 'MONITOR',
      };
    }

    const watchingLevels = this.state.levels.filter((l) => l.status === 'WATCHING');

    // Find all levels whose price was crossed by this candle
    const crossed: GridLevel[] = [];
    for (const level of watchingLevels) {
      if (level.direction === 'BUY' && candle.low <= level.price) {
        crossed.push(level);
      } else if (level.direction === 'SELL' && candle.high >= level.price) {
        crossed.push(level);
      }
    }

    if (crossed.length === 0) {
      return {
        action: 'HOLD',
        reason: 'No grid levels crossed',
        strategyType: this.type,
        gridAction: 'MONITOR',
      };
    }

    // Sort by distance from candle open (closest crossed first)
    crossed.sort(
      (a, b) => Math.abs(a.price - candle.open) - Math.abs(b.price - candle.open),
    );

    // Only trigger up to maxFills
    const toTrigger = crossed.slice(0, Math.max(0, maxFills));
    const virtualFills: VirtualFill[] = [];

    for (const level of toTrigger) {
      level.status = 'TRIGGERED';
      virtualFills.push({
        levelPrice: level.price,
        direction: level.direction,
        size: this.cfg.lotSizePerLevel,
        profitLevel: level.profitLevel,
        stopLevel: level.stopLevel,
      });
    }

    logger.info('Virtual grid levels triggered', {
      component: COMPONENT,
      triggered: virtualFills.length,
      skipped: crossed.length - virtualFills.length,
      levels: virtualFills.map((f) => `${f.direction}@${f.levelPrice}`),
    });

    return {
      action: 'HOLD',
      reason: `${virtualFills.length} grid level(s) triggered`,
      strategyType: this.type,
      gridAction: 'VIRTUAL_FILL',
      virtualFills,
    };
  }

  confirmVirtualFill(levelPrice: number, direction: 'BUY' | 'SELL', orderId: string): void {
    const level = this.state.levels.find(
      (l) => l.price === levelPrice && l.direction === direction && l.status === 'TRIGGERED',
    );
    if (level) {
      level.status = 'FILLED';
      level.orderId = orderId;
      logger.info('Virtual grid fill confirmed', {
        component: COMPONENT,
        orderId,
        price: levelPrice,
        direction,
      });
    }
  }

  revertTriggeredLevel(levelPrice: number, direction: 'BUY' | 'SELL'): void {
    const level = this.state.levels.find(
      (l) => l.price === levelPrice && l.direction === direction && l.status === 'TRIGGERED',
    );
    if (level) {
      level.status = 'WATCHING';
      logger.warn('Virtual grid level reverted to WATCHING', {
        component: COMPONENT,
        price: levelPrice,
        direction,
      });
    }
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
      // Defer rebalance if any virtual levels have in-flight market orders
      if (this.mode === 'VIRTUAL') {
        const inFlight = this.state.levels.filter((l) => l.status === 'TRIGGERED').length;
        if (inFlight > 0) {
          return {
            action: 'HOLD',
            reason: `Grid rebalance deferred: ${inFlight} level(s) in flight`,
            strategyType: this.type,
            gridAction: 'MONITOR',
          };
        }
      }

      const cancelOrderIds = this.mode === 'LIMIT'
        ? this.state.levels
            .filter((l) => l.orderId && l.status === 'PENDING')
            .map((l) => l.orderId!)
        : [];

      const newGridOrders = this.calculateNewGrid(currentPrice);

      // Reset state for the new grid
      const isVirtual = this.mode === 'VIRTUAL';
      const newStatus: GridLevelStatus = isVirtual ? 'WATCHING' : 'PENDING';
      this.state.centerPrice = currentPrice;
      this.state.levels = newGridOrders.map((o) => ({
        price: o.price,
        direction: o.direction,
        orderId: null,
        status: newStatus,
        profitLevel: o.profitLevel,
        stopLevel: o.direction === 'BUY' ? o.price - this.slPerLevel : o.price + this.slPerLevel,
      }));

      logger.info('Grid rebalancing', {
        component: COMPONENT,
        mode: this.mode,
        drift: drift.toFixed(2),
        threshold: rebalanceThreshold.toFixed(2),
        newCenter: currentPrice,
      });

      return {
        action: 'HOLD',
        reason: `Grid rebalance: price drifted $${drift.toFixed(2)} from center`,
        strategyType: this.type,
        gridAction: 'REBALANCE',
        cancelOrderIds,
        gridOrders: isVirtual ? undefined : newGridOrders,
      };
    }

    // ── Normal monitoring ─────────────────────────────────────────────────
    const activeStatus = this.mode === 'VIRTUAL' ? 'WATCHING' : 'PENDING';
    const pendingCount = this.state.levels.filter((l) => l.status === activeStatus).length;
    const filledCount = this.state.levels.filter((l) => l.status === 'FILLED').length;

    return {
      action: 'HOLD',
      reason: `Grid healthy: ${pendingCount} ${activeStatus.toLowerCase()}, ${filledCount} filled, center $${this.state.centerPrice.toFixed(2)}`,
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
