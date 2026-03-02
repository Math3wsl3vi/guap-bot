# Super Configurable Bot — Implementation Plan

## Current State Analysis

### What's Already Configurable
- EMA periods, RSI, ADX thresholds (via env + API)
- ATR-based dynamic stops (SL/TP multipliers)
- Spread filter, session filter, blocked hours
- Trading schedule (days, hours, timezone)
- Risk params (risk %, daily loss, drawdown, max positions)
- Symbol switching with instrument-specific pip sizes
- Strategy type switching (CONSERVATIVE, GRID — only 2 implemented)

### What's Missing
- **Multi-timeframe support** — hardcoded to 1m only
- **Trading style presets** — `usePresetRisk` flag exists but is never used
- **Session-based strategies** — London/NY open logic not implemented
- **Higher-timeframe trend filter** — no actual HTF candle data, just EMA(50) on 1m
- **Trailing stop execution** — declared in config but never runs in bot.ts
- **5 placeholder strategies** — AGGRESSIVE_SCALPING, LONDON_BREAKOUT, MEAN_REVERSION, NEWS_EVENT, HYBRID all have config stubs but no implementation

---

## Phase 1: Multi-Timeframe Candle Engine

**Goal:** Allow the bot to aggregate and serve candles at multiple timeframes (1m, 5m, 15m, 1h, 4h) simultaneously.

### Why First
Everything else depends on this. You can't do 15m trend-following, London breakout on 1h, or HTF confirmation without real multi-timeframe data. Currently EMA(50) on 1m is a poor proxy for 15m/1h trend.

### Changes

**MarketDataService.ts:**
- Add a `TimeframeAggregator` class that takes 1m candles and rolls them up into higher timeframes
- Maintain separate rolling windows per timeframe: `Map<Timeframe, Candle[]>`
- Emit `candle:close:<timeframe>` events (e.g., `candle:close:15m` fires every 15 minutes)
- Keep the existing 1m flow untouched — higher TFs are derived from it
- Configurable warmup per timeframe (e.g., 200 × 1m = 200 candles, but 15m needs 200 × 15 = 3000 ticks worth)

**bot.ts:**
- Subscribe to `candle:close:<timeframe>` based on `strategyConfig.timeframe`
- Pass multi-TF candle map to strategy: `strategy.evaluate(candles, htfCandles?)`

**BaseStrategy.ts:**
- Extend `evaluate()` signature to accept optional higher-timeframe candle data
- Backward compatible — strategies that don't need HTF ignore the extra param

**API:**
- `GET /api/candles?timeframe=15m` — serve candles at any aggregated timeframe
- Frontend chart can switch between timeframes

### Deliverables
- [ ] `TimeframeAggregator` class with tests
- [ ] Updated MarketDataService with multi-TF windows
- [ ] Updated bot.ts event subscription based on config
- [ ] Updated BaseStrategy interface
- [ ] API + frontend timeframe selector

---

## Phase 2: Trading Style Presets (Quick Actions)

**Goal:** One-click preset buttons that instantly reconfigure the entire bot for a specific trading style.

### Preset Definitions

Each preset is a complete snapshot of strategy + risk config values:

#### 1. "Micro Account Grower" (The $10→$100 Strategy)
```
Timeframe: 15m
EMA Fast: 9, EMA Slow: 21, EMA Trend: 50
RSI: 14 (OB: 75, OS: 25)
ADX Threshold: 20
ATR Stops: ON (SL mult: 1.5, TP mult: 3.0) → 1:2 R:R minimum
Spread Filter: 15 pips (relaxed for 15m holds)
Session Filter: London (07:00-10:00) + NY (12:00-15:00) UTC only
Risk/Trade: 8%
Max Positions: 1
Daily Loss: 15%
Trailing Stop: ON, activate at 1× ATR profit
```
*Rationale: High risk per trade on micro account, strict session windows for best setups, wide ATR stops to survive noise, 1:2+ R:R to grow despite losses.*

#### 2. "Conservative Scalper" (Current default, refined)
```
Timeframe: 1m
EMA Fast: 5, EMA Slow: 13, EMA Trend: 50
RSI: 14 (OB: 70, OS: 30)
ADX Threshold: 25
ATR Stops: ON (SL mult: 1.5, TP mult: 2.0)
Spread Filter: 5 pips
Session Filter: Full trading hours (08:00-17:00 UTC)
Risk/Trade: 1%
Max Positions: 1
Daily Loss: 3%
Trailing Stop: ON, activate at 1× ATR
```
*Rationale: Quick in-and-out, tight risk, works during active sessions.*

#### 3. "London Breakout"
```
Timeframe: 15m (entry), 1h (trend filter)
Entry Window: 07:00-09:00 UTC (London open)
Asian Range: calculated from 00:00-06:00 UTC high/low
Entry: Break above/below Asian range + volume confirmation
SL: Opposite side of Asian range
TP: 1.5× Asian range width
Risk/Trade: 2%
Max Positions: 1
Daily Loss: 5%
Trailing Stop: ON after 1:1 R:R reached
```
*Rationale: One high-probability trade per day. Asian range breakout is a well-tested institutional pattern.*

