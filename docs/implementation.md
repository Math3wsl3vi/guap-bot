# Implementation Roadmap

## Current State

| Layer | Status | Notes |
|---|---|---|
| Frontend | Scaffolded | React + Vite + Shadcn. All pages, components, types, and Zustand store exist — running on mock data |
| Backend | Empty | Directory exists, no source files. All trading logic lives here |

The frontend is ready and waiting. Every implementation task below is backend-first until Phase 5 when the two are wired together.

---

## Phase 1 — Backend Foundation

> Goal: Runnable TypeScript project with logging and config loaded from environment.

- [ ] Initialize `backend/package.json` with dependencies: `ts-node`, `nodemon`, `winston`, `dotenv`, `express`, `ws`, `axios`, `pg`, `ioredis`
- [ ] Add `backend/tsconfig.json` with strict mode
- [ ] Create folder structure: `src/config/`, `src/services/`, `src/strategies/`, `src/indicators/`, `src/models/`, `src/utils/`
- [ ] **Models** — define core data structures (everything else depends on these)
  - `src/models/Candle.ts` — OHLCV + timestamp
  - `src/models/Trade.ts` — entry/exit price, SL, TP, status, P&L
  - `src/models/Position.ts` — open position tracking
- [ ] **Logger** — `src/utils/logger.ts` (Winston, structured JSON output)
- [ ] **Config files** — load from `.env`, export typed config objects
  - `src/config/broker.config.ts` — API key, base URL, WebSocket URL
  - `src/config/strategy.config.ts` — EMA periods, RSI settings, TP/SL pips
  - `src/config/risk.config.ts` — max risk per trade, daily loss limit, max drawdown, max positions
- [ ] `.env.example` with all required keys documented
- [ ] Verify: `npx ts-node src/bot.ts` starts without errors

---

## Phase 2 — Market Data Pipeline

> Goal: Receive live 1-minute candles from broker and store them in memory.

- [ ] **TechnicalIndicators** — `src/indicators/TechnicalIndicators.ts`
  - `calculateEMA(prices: number[], period: number): number[]`
  - `calculateRSI(prices: number[], period: number): number[]`
  - `calculateMACD(prices: number[]): MACDResult`
  - Test all functions with static price arrays before going further
- [ ] **MarketDataService** — `src/services/MarketDataService.ts`
  - WebSocket connection to OANDA streaming API
  - Parse tick data into 1-minute OHLCV candles
  - Emit `candle:close` events when a 1-minute bar closes
  - Auto-reconnect on WebSocket drop with exponential backoff
  - Keep rolling window of last N candles in memory (enough for EMA/RSI warmup)

---

## Phase 3 — Strategy & Risk Engine

> Goal: Evaluate candles and produce validated trade signals.

- [ ] **BaseStrategy** — `src/strategies/BaseStrategy.ts`
  - Abstract class with `evaluate(candles: Candle[]): Signal` method
  - `Signal` type: `{ action: 'BUY' | 'SELL' | 'HOLD', reason: string }`
- [ ] **EMAScalpStrategy** — `src/strategies/EMAScalpStrategy.ts`
  - BUY: EMA(9) crosses above EMA(21) + RSI between 30–70
  - SELL: EMA(9) crosses below EMA(21) + RSI between 30–70
  - Log the signal reason for every decision (including HOLD)
- [ ] **RiskManager** — `src/services/RiskManager.ts`
  - `calculatePositionSize(accountBalance, riskPercent, stopLossPips): number`
  - `canOpenTrade(currentPositions, dailyLoss, accountEquity): boolean`
  - Circuit breaker: halt all trading when daily loss limit hit
  - Circuit breaker: halt all trading when max drawdown hit
  - Enforce max 3 concurrent open positions

---

## Phase 4 — Order Execution & Persistence

> Goal: Place real orders on broker and persist every trade to the database.

