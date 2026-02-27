import { randomUUID } from 'crypto';
import { IBrokerAdapter, BrokerPosition } from './IBrokerAdapter';
import { Trade } from '../models/Trade';
import { Position } from '../models/Position';
import { logger } from '../utils/logger';

const COMPONENT = 'OrderService';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

/** Transient HTTP errors worth retrying. */
function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  // Retry on network errors, timeouts, and 5xx broker errors
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('timeout') ||
    /5\d\d/.test(msg)
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
      const delay = RETRY_BASE_DELAY_MS * attempt;
      logger.warn(`${label} failed (attempt ${attempt}/${MAX_RETRIES}) — retrying in ${delay}ms`, {
        component: COMPONENT,
        error: (err as Error).message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export class OrderService {
  constructor(private readonly adapter: IBrokerAdapter) {}

  /**
   * Place a market order on the broker.
   * Returns a Trade object in OPEN status with the confirmed fill price.
   *
   * @param symbol      Internal symbol, e.g. 'XAU_USD'
   * @param side        'BUY' or 'SELL'
   * @param quantity    Position size in units
   * @param stopLoss    Absolute price level for stop loss
   * @param takeProfit  Absolute price level for take profit
   * @param signal      Optional strategy signal reason for audit trail
   */
  async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopLoss: number,
    takeProfit: number,
    signal?: string,
  ): Promise<Trade> {
    logger.info('Placing market order', {
      component: COMPONENT,
      symbol,
      side,
      quantity,
      stopLoss,
      takeProfit,
    });

    const result = await withRetry(
      () =>
        this.adapter.placeOrder({
          symbol,
          direction: side,
          size: quantity,
          stopLevel: stopLoss,
          profitLevel: takeProfit,
        }),
      'placeOrder',
    );

    const trade: Trade = {
      id: randomUUID(),
      brokerId: result.dealId,
      symbol,
      type: side,
      entryPrice: result.executedPrice,
      stopLoss,
      takeProfit,
      quantity,
      profitLoss: 0,
      profitLossPercent: 0,
      status: 'OPEN',
      openedAt: result.openedAt,
      strategySignal: signal,
    };

    logger.info('Market order filled', {
      component: COMPONENT,
      tradeId: trade.id,
      brokerId: trade.brokerId,
      entryPrice: trade.entryPrice,
      side,
      symbol,
    });

    return trade;
  }

  /**
   * Close an open position by its broker deal ID.
   * Returns a partial Trade update with exit price and P&L (caller should fetch
   * current price before calling, or read it from the broker confirms).
   *
   * @param positionId  The brokerId stored on the Trade when it was opened
   * @param exitPrice   Current market price at the time of closure (for P&L calc)
   */
  async closePosition(positionId: string, exitPrice: number, openTrade: Trade): Promise<Partial<Trade>> {
    logger.info('Closing position', { component: COMPONENT, positionId });

    await withRetry(
      () => this.adapter.closePosition(positionId),
      'closePosition',
    );

    const pnlRaw =
      openTrade.type === 'BUY'
        ? (exitPrice - openTrade.entryPrice) * openTrade.quantity
        : (openTrade.entryPrice - exitPrice) * openTrade.quantity;

    const profitLossPercent =
      openTrade.entryPrice > 0
        ? (pnlRaw / (openTrade.entryPrice * openTrade.quantity)) * 100
        : 0;

    const closedAt = new Date();

    logger.info('Position closed', {
      component: COMPONENT,
      positionId,
      exitPrice,
      pnl: pnlRaw.toFixed(4),
    });

    return {
      exitPrice,
      profitLoss: pnlRaw,
      profitLossPercent,
      status: 'CLOSED',
      closedAt,
      duration: closedAt.getTime() - openTrade.openedAt.getTime(),
    };
  }

  /**
   * Update the stop-loss level on an open position (trailing stop use case).
   *
   * @param positionId  The brokerId stored on the Trade
   * @param newSL       New absolute stop-loss price
   */
  async updateStopLoss(positionId: string, newSL: number): Promise<void> {
    logger.info('Updating stop loss', { component: COMPONENT, positionId, newSL });

    await withRetry(
      () => this.adapter.updateStopLoss(positionId, newSL),
      'updateStopLoss',
    );
  }

  /**
   * Fetch open positions from the broker and map them to the internal Position model.
   * Used by RiskManager to check max-positions and drawdown limits.
   */
  async getOpenPositions(): Promise<Position[]> {
    const brokerPositions: BrokerPosition[] = await withRetry(
      () => this.adapter.getOpenPositions(),
      'getOpenPositions',
    );

    return brokerPositions.map((bp): Position => {
      const unrealisedPnL = bp.pnl;
      const unrealisedPnLPercent =
        bp.entryLevel > 0
          ? (unrealisedPnL / (bp.entryLevel * bp.size)) * 100
          : 0;

      return {
        id: bp.dealId,
        brokerId: bp.dealId,
        symbol: bp.symbol,
        type: bp.direction,
        entryPrice: bp.entryLevel,
        currentPrice: bp.currentLevel,
        stopLoss: bp.stopLevel ?? 0,
        takeProfit: bp.profitLevel ?? 0,
        quantity: bp.size,
        unrealisedPnL,
        unrealisedPnLPercent,
        openedAt: bp.openedAt,
        trailingStopActive: false,
      };
    });
  }
}
