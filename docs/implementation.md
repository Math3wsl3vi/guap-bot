# Implementation Roadmap

## Current State

| Layer | Status | Notes |
|---|---|---|
| Frontend | Scaffolded | React + Vite + Shadcn. All pages, components, types, and Zustand store exist — running on mock data |
| Backend | Phase 6 Complete | TechnicalIndicators (EMA/RSI/MACD), IBrokerAdapter interface, CapitalComAdapter (market data + order execution), MarketDataService with rolling window + exponential backoff reconnect, BaseStrategy, EMAScalpStrategy, RiskManager with circuit breakers, OrderService with retry logic, DatabaseService (PostgreSQL), bot.ts main event loop, ApiServer (Express REST + WebSocket, all Phase 5 endpoints), LogBuffer in-memory transport, Jest test suite (100 tests: 27 unit + 73 integration), backtesting runner |

The frontend is ready and waiting. Every implementation task below is backend-first until Phase 5 when the two are wired together.

## Broker Selection

Capital.com is the selected broker. Alternative brokers for API-based forex/gold trading:

| Broker | API | XAU/USD | Free Demo | Best For |
|--------|-----|---------|-----------|----------|
| **MetaApi.cloud** | REST + WebSocket | Yes | Free tier (1 account) | Wraps any MT4/MT5 broker into a clean API. Use with Exness, XM, IC Markets, etc. |
| **Capital.com** | REST + WebSocket | Yes | Free | Good docs, low spreads, wide country support |
| **FXCM** | REST + WebSocket | Yes | Free | Established, good for scalping |
| **cTrader (Spotware Open API)** | REST + WebSocket | Yes | Free | Modern API, used by many brokers |

**Recommended approach:** Use MetaApi.cloud with any MT5 broker available in your country. The bot architecture uses a broker adapter interface so swapping brokers only changes one file.

---

## Phase 1 — Backend Foundation

> Goal: Runnable TypeScript project with logging and config loaded from environment.

- [x] Initialize `backend/package.json` with dependencies: `ts-node`, `nodemon`, `winston`, `dotenv`, `express`, `ws`, `axios`, `pg`, `ioredis`
- [x] Add `backend/tsconfig.json` with strict mode
- [x] Create folder structure: `src/config/`, `src/services/`, `src/strategies/`, `src/indicators/`, `src/models/`, `src/utils/`
- [x] **Models** — define core data structures (everything else depends on these)
  - `src/models/Candle.ts` — OHLCV + timestamp
  - `src/models/Trade.ts` — entry/exit price, SL, TP, status, P&L
  - `src/models/Position.ts` — open position tracking
- [x] **Logger** — `src/utils/logger.ts` (Winston, structured JSON output)
- [x] **Config files** — load from `.env`, export typed config objects
  - `src/config/broker.config.ts` — API key, base URL, WebSocket URL
  - `src/config/strategy.config.ts` — EMA periods, RSI settings, TP/SL pips
  - `src/config/risk.config.ts` — max risk per trade, daily loss limit, max drawdown, max positions
- [x] `.env.example` with all required keys documented
- [x] Verify: `npx ts-node src/bot.ts` starts without errors

---

## Phase 2 — Market Data Pipeline

> Goal: Receive live 1-minute candles from broker and store them in memory.

- [x] **TechnicalIndicators** — `src/indicators/TechnicalIndicators.ts`
  - `calculateEMA(prices: number[], period: number): number[]`
  - `calculateRSI(prices: number[], period: number): number[]`
  - `calculateMACD(prices: number[]): MACDResult`
  - Test all functions with static price arrays before going further
- [x] **MarketDataService** — `src/services/MarketDataService.ts`
  - Connect to broker streaming API via Capital.com REST + WebSocket (`CapitalComAdapter`)
  - Broker-agnostic via `IBrokerAdapter` interface — swap brokers by changing one file
  - Parse tick data into 1-minute OHLCV candles
  - Emit `candle:close` events when a 1-minute bar closes
  - Auto-reconnect on connection drop with exponential backoff (10 attempts, capped at 60s)
  - Keep rolling window of last 200 candles in memory (enough for EMA/RSI warmup)
  - Fetch historical candles on startup for indicator warmup

> **Broker note:** Capital.com is the active broker. The MarketDataService is broker-agnostic — isolate broker-specific API calls behind an adapter interface so swapping brokers only changes one file.

---

## Phase 3 — Strategy & Risk Engine

> Goal: Evaluate candles and produce validated trade signals.

- [x] **BaseStrategy** — `src/strategies/BaseStrategy.ts`
  - Abstract class with `evaluate(candles: Candle[]): Signal` method
  - `Signal` type: `{ action: 'BUY' | 'SELL' | 'HOLD', reason: string }`
- [x] **EMAScalpStrategy** — `src/strategies/EMAScalpStrategy.ts`
  - BUY: EMA(9) crosses above EMA(21) + RSI between 30–70
  - SELL: EMA(9) crosses below EMA(21) + RSI between 30–70
  - Log the signal reason for every decision (including HOLD)
