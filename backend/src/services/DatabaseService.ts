import { Pool } from 'pg';
import { Trade, TradeType } from '../models/Trade';
import { logger } from '../utils/logger';

const COMPONENT = 'DatabaseService';

const CREATE_TRADES_TABLE = `
  CREATE TABLE IF NOT EXISTS trades (
    id            TEXT        PRIMARY KEY,
    broker_id     TEXT,
    symbol        TEXT        NOT NULL,
    type          TEXT        NOT NULL,
    entry_price   NUMERIC     NOT NULL DEFAULT 0,
    exit_price    NUMERIC,
    stop_loss     NUMERIC     NOT NULL DEFAULT 0,
    take_profit   NUMERIC     NOT NULL DEFAULT 0,
    quantity      NUMERIC     NOT NULL,
    profit_loss   NUMERIC     NOT NULL DEFAULT 0,
    profit_loss_pct NUMERIC   NOT NULL DEFAULT 0,
    commission    NUMERIC,
    slippage      NUMERIC,
    status        TEXT        NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
    strategy_signal TEXT,
    strategy_type TEXT,
    opened_at     TIMESTAMPTZ NOT NULL,
    closed_at     TIMESTAMPTZ,
    duration_ms   BIGINT
  );
`;

/** Migrate existing tables that may be missing newer columns. */
const MIGRATIONS = [
  // Change id column from UUID to TEXT to support Deriv numeric contract IDs
  `ALTER TABLE trades ALTER COLUMN id TYPE TEXT`,
  `ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_type TEXT`,
  // Relax old CHECK constraint on type column (drop if exists, no-op if already dropped)
  `DO $$ BEGIN
     ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_type_check;
   EXCEPTION WHEN undefined_object THEN NULL;
   END $$`,
  // Allow entry_price, stop_loss, take_profit to default to 0 (for binary/accumulator trades)
  `ALTER TABLE trades ALTER COLUMN entry_price SET DEFAULT 0`,
  `ALTER TABLE trades ALTER COLUMN stop_loss SET DEFAULT 0`,
  `ALTER TABLE trades ALTER COLUMN take_profit SET DEFAULT 0`,
];

export interface TradeQueryFilters {
  from?: string;       // ISO date string
  to?: string;         // ISO date string
  strategy?: string;   // strategy_type filter
  status?: 'OPEN' | 'CLOSED';
  outcome?: 'win' | 'loss';
  minSize?: number;
  maxSize?: number;
  limit?: number;
  offset?: number;
}

export class DatabaseService {
  private readonly pool: Pool;