#### 4. "Trend Rider" (Swing-ish on lower timeframes)
```
Timeframe: 15m (entry), 1h (trend confirmation)
EMA Fast: 21, EMA Slow: 50, EMA Trend: 200
RSI: 14 (OB: 80, OS: 20) — extreme zones only
ADX Threshold: 25 (only trade strong trends)
ATR Stops: ON (SL mult: 2.0, TP mult: 4.0) → 1:2 R:R
Spread Filter: 20 pips
Session Filter: London + NY overlap (12:00-15:00 UTC)
Risk/Trade: 2%
Max Positions: 2
Daily Loss: 5%
Trailing Stop: ON, trail at 1.5× ATR
```
*Rationale: Catches bigger moves, fewer trades, higher conviction. Uses 1h trend as gate.*

#### 5. "Grid Scalper" (Range markets)
```
Strategy Type: GRID_TRADING
Grid Levels: 5
Grid Spacing: $2.00 (gold)
Lot Size/Level: calculated from risk %
TP/Level: $1.00
Max Drawdown: 5%
ADX Shutdown: 30 (exit grid if trend forms)
Risk/Trade: 0.5% per level
Session Filter: Asian session (00:00-06:00 UTC) — lowest volatility
```
*Rationale: Grid works in ranging markets. Asian session gold is often range-bound.*

### Implementation

**New file: `src/config/presets.ts`**
- Define `TradingPreset` interface (name, description, riskLevel, strategyConfig overrides, riskConfig overrides)
- Export a `PRESETS` map of all built-in presets
- Include a `custom` slot for user-saved presets

**API:**
- `GET /api/presets` — list all available presets with metadata
- `POST /api/presets/apply/:name` — apply a preset (mutates strategyConfig + riskConfig, re-instantiates strategy)
- `POST /api/presets/save` — save current config as a custom preset
- `DELETE /api/presets/:name` — delete a custom preset

**Frontend:**
- Preset cards/buttons at the top of the Strategy page
- Each card shows: name, risk level badge (LOW/MEDIUM/HIGH/EXTREME), timeframe, short description
- Click → confirmation modal ("This will override all current settings") → apply
- "Save Current as Preset" button
- Visual indicator of which preset is active (or "Custom" if modified)

### Deliverables
- [ ] `presets.ts` with all 5 built-in presets
- [ ] Preset API endpoints
- [ ] Frontend preset selector UI
- [ ] Confirmation modal before applying
- [ ] "Active preset" indicator

---

## Phase 3: Implement Placeholder Strategies

**Goal:** Build out the 5 placeholder strategies so they actually work with the preset system.

### 3a. Aggressive Scalping Strategy
- Faster EMAs (3/8), lower ADX threshold, tighter stops
- Requires 1m timeframe, high-liquidity sessions only
- More signals, lower win rate, relies on volume of trades

### 3b. London Breakout Strategy
- Calculate Asian session range (00:00-06:00 UTC high/low)
- Wait for London open (07:00 UTC)
- Entry on range breakout with confirmation candle
- SL at opposite range boundary
- TP at 1.5× range width
- Only 1 trade per day max
- Requires: session time tracking, range calculation, breakout detection

### 3c. Mean Reversion Strategy
- Bollinger Bands (20, 2.0) for overbought/oversold zones
- RSI divergence confirmation
- Entry on touch/pierce of outer band + RSI reversal
- SL beyond the band, TP at middle band
- Works best in ranging markets (low ADX)
- Auto-disable when ADX > 30 (trending)

### 3d. News Event Strategy
- Fetch economic calendar (ForexFactory API or similar)
- Define blackout window around high-impact events (±30 min)
- Two modes:
  - **Avoid**: Skip trading during news (safety mode)
  - **Straddle**: Place pending orders above/below pre-news range, catch the spike
- Requires: external data source, event classification (high/medium/low impact)

### 3e. Hybrid / Session-Switching Strategy
- Time-of-day strategy rotation:
  - Asian session → Grid or Mean Reversion (range-bound)
  - London open → London Breakout
  - London/NY overlap → Trend Rider or Aggressive Scalp
  - NY close → Shut down
- Automatic strategy switching based on clock
- Inherits from BaseStrategy but delegates to sub-strategies

### Deliverables
- [ ] AggressiveScalpStrategy implementation + tests
- [ ] LondonBreakoutStrategy implementation + tests
- [ ] MeanReversionStrategy implementation + tests
- [ ] NewsEventStrategy implementation + tests (may defer news feed integration)
- [ ] HybridStrategy implementation + tests
- [ ] StrategyFactory updated for all types
- [ ] New indicators: Bollinger Bands, VWAP (if needed)

---

## Phase 4: Trailing Stop & Breakeven Execution

**Goal:** Actually execute trailing stops and breakeven moves — currently declared but not wired.

### Changes

**bot.ts — position management loop:**
- On every tick (or every candle close), check open positions
- If trailing stop enabled and position is in profit by `trailingActivationPips`:
  - Move SL to `entryPrice + trailingStopPips` (for BUY) or `entryPrice - trailingStopPips` (for SELL)
  - Continue trailing: new SL = `currentPrice - trailingStopPips` (ratchet up, never down)
