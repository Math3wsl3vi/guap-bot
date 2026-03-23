import EventEmitter from 'events';
import { Position } from '../models/Position';
import { OrderService } from './OrderService';
import { MarketDataService } from './MarketDataService';
import { TechnicalIndicators } from '../indicators/TechnicalIndicators';
import { strategyConfig } from '../config/strategy.config';
import { getInstrumentConfig } from '../config/instruments.config';
import { logger } from '../utils/logger';

const COMPONENT = 'PositionMonitor';

/**
 * Per-position state tracked by the monitor across ticks.
 * This lives in memory (not the database) — it's reconstructed on restart.
 */
export interface TrackedPosition {
  /** Broker deal ID */
  brokerId: string;
  entryPrice: number;
  direction: 'BUY' | 'SELL';
  symbol: string;
  /** Current stop loss level on the broker */
  currentSL: number;
  /** Whether the trailing stop has been activated */
  trailingActive: boolean;
  /** The current trailing stop level (ratchets, never goes backwards) */
  trailingStopLevel: number | null;
  /** Whether SL has already been moved to breakeven */
  breakevenApplied: boolean;
  /** Last known P&L and price — used when the position disappears (closed) */
  lastKnownPnL: number;
  lastKnownPrice: number;
  /** Timestamp (ms) when tracking began — used to compute duration on close */
  openedAtMs: number;
}

/**
 * Emitted when a tracked position is no longer open (closed by SL, TP, or manually).
 */
export interface PositionClosedEvent {
  brokerId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  /** Duration in milliseconds from open to close */
  durationMs: number;
}

/**
 * Emitted when a position's stop loss is updated.
 */
export interface StopLossUpdate {
  brokerId: string;
  oldSL: number;
  newSL: number;
  reason: 'trailing' | 'breakeven';
  trailingActive: boolean;
  trailingStopLevel: number | null;
}

/**
 * PositionMonitor
 *
 * Runs on a configurable interval (default 5s) and checks all open positions
 * for trailing stop and breakeven conditions. When a condition is met, it
 * updates the stop loss on the broker via OrderService.updateStopLoss().
 *
 * Events:
 *  - `sl:update` (update: StopLossUpdate) — emitted after a successful SL move
 */