  constructor(connectionString?: string) {
    const cs = connectionString ?? process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL environment variable is not set');
    this.pool = new Pool({ connectionString: cs });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(CREATE_TRADES_TABLE);
      for (const migration of MIGRATIONS) {
        await client.query(migration).catch((err) => {
          logger.warn('Migration skipped', { component: COMPONENT, error: (err as Error).message });
        });
      }
      logger.info('Database initialised — trades table ready', { component: COMPONENT });
    } finally {
      client.release();
    }
  }

  /** Persist a new trade record (status = OPEN). */
  async saveTrade(trade: Trade): Promise<void> {
    await this.pool.query(
      `INSERT INTO trades
         (id, broker_id, symbol, type, entry_price, stop_loss, take_profit,
          quantity, profit_loss, profit_loss_pct, commission, slippage,
          status, strategy_signal, strategy_type, opened_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [
        trade.id,
        trade.brokerId ?? null,
        trade.symbol,
        trade.type,
        trade.entryPrice,
        trade.stopLoss,
        trade.takeProfit,
        trade.quantity,
        trade.profitLoss,
        trade.profitLossPercent,
        trade.commission ?? null,
        trade.slippage ?? null,
        trade.status,
        trade.strategySignal ?? null,
        trade.strategyType ?? null,
        trade.openedAt,
      ],
    );
    logger.debug('Trade saved', { component: COMPONENT, tradeId: trade.id });
  }

  /**
   * Apply partial updates to a trade (e.g. on close: exit_price, pnl, status, closed_at).
   * Only columns present in `updates` are written.
   */
  async updateTrade(id: string, updates: Partial<Trade>): Promise<void> {
    const colMap: Record<keyof Trade, string> = {
      id: 'id',
      brokerId: 'broker_id',
      symbol: 'symbol',
      type: 'type',
      entryPrice: 'entry_price',
      exitPrice: 'exit_price',
      currentPrice: 'exit_price',
      stopLoss: 'stop_loss',
      takeProfit: 'take_profit',
      quantity: 'quantity',
      profitLoss: 'profit_loss',
      profitLossPercent: 'profit_loss_pct',
      commission: 'commission',
      slippage: 'slippage',
      status: 'status',
      strategySignal: 'strategy_signal',
      strategyType: 'strategy_type',
      openedAt: 'opened_at',
      closedAt: 'closed_at',
      duration: 'duration_ms',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(updates) as [keyof Trade, unknown][]) {
      if (key === 'id') continue;
      const col = colMap[key];
      if (!col) continue;
      setClauses.push(`${col} = $${paramIdx++}`);
      values.push(value);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE trades SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      values,
    );
    logger.debug('Trade updated', { component: COMPONENT, tradeId: id });
  }

  /** Fetch the most recent `limit` closed and open trades, newest first. */
  async getTradeHistory(limit = 100): Promise<Trade[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM trades ORDER BY opened_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(this.rowToTrade);
  }

  /** Fetch trades with optional filters for the trades table UI. */
  async getFilteredTrades(filters: TradeQueryFilters): Promise<{ trades: Trade[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (filters.from) {
      conditions.push(`opened_at >= $${paramIdx++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`opened_at <= $${paramIdx++}`);
      values.push(filters.to);
    }
    if (filters.strategy) {
      conditions.push(`strategy_type = $${paramIdx++}`);
      values.push(filters.strategy);
    }
    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(filters.status);
    }
    if (filters.outcome === 'win') {
      conditions.push(`profit_loss > 0`);
    } else if (filters.outcome === 'loss') {
      conditions.push(`profit_loss <= 0`);
    }
    if (filters.minSize != null) {
      conditions.push(`quantity >= $${paramIdx++}`);
      values.push(filters.minSize);
    }
    if (filters.maxSize != null) {
      conditions.push(`quantity <= $${paramIdx++}`);
      values.push(filters.maxSize);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT * FROM trades ${where} ORDER BY opened_at DESC LIMIT ${limit} OFFSET ${offset}`,
        values,
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM trades ${where}`,
        values,
      ),
    ]);

    return {
      trades: dataResult.rows.map(this.rowToTrade),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /** Fetch all trades that are currently OPEN. */
  async getOpenTrades(): Promise<Trade[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM trades WHERE status = 'OPEN' ORDER BY opened_at ASC`,
    );
    return result.rows.map(this.rowToTrade);
  }

  /** Close the connection pool. */
  async disconnect(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed', { component: COMPONENT });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private rowToTrade(row: Record<string, unknown>): Trade {
    return {
      id: row.id as string,
      brokerId: (row.broker_id as string) ?? undefined,
      symbol: row.symbol as string,
      type: row.type as TradeType,
      entryPrice: parseFloat(row.entry_price as string),
      exitPrice: row.exit_price != null ? parseFloat(row.exit_price as string) : undefined,
      stopLoss: parseFloat(row.stop_loss as string),
      takeProfit: parseFloat(row.take_profit as string),
      quantity: parseFloat(row.quantity as string),
      profitLoss: parseFloat(row.profit_loss as string),
      profitLossPercent: parseFloat(row.profit_loss_pct as string),
      commission: row.commission != null ? parseFloat(row.commission as string) : undefined,
      slippage: row.slippage != null ? parseFloat(row.slippage as string) : undefined,
      status: row.status as 'OPEN' | 'CLOSED',
      strategySignal: (row.strategy_signal as string) ?? undefined,
      strategyType: (row.strategy_type as string) ?? undefined,
      openedAt: new Date(row.opened_at as string),
      closedAt: row.closed_at != null ? new Date(row.closed_at as string) : undefined,
      duration: row.duration_ms != null ? parseInt(row.duration_ms as string, 10) : undefined,
    };
  }
}