- If breakeven move enabled and profit >= `breakevenTriggerPips`:
  - Move SL to entry price (zero-risk trade)
- Use `orderService.updateStopLoss()` to push to broker

### Why Separate Phase
Trailing stops require a **tick-level or frequent polling loop** separate from the candle:close event. This is a different execution pattern than the current "evaluate once per candle" approach.

### Deliverables
- [ ] Position monitoring loop (tick-based or 5-second interval)
- [ ] Trailing stop logic with ratcheting
- [ ] Breakeven move logic
- [ ] ATR-based trailing (trail at 1× ATR below price)
- [ ] Tests for all trailing/breakeven scenarios
- [ ] Frontend display of trailing stop level on open positions

---

## Phase 5: Frontend Overhaul — Strategy Builder

**Goal:** Transform the Strategy page from a flat form into an interactive strategy builder.

### UI Sections

1. **Quick Actions Bar** (top)
   - Preset cards in a horizontal scroll
   - Active preset highlighted
   - "Custom" badge when settings diverge from preset

2. **Timeframe Selector**
   - Visual timeframe pills: 1m | 5m | 15m | 1h
   - Shows which timeframe each strategy uses
   - If multi-TF: shows primary + filter timeframe

3. **Strategy Visualizer**
   - Live chart showing current candles with indicator overlays (EMA lines, RSI panel, Bollinger Bands)
   - Visual SL/TP zones on chart
   - "What would this strategy do on the last 100 candles?" — mini backtest preview

4. **Parameter Tuning**
   - Grouped by strategy type (only show relevant params)
   - Sliders with live preview on chart
   - Tooltips explaining each parameter's effect

5. **Risk Dashboard**
   - Position size calculator (enter balance → see size for current SL)
   - R:R ratio visualization
   - "Account growth simulator" — given win rate + R:R, show projected growth curve

6. **Session Heatmap**
   - Visual 24h heatmap showing which hours are active/blocked
   - Click to toggle hours on/off
   - Overlay average spread and volatility data per hour

### Deliverables
- [ ] Preset quick-action bar component
- [ ] Timeframe selector component
- [ ] Strategy parameter groups (conditional on strategy type)
- [ ] Position size calculator widget
- [ ] Session heatmap component
- [ ] Chart with indicator overlays (stretch goal)

---

## Phase 6: Backtesting Engine

**Goal:** Test any strategy configuration against historical data before going live.

### Why Last
This is the most complex feature but also the most valuable for tuning presets. Once all strategies and timeframes work, backtesting validates them.

### Architecture

**New file: `src/services/BacktestEngine.ts`**
- Takes: strategy instance, historical candles, risk config
- Simulates: candle-by-candle evaluation, position opens/closes, P&L tracking
- No broker connection — pure simulation
- Accounts for spread (configurable), slippage (configurable)

**Historical Data:**
- Option A: Fetch from broker API (Deriv has historical tick/candle endpoints)
- Option B: Import CSV files (Dukascopy, MetaTrader exports)
- Store in PostgreSQL for fast replay

**Metrics Output:**
```
Total trades, Win rate, Profit factor, Max drawdown,
Sharpe ratio, Average R:R, Best/worst trade,
Monthly breakdown, Equity curve data points
```

**API:**
- `POST /api/backtest` — run a backtest with given config + date range
- `GET /api/backtest/:id` — get results
- `GET /api/backtest/:id/trades` — get simulated trade list
- `GET /api/backtest/:id/equity` — get equity curve

**Frontend:**
- Backtest config form (strategy preset, date range, initial balance)
- Results dashboard with equity curve chart
- Trade list table
- Compare button — run same dates with 2 different presets side by side

### Deliverables
- [ ] BacktestEngine core simulation loop
- [ ] Historical data fetcher/importer
- [ ] Metrics calculator
- [ ] Backtest API endpoints
- [ ] Frontend backtest page with equity curve
- [ ] Preset comparison mode

---

## Phase Summary

| Phase | What | Effort | Dependency |
|-------|------|--------|------------|
| **1** | Multi-timeframe candle engine | Medium | None — foundation |
| **2** | Trading style presets + quick actions | Medium | None (but better with Phase 1) |
| **3** | Implement 5 placeholder strategies | Large | Phase 1 (for HTF strategies) |
| **4** | Trailing stop & breakeven execution | Small-Medium | None |
| **5** | Frontend strategy builder overhaul | Large | Phases 1-4 |
| **6** | Backtesting engine | Large | Phases 1-3 |

**Recommended order:** Phase 2 → Phase 1 → Phase 4 → Phase 3 → Phase 5 → Phase 6

Start with presets (Phase 2) because it's immediately useful — you can switch between configurations right now with your existing 1m strategy. Then add multi-timeframe (Phase 1) to unlock the strategies that need it. Trailing stops (Phase 4) is a quick win. Then build out the real strategies (Phase 3), upgrade the UI (Phase 5), and finally add backtesting (Phase 6) to validate everything.