export class PositionMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** In-memory state for each tracked position (keyed by brokerId) */
  private tracked = new Map<string, TrackedPosition>();

  constructor(
    private readonly orderService: OrderService,
    private readonly marketData: MarketDataService,
  ) {
    super();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    const interval = strategyConfig.positionMonitorIntervalMs;
    logger.info('PositionMonitor started', { component: COMPONENT, intervalMs: interval });

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('PositionMonitor tick error', {
          component: COMPONENT,
          error: (err as Error).message,
        });
      });
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.tracked.clear();
    logger.info('PositionMonitor stopped', { component: COMPONENT });
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Returns a snapshot of tracked positions (for API/WebSocket exposure). */
  getTrackedPositions(): ReadonlyMap<string, TrackedPosition> {
    return this.tracked;
  }

  // ─── Core tick — called every interval ──────────────────────────────────────

  async tick(): Promise<void> {
    const { trailingStopEnabled, breakevenEnabled } = strategyConfig;
    if (!trailingStopEnabled && !breakevenEnabled) return;

    // 1. Fetch current open positions from broker
    let positions: Position[];
    try {
      positions = await this.orderService.getOpenPositions();
    } catch {
      return; // Broker unavailable — skip this tick silently
    }

    if (positions.length === 0) {
      // Clean up stale tracked state
      this.tracked.clear();
      return;
    }

    // 2. Detect closed positions and emit events before pruning
    const liveIds = new Set(positions.map((p) => p.brokerId ?? p.id));
    for (const [id, state] of this.tracked.entries()) {
      if (!liveIds.has(id)) {
        this.emit('position:closed', {
          brokerId: state.brokerId,
          symbol: state.symbol,
          direction: state.direction,
          entryPrice: state.entryPrice,
          exitPrice: state.lastKnownPrice,
          pnl: state.lastKnownPnL,
          durationMs: Date.now() - state.openedAtMs,
        } satisfies PositionClosedEvent);
        this.tracked.delete(id);
      }
    }

    // 3. Compute current ATR if ATR-based trailing is enabled
    let currentAtr: number | undefined;
    if (strategyConfig.useAtrTrailing) {
      const candles = this.marketData.getCandles();
      if (candles.length >= strategyConfig.atrPeriod + 1) {
        const atrValues = TechnicalIndicators.calculateATR(
          candles as unknown as { high: number; low: number; close: number }[],
          strategyConfig.atrPeriod,
        );
        currentAtr = atrValues[atrValues.length - 1];
      }
    }

    // 4. Process each position
    for (const pos of positions) {
      const brokerId = pos.brokerId ?? pos.id;
      await this.processPosition(pos, brokerId, currentAtr);
    }
  }

  // ─── Per-position logic ─────────────────────────────────────────────────────

  private async processPosition(
    pos: Position,
    brokerId: string,
    currentAtr: number | undefined,
  ): Promise<void> {
    // Initialize tracking if this is a new position
    if (!this.tracked.has(brokerId)) {
      this.tracked.set(brokerId, {
        brokerId,
        entryPrice: pos.entryPrice,
        direction: pos.type as 'BUY' | 'SELL',
        symbol: pos.symbol,
        currentSL: pos.stopLoss,
        trailingActive: false,
        trailingStopLevel: null,
        breakevenApplied: false,
        lastKnownPnL: pos.unrealisedPnL,
        lastKnownPrice: pos.currentPrice,
        openedAtMs: Date.now(),
      });
    }

    const state = this.tracked.get(brokerId)!;
    // Keep last known values fresh — used when position disappears (closed)
    state.lastKnownPnL = pos.unrealisedPnL;
    state.lastKnownPrice = pos.currentPrice;
    const instrument = getInstrumentConfig(strategyConfig.symbol);
    const pipSize = instrument.pipSize;
    const currentPrice = pos.currentPrice;

    // Profit in pips (positive when in our favour)
    const profitPips = state.direction === 'BUY'
      ? (currentPrice - state.entryPrice) / pipSize
      : (state.entryPrice - currentPrice) / pipSize;

    // ── Breakeven ──────────────────────────────────────────────────────────
    if (
      strategyConfig.breakevenEnabled &&
      !state.breakevenApplied &&
      profitPips >= strategyConfig.breakevenTriggerPips
    ) {
      const newSL = state.entryPrice;

      // Only move SL if it's actually an improvement
      const isImprovement = state.direction === 'BUY'
        ? newSL > state.currentSL
        : newSL < state.currentSL;

      if (isImprovement) {
        try {
          await this.orderService.updateStopLoss(brokerId, newSL);
          const oldSL = state.currentSL;
          state.currentSL = newSL;
          state.breakevenApplied = true;

          logger.info('Breakeven applied', {
            component: COMPONENT,
            brokerId,
            entryPrice: state.entryPrice,
            oldSL,
            newSL,
            profitPips: profitPips.toFixed(1),
          });

          this.emit('sl:update', {
            brokerId,
            oldSL,
            newSL,
            reason: 'breakeven',
            trailingActive: state.trailingActive,
            trailingStopLevel: state.trailingStopLevel,
          } satisfies StopLossUpdate);
        } catch (err) {
          logger.warn('Failed to apply breakeven', {
            component: COMPONENT,
            brokerId,
            error: (err as Error).message,
          });
        }
      }
    }

    // ── Trailing Stop ──────────────────────────────────────────────────────
    if (strategyConfig.trailingStopEnabled) {
      const activationPips = strategyConfig.trailingActivationPips;

      // Activate trailing once profit exceeds activation threshold
      if (!state.trailingActive && profitPips >= activationPips) {
        state.trailingActive = true;
        logger.info('Trailing stop activated', {
          component: COMPONENT,
          brokerId,
          profitPips: profitPips.toFixed(1),
          activationPips,
        });
      }

      if (state.trailingActive) {
        // Calculate trail distance
        const trailDistance = this.getTrailDistance(currentAtr, pipSize);

        // Calculate new trailing SL
        const candidateSL = state.direction === 'BUY'
          ? currentPrice - trailDistance
          : currentPrice + trailDistance;

        // Ratchet: only move SL in the favourable direction
        const shouldUpdate = state.trailingStopLevel === null
          || (state.direction === 'BUY' ? candidateSL > state.trailingStopLevel : candidateSL < state.trailingStopLevel);

        if (shouldUpdate) {
          state.trailingStopLevel = candidateSL;

          // Only push to broker if it's better than the current broker SL
          const isBetterThanBroker = state.direction === 'BUY'
            ? candidateSL > state.currentSL
            : candidateSL < state.currentSL;

          if (isBetterThanBroker) {
            try {
              await this.orderService.updateStopLoss(brokerId, candidateSL);
              const oldSL = state.currentSL;
              state.currentSL = candidateSL;

              logger.info('Trailing stop updated', {
                component: COMPONENT,
                brokerId,
                oldSL,
                newSL: candidateSL,
                profitPips: profitPips.toFixed(1),
                trailDistance: (trailDistance / pipSize).toFixed(1),
              });

              this.emit('sl:update', {
                brokerId,
                oldSL,
                newSL: candidateSL,
                reason: 'trailing',
                trailingActive: true,
                trailingStopLevel: candidateSL,
              } satisfies StopLossUpdate);
            } catch (err) {
              logger.warn('Failed to update trailing stop', {
                component: COMPONENT,
                brokerId,
                error: (err as Error).message,
              });
            }
          }
        }
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Returns the trail distance in price units (not pips).
   * Uses ATR-based distance when enabled, otherwise fixed pips.
   */
  private getTrailDistance(currentAtr: number | undefined, pipSize: number): number {
    if (strategyConfig.useAtrTrailing && currentAtr !== undefined && currentAtr > 0) {
      return currentAtr * strategyConfig.trailingAtrMultiplier;
    }
    return strategyConfig.trailingStopPips * pipSize;
  }
}