- [ ] **OrderService** — `src/services/OrderService.ts`
  - `placeMarketOrder(symbol, side, quantity, stopLoss, takeProfit): Promise<Trade>`
  - `closePosition(positionId): Promise<void>`
  - `updateStopLoss(positionId, newSL): Promise<void>` (for trailing stops)
  - Retry logic: up to 3 attempts on transient network errors
  - Respect OANDA rate limits
- [ ] **DatabaseService** — `src/services/DatabaseService.ts`
  - PostgreSQL connection via `pg`
  - Schema: `trades` table (id, symbol, side, entry_price, exit_price, sl, tp, quantity, pnl, status, opened_at, closed_at)
  - `saveTrade(trade: Trade): Promise<void>`
  - `updateTrade(id: string, updates: Partial<Trade>): Promise<void>`
  - `getTradeHistory(limit: number): Promise<Trade[]>`

---

## Phase 5 — Frontend Integration

> Goal: Replace all mock data with live data from the backend.

- [ ] **API server** in the backend (Express)
  - `GET /api/status` — bot status, uptime, trades today
  - `GET /api/account` — balance, equity, margin, today's P&L
  - `GET /api/positions` — open positions
  - `GET /api/trades` — trade history with pagination
  - `GET /api/metrics` — win rate, profit factor, drawdown, Sharpe
  - `GET /api/logs` — recent log entries
  - `GET /api/health` — system health (API connection, WS, DB, Redis, latency)
  - `POST /api/bot/start` — start the bot
  - `POST /api/bot/stop` — stop the bot
  - `POST /api/bot/pause` — pause the bot
  - `PUT /api/strategy` — update strategy config
- [ ] **WebSocket endpoint** on the backend for real-time push
  - Broadcast on every candle close: `{ type: 'candle', data: CandleData }`
  - Broadcast on trade open/close: `{ type: 'trade', data: Trade }`
  - Broadcast on bot status change
- [ ] **Frontend: replace mock data**
  - Update `botStore.ts` to fetch from backend API via React Query
  - Connect `LiveChart` to the WebSocket stream
  - Connect `Logs` page to `GET /api/logs` (polling or WebSocket)
  - Connect `Strategy` page `PUT /api/strategy` on save
- [ ] **Bot entrypoint** — `src/bot.ts`
  - Wire up all services into the main event loop
  - On every `candle:close` event: run strategy → check risk → place order → persist

---

## Phase 6 — Testing

> Do not skip. Bugs here cost real money.

- [ ] **Unit tests** for all pure functions
  - EMA/RSI/MACD calculations (known input → known output)
  - Position sizing calculations
  - Risk manager circuit breaker logic
- [ ] **Integration tests**
  - MarketDataService reconnect behavior
  - OrderService error handling and retries
- [ ] **Backtesting**
  - Download 6–12 months of 1-minute OHLCV data (Dukascopy or FXCM)
  - Run EMAScalpStrategy against historical data
  - Measure: win rate, profit factor, max drawdown, Sharpe ratio
  - Iterate on strategy parameters before going to demo
- [ ] **Paper trading on OANDA demo** — minimum 8 weeks
  - Track all metrics from `BotMetrics` interface
  - Compare live results to backtest expectations

---

## Phase 7 — Production Deployment

> Only after Phase 6 shows consistent profitability.

- [ ] Provision VPS (2 cores, 4GB RAM, Ubuntu 22.04, located in London for forex)
- [ ] Set up PostgreSQL and Redis on VPS
- [ ] Configure PM2 for process management and auto-restart
- [ ] Set up Telegram notifications for critical events (circuit breaker, errors, daily summary)
- [ ] Deploy with minimum position sizes
- [ ] Monitor 24/7 for the first week
- [ ] Gradually scale based on 30-day performance review

---

## Dependency Map

```
Models
  └── TechnicalIndicators
        └── MarketDataService
              └── EMAScalpStrategy (BaseStrategy)
                    └── RiskManager
                          └── OrderService
                                └── DatabaseService
                                      └── bot.ts (main loop)
                                            └── API Server (frontend connects here)
```

Build and test each layer before starting the next one.