- [x] **RiskManager** — `src/services/RiskManager.ts`
  - `calculatePositionSize(accountBalance, riskPercent, stopLossPips): number`
  - `canOpenTrade(currentPositions, dailyLoss, accountEquity): boolean`
  - Circuit breaker: halt all trading when daily loss limit hit
  - Circuit breaker: halt all trading when max drawdown hit
  - Enforce max 3 concurrent open positions

---

## Phase 4 — Order Execution & Persistence

> Goal: Place real orders on broker and persist every trade to the database.

- [x] **OrderService** — `src/services/OrderService.ts`
  - `placeMarketOrder(symbol, side, quantity, stopLoss, takeProfit): Promise<Trade>`
  - `closePosition(positionId): Promise<void>`
  - `updateStopLoss(positionId, newSL): Promise<void>` (for trailing stops)
  - Retry logic: up to 3 attempts on transient network errors
  - Respect broker rate limits
- [x] **DatabaseService** — `src/services/DatabaseService.ts`
  - PostgreSQL connection via `pg`
  - Schema: `trades` table (id, symbol, side, entry_price, exit_price, sl, tp, quantity, pnl, status, opened_at, closed_at)
  - `saveTrade(trade: Trade): Promise<void>`
  - `updateTrade(id: string, updates: Partial<Trade>): Promise<void>`
  - `getTradeHistory(limit: number): Promise<Trade[]>`

---

## Phase 5 — Frontend Integration

> Goal: Replace all mock data with live data from the backend.

- [x] **API server** in the backend (Express) — `src/services/ApiServer.ts`
  - `GET /api/status` — bot status, uptime, trades today
  - `GET /api/account` — balance, equity, margin, today's P&L
  - `GET /api/positions` — open positions
  - `GET /api/trades` — trade history with pagination
  - `GET /api/metrics` — win rate, profit factor, drawdown, Sharpe
  - `GET /api/logs` — recent log entries (in-memory circular buffer via `LogBuffer`)
  - `GET /api/candles` — last N candles from MarketDataService
  - `GET /api/health` — system health (API connection, WS, DB, Redis, latency)
  - `POST /api/bot/start` — start the bot
  - `POST /api/bot/stop` — stop the bot
  - `POST /api/bot/pause` — pause the bot
  - `PUT /api/strategy` — update strategy + risk config at runtime (re-instantiates strategy)
- [x] **WebSocket endpoint** on the backend for real-time push (same HTTP server, `ws` upgrade)
  - Broadcast on every candle close: `{ type: 'candle', data: CandleData }`
  - Broadcast on trade open/close: `{ type: 'trade', data: Trade }`
- [x] **Frontend: replace mock data**
  - `src/lib/api.ts` — typed fetch client for all endpoints
  - `src/lib/useWebSocket.ts` — WS hook with exponential-backoff reconnect
  - `botStore.ts` — stripped of mock data; Zustand holds UI state only
  - `Dashboard.tsx` — React Query for account, status, positions, metrics
  - `LiveChart.tsx` — initial candles from `GET /api/candles`, live updates via WebSocket
  - `BotControlPanel.tsx` — `useMutation` for start / stop / pause
  - `RecentTradesTable.tsx` — React Query `GET /api/trades`
  - `Logs.tsx` — React Query for `GET /api/logs` + `GET /api/health` (polling)
  - `Strategy.tsx` — loads config from `GET /api/strategy`, saves via `PUT /api/strategy`
- [x] **Bot entrypoint** — `src/bot.ts`
  - All services wired into the main event loop
  - `botState` object shared with ApiServer for start/stop/pause control
  - On every `candle:close` event: broadcasts candle → (if not paused) run strategy → check risk → place order → persist → broadcast trade
  - `API_PORT` env var (default `3001`) controls which port ApiServer listens on

---

## Phase 6 — Testing

> Do not skip. Bugs here cost real money.

- [x] **Unit tests** for all pure functions
  - EMA/RSI/MACD calculations (known input → known output) — 27 tests
  - Position sizing calculations — covered in RiskManager tests
  - Risk manager circuit breaker logic — covered in RiskManager tests
- [x] **Integration tests**
  - MarketDataService reconnect behavior — 12 tests (candle building + reconnect/backoff/fatal)
  - OrderService error handling and retries — 18 tests (placeOrder, closePosition, updateSL, getPositions)
- [x] **Backtesting** — `npm run backtest` (or `--candles N` / `--file data.csv`)
  - Synthetic data mode built-in for immediate testing
  - Supports real CSV data (Dukascopy/FXCM format: Date, Open, High, Low, Close, Volume)
  - Reports: win rate, profit factor, max drawdown, Sharpe ratio, P&L, consecutive losses
  - Verdict section flags strategy weaknesses before paper trading
  - Download 6–12 months of real 1-minute OHLCV data and run: `npm run backtest -- --file data.csv`
- [ ] **Paper trading on broker demo** — minimum 8 weeks
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
