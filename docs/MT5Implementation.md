# MT5 Integration Implementation Guide

## Overview

This document details how to integrate MetaTrader 5 as a broker alongside the existing Deriv adapter using the **MetaApi Cloud SDK** (`metaapi.cloud-sdk`). MT5 enables pending/limit orders, unlocking true grid trading.

---

## Prerequisites

1. **MetaApi Account**: Sign up at [metaapi.cloud](https://metaapi.cloud) (free tier = 1 MT5 account)
2. **MT5 Broker Account**: Any broker with MT5 support (Pepperstone, IC Markets, Exness, etc.)
3. **Connect MT5 to MetaApi**: Add your MT5 account via the MetaApi dashboard to get an `accountId`

### Environment Variables

```bash
# MT5 via MetaApi
METAAPI_TOKEN=your-metaapi-auth-token
MT5_ACCOUNT_ID=your-metaapi-account-id
BROKER=mt5  # or 'deriv' to use existing adapter
```

---

## Phase 1: Install Dependencies & Basic Connection

### 1a. Install MetaApi SDK

```bash
cd backend
npm install metaapi.cloud-sdk
```

### 1b. Update `broker.config.ts`

Add MT5 configuration section:

```typescript
export interface MT5Config {
  metaApiToken: string;
  accountId: string;
}

export const mt5Config: MT5Config = Object.freeze({
  metaApiToken: requireEnv('METAAPI_TOKEN'),  // only required when BROKER=mt5
  accountId: requireEnv('MT5_ACCOUNT_ID'),
});
```

Note: Only validate/require MT5 env vars when `BROKER=mt5` is set.

### 1c. Create `MT5Adapter.ts`

```
backend/src/services/MT5Adapter.ts
```

Implements `IBrokerAdapter` using MetaApi SDK:

| IBrokerAdapter Method | MetaApi SDK Method |
|---|---|
| `connect()` | `api.metatraderAccountApi.getAccount(id)` → `account.waitConnected()` → `connection.connect()` → `connection.waitSynchronized()` |
| `disconnect()` | `connection.close()` |
| `subscribeToTicks(symbol, onTick)` | `connection.subscribeToMarketData(symbol)` + `SynchronizationListener.onSymbolPriceUpdated()` |
| `getHistoricalCandles(symbol, tf, count)` | `connection.getHistoricalCandles(symbol, tf, startTime, count)` |
| `isConnected()` | Check connection state |
| `getAccountInfo()` | `connection.terminalState.accountInformation` |
| `getOpenPositions()` | `connection.terminalState.positions` |
| `placeOrder(params)` | `connection.createMarketBuyOrder()` / `createMarketSellOrder()` |
| `closePosition(dealId)` | `connection.closePosition(positionId)` |
| `updateStopLoss(dealId, sl)` | `connection.modifyPosition(positionId, sl, tp)` |

### Symbol Mapping

MT5 symbols vary by broker. Common patterns:

| Internal | MT5 (typical) |
|----------|---------------|
| XAU_USD | XAUUSD |
| EUR_USD | EURUSD |
| GBP_USD | GBPUSD |

Build a symbol map in MT5Adapter, similar to DerivAdapter's `frx` prefix mapping. Use `connection.getSymbols()` at connect time to auto-discover available symbols.

---

## Phase 2: Extend IBrokerAdapter for Pending Orders

### 2a. Add New Methods to Interface

```typescript
// In IBrokerAdapter.ts
export interface PlaceLimitOrderParams {
  symbol: string;
  direction: 'BUY' | 'SELL';
  size: number;
  price: number;        // limit price
  stopLevel?: number;
  profitLevel?: number;
}

export interface BrokerOrder {
  orderId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  type: 'LIMIT' | 'STOP';
  size: number;
  price: number;
  stopLevel?: number;
  profitLevel?: number;
  openedAt: Date;
}

// Add to IBrokerAdapter interface:
placeLimitOrder?(params: PlaceLimitOrderParams): Promise<PlaceOrderResult>;
placeStopOrder?(params: PlaceLimitOrderParams): Promise<PlaceOrderResult>;
cancelOrder?(orderId: string): Promise<void>;
getOpenOrders?(): Promise<BrokerOrder[]>;
```

Note: Methods are optional (`?`) so DerivAdapter doesn't need to implement them.

### 2b. Implement in MT5Adapter

```typescript
async placeLimitOrder(params: PlaceLimitOrderParams): Promise<PlaceOrderResult> {
  const symbol = this.mapSymbol(params.symbol);
  if (params.direction === 'BUY') {
    return this.connection.createLimitBuyOrder(symbol, params.size, params.price, params.stopLevel, params.profitLevel);
  }
  return this.connection.createLimitSellOrder(symbol, params.size, params.price, params.stopLevel, params.profitLevel);
}

async placeStopOrder(params: PlaceLimitOrderParams): Promise<PlaceOrderResult> {
  const symbol = this.mapSymbol(params.symbol);
  if (params.direction === 'BUY') {
    return this.connection.createStopBuyOrder(symbol, params.size, params.price, params.stopLevel, params.profitLevel);
  }
  return this.connection.createStopSellOrder(symbol, params.size, params.price, params.stopLevel, params.profitLevel);
}

async cancelOrder(orderId: string): Promise<void> {
  await this.connection.cancelOrder(orderId);
}

async getOpenOrders(): Promise<BrokerOrder[]> {
  const orders = this.connection.terminalState.orders;
  return orders.map(o => ({
    orderId: o.id,
    symbol: this.reverseMapSymbol(o.symbol),
    direction: o.type.includes('BUY') ? 'BUY' : 'SELL',
    type: o.type.includes('LIMIT') ? 'LIMIT' : 'STOP',
    size: o.volume,
    price: o.openPrice,
    stopLevel: o.stopLoss,
    profitLevel: o.takeProfit,
    openedAt: new Date(o.openTime),
  }));
}
```

### 2c. DerivAdapter — Throw on Pending Orders

```typescript
// In DerivAdapter.ts
async placeLimitOrder(): Promise<never> {
  throw new Error('Deriv does not support pending/limit orders. Switch to MT5 broker for grid trading.');
}
```

---

## Phase 3: Grid Trading Integration

With MT5 pending orders available, implement `GridTradingStrategy`:

### Grid Logic

1. **Calculate grid levels**: Given current price and spacing, create N levels above and N below
2. **Place limit orders**: BUY limits below current price, SELL limits above
3. **On fill**: When a limit order fills, place a TP order at the next grid level
4. **Rebalance**: Periodically recalculate grid if price moves significantly
5. **Safety**: Close all if max drawdown hit or strong trend detected (ADX)

### Grid Order Flow

```
Current Price: $2,700
Grid Spacing: $2
Grid Levels: 5

SELL LIMIT $2,710  (TP at $2,708)
SELL LIMIT $2,708  (TP at $2,706)
SELL LIMIT $2,706  (TP at $2,704)
SELL LIMIT $2,704  (TP at $2,702)
SELL LIMIT $2,702  (TP at $2,700)
─── CURRENT PRICE $2,700 ───
BUY LIMIT  $2,698  (TP at $2,700)
BUY LIMIT  $2,696  (TP at $2,698)
BUY LIMIT  $2,694  (TP at $2,696)
BUY LIMIT  $2,692  (TP at $2,694)
BUY LIMIT  $2,690  (TP at $2,692)
```

### Integration with Trading Loop

Grid trading doesn't fit the `candle:close → evaluate → place order` pattern cleanly. Instead:

1. On strategy activation, `GridTradingStrategy.initialize(currentPrice, broker)` places all grid orders
2. On each `candle:close`, `evaluate()` checks:
   - Are grid levels still valid? (price hasn't moved too far)
   - Should grid be rebalanced?
   - Has max drawdown been hit?
   - Is ADX indicating strong trend? (shut down grid)
3. Returns `HOLD` for normal operation, returns special signals for rebalance/shutdown

---

## Phase 4: Broker Selection in bot.ts

### Update `bot.ts` Initialization

```typescript
import { strategyConfig } from './config/strategy.config';
import { DerivAdapter } from './services/DerivAdapter';
import { MT5Adapter } from './services/MT5Adapter';

function createBrokerAdapter(): IBrokerAdapter {
  if (strategyConfig.broker === 'mt5') {
    return new MT5Adapter(mt5Config);
  }
  return new DerivAdapter(brokerConfig);
}

const broker = createBrokerAdapter();
```

### Broker Switching via API

The `PUT /api/strategy` endpoint supports changing `broker`:

```typescript
if (body.broker && body.broker !== strategyConfig.broker) {
  // 1. Stop market data
  // 2. Disconnect current broker
  // 3. Update config
  // 4. Create new broker adapter
  // 5. Reconnect
  // 6. Restart market data
}
```

This requires a full reconnect cycle (not just strategy recreation).

---

## Phase 5: Testing

### Demo Account Testing Checklist

- [ ] MT5 adapter connects via MetaApi
- [ ] Tick streaming works (XAU/USD)
- [ ] Historical candles load for warmup
- [ ] Market orders execute correctly
- [ ] Stop loss and take profit are set
- [ ] Position closing works
- [ ] SL modification works (trailing stop)
- [ ] **Limit orders place correctly** (grid trading)
- [ ] **Limit orders cancel correctly**
- [ ] **Grid orders fill and TP triggers**
- [ ] Account info (balance, equity) reads correctly
- [ ] Reconnect on disconnect works

### MetaApi Free Tier Limitations

- 1 MT5 account connected
- Usage-based billing starts when API server is deployed
- Minimum 6-hour billing cycle per deployment
- Good enough for development and demo testing

---

## Cost Summary

| Tier | Price | Accounts | Use Case |
|------|-------|----------|----------|
| Free | $0 | 1 | Development, demo testing |
| Paid | Usage-based | Multiple | Live trading, multiple accounts |

Check [metaapi.cloud/pricing](https://metaapi.cloud/#pricing) for current rates.

---

## Recommended MT5 Brokers for XAU/USD

1. **IC Markets** — Low spreads, MT5, good API
2. **Pepperstone** — Razor account with raw spreads
3. **Exness** — High leverage, low minimums
4. **FP Markets** — Competitive gold spreads
5. **Vantage** — Good for small accounts

Choose a broker that supports MT5 (not just MT4) and offers the `XAUUSD` symbol.

---

## File Checklist

| Phase | File | Action |
|-------|------|--------|
| 1 | `backend/package.json` | Add `metaapi.cloud-sdk` |
| 1 | `backend/src/config/broker.config.ts` | Add MT5 config interface |
| 1 | `backend/src/services/MT5Adapter.ts` | New — implements IBrokerAdapter |
| 2 | `backend/src/services/IBrokerAdapter.ts` | Add optional pending order methods |
| 2 | `backend/src/services/DerivAdapter.ts` | Add throwing stubs for pending orders |
| 3 | `backend/src/strategies/GridTradingStrategy.ts` | New — grid trading logic |
| 3 | `backend/src/services/OrderService.ts` | Add grid order management methods |
| 4 | `backend/src/bot.ts` | Broker selection based on config |
| 4 | `backend/src/services/ApiServer.ts` | Broker switching endpoint |
