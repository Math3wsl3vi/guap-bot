# 1-Minute Scalping Bot Development Guide

## Project Overview
Building an automated trading bot for 1-minute scalping using Node.js/TypeScript, targeting forex/gold markets (XAU/USD).

## Tech Stack Decision

### Primary: Node.js + TypeScript ⭐
**Rationale:**
- Leverages existing JavaScript proficiency
- Event-driven architecture perfect for real-time trading
- Excellent WebSocket support for market data streams
- Fast execution suitable for 1-minute scalping
- Rich npm ecosystem

**Alternative:** Java/Spring Boot (familiar but heavier, less trading ecosystem support)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Trading Bot                          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐      ┌──────────────┐                │
│  │ Market Data  │──────▶│  Strategy    │                │
│  │   Service    │      │   Engine     │                │
│  │  (WebSocket) │      │ (EMA, RSI)   │                │
│  └──────────────┘      └──────┬───────┘                │
│                               │                          │
│                               ▼                          │
│                        ┌──────────────┐                 │
│                        │     Risk     │                 │
│                        │   Manager    │                 │
│                        │ (Position    │                 │
│                        │  Sizing)     │                 │
│                        └──────┬───────┘                 │
│                               │                          │
│                               ▼                          │
│                        ┌──────────────┐                 │
│                        │    Order     │                 │
│                        │   Execution  │                 │
│                        │   Service    │                 │
│                        └──────┬───────┘                 │
│                               │                          │
│                               ▼                          │
│                        ┌──────────────┐                 │
│                        │   Database   │                 │
│                        │   & Logging  │                 │
│                        └──────────────┘                 │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
scalping-bot/
├── src/
│   ├── config/
│   │   ├── broker.config.ts      # API credentials, endpoints
│   │   ├── strategy.config.ts    # Strategy parameters
│   │   └── risk.config.ts        # Risk management rules
│   │
│   ├── services/
│   │   ├── MarketDataService.ts  # WebSocket market data
│   │   ├── OrderService.ts       # Order execution
│   │   ├── RiskManager.ts        # Position sizing, limits
│   │   └── DatabaseService.ts    # Trade persistence
│   │
│   ├── strategies/
│   │   ├── BaseStrategy.ts       # Abstract strategy class
│   │   └── EMAScalpStrategy.ts   # EMA crossover implementation
│   │
│   ├── indicators/
│   │   └── TechnicalIndicators.ts # RSI, EMA, MACD calculations
│   │
│   ├── models/
│   │   ├── Trade.ts              # Trade entity
│   │   ├── Position.ts           # Position entity
│   │   └── Candle.ts             # OHLCV data
│   │
│   ├── utils/
│   │   ├── logger.ts             # Winston logging
│   │   └── helpers.ts            # Utility functions
│   │
│   └── bot.ts                    # Main entry point
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── .env.example                  # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Core Dependencies

```json
{
  "dependencies": {
    "ccxt": "^4.x",                    // Multi-exchange support
    "technicalindicators": "^3.x",     // TA indicators
    "ws": "^8.x",                      // WebSocket client
    "dotenv": "^16.x",                 // Environment config
    "winston": "^3.x",                 // Logging
    "pg": "^8.x",                      // PostgreSQL
    "ioredis": "^5.x",                 // Redis caching
    "axios": "^1.x"                    // HTTP client
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "ts-node": "^10.x",
    "nodemon": "^3.x",
    "jest": "^29.x"
  }
}
```

## Strategy Implementation

### Simple EMA Crossover Scalping Strategy

**Entry Signals:**
- **BUY**: EMA(9) crosses above EMA(21) + RSI(14) between 30-70
- **SELL**: EMA(9) crosses below EMA(21) + RSI(14) between 30-70

**Exit Rules:**
- **Take Profit**: 5-10 pips (0.05-0.10%)
- **Stop Loss**: 3-5 pips (0.03-0.05%)
- **Trailing Stop**: Activate after 3 pips profit

**Position Sizing:**
- Risk 0.5-1% of account per trade
- Max 3 concurrent positions
- Daily loss limit: 3% of account

## Risk Management Rules

### Critical Limits
```typescript
const RISK_LIMITS = {
  maxRiskPerTrade: 0.01,        // 1% of account
  maxDailyLoss: 0.03,           // 3% daily loss limit
  maxDrawdown: 0.15,            // 15% max drawdown
  maxOpenPositions: 3,
  minRiskRewardRatio: 1.5,      // 1:1.5 minimum
};
```

### Safety Mechanisms
1. **Circuit Breaker**: Auto-stop after daily loss limit hit
2. **Position Limit**: Max 3 open trades
3. **Timeout Protection**: Close stale positions after N minutes
4. **API Rate Limiting**: Respect broker limits
5. **Connection Monitoring**: Reconnect on WebSocket drops

## Development Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up TypeScript project structure
- [ ] Implement MarketDataService (WebSocket connection)
- [ ] Create Candle model and data ingestion
- [ ] Build TechnicalIndicators module (EMA, RSI)
- [ ] Set up logging with Winston
- [ ] Configure environment variables

### Phase 2: Strategy & Risk (Week 2)
- [ ] Implement BaseStrategy abstract class
- [ ] Build EMAScalpStrategy
- [ ] Create RiskManager service
- [ ] Implement position sizing calculations
- [ ] Add order validation logic
- [ ] Set up PostgreSQL schema for trades

### Phase 3: Execution (Week 3)
- [ ] Build OrderService (REST API integration)
- [ ] Implement order types (market, limit, stop)
- [ ] Add error handling and retries
- [ ] Create DatabaseService for persistence
- [ ] Build monitoring dashboard (optional)
- [ ] Add Telegram notifications (optional)

### Phase 4: Testing (Week 4-12)
- [ ] Unit tests for all services
- [ ] Backtest on historical data (6-12 months)
- [ ] Paper trading on demo account (8+ weeks minimum)
- [ ] Performance metrics tracking
- [ ] Strategy optimization
- [ ] Stress testing edge cases

### Phase 5: Live Deployment (After successful testing)
- [ ] Deploy to VPS (near broker servers)
- [ ] Start with minimum position sizes
- [ ] Monitor 24/7 for first week
- [ ] Gradual scaling based on performance

## Broker Selection Criteria

### Recommended Brokers for Scalping
1. **OANDA** (Forex/Gold)
   - Good API, TypeScript SDK available
   - Low spreads, no commission
   - Demo account for testing

2. **Interactive Brokers** (Forex/Stocks)
   - Professional-grade API
   - Low costs, fast execution
   - Requires higher capital

3. **MetaTrader 5 Bridge** (Forex/Gold)
   - Use MT5 with Node.js package
   - Wide broker support
   - Familiar if you know MT4/5

### API Requirements
- REST API for order management
- WebSocket for real-time market data
- Demo/sandbox environment
- Rate limits documented
- Good uptime SLA (99.9%+)

## Deployment Considerations

### VPS Setup
```bash
# Recommended specs
- CPU: 2+ cores
- RAM: 4GB minimum
- Location: Near broker data centers
  (London for forex, New York for US markets)
- OS: Ubuntu 22.04 LTS
- Uptime: 99.99%+ guarantee
```

### Process Management
```bash
# Use PM2 for production
pm2 start dist/bot.js --name scalping-bot
pm2 startup  # Auto-restart on server reboot
pm2 logs scalping-bot  # View logs
pm2 monit  # Monitor resources
```

### Monitoring & Alerts
- System: CPU, memory, disk usage
- Application: Trade frequency, P&L, errors
- Alerts: Telegram/email on critical events
- Logging: Centralized (CloudWatch, ELK stack)

## Performance Metrics to Track

```typescript
interface BotMetrics {
  totalTrades: number;
  winRate: number;              // % of winning trades
  profitFactor: number;         // Gross profit / Gross loss
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;          // Risk-adjusted returns
  averageTradePerDay: number;
  uptime: number;               // Bot availability %
}
```

## Critical Warnings

### 🚨 Development Risks
1. **One bug can wipe your account** - Extensive testing is mandatory
2. **Backtesting ≠ Live performance** - Markets change, slippage matters
3. **Over-optimization** - Curve-fitting to historical data fails live
4. **Latency kills scalping** - Need VPS near broker servers
5. **Emotional interference** - Don't override the bot manually

### 🛡️ Safety First Approach
- Test on demo for **minimum 2 months**
- Start live with **minimum position sizes**
- Never risk more than you can afford to lose
- Have a kill switch (manual override)
- Monitor daily, especially first month
- Accept that most strategies eventually stop working

## Resources

### Learning
- [CCXT Documentation](https://docs.ccxt.com/)
- [Technical Indicators Library](https://www.npmjs.com/package/technicalindicators)
- [Node.js Trading Bot Tutorial](https://github.com/topics/trading-bot)

### Testing Data
- Historical forex data: Dukascopy, FXCM
- Paper trading: OANDA demo, MetaTrader demo

### Community
- r/algotrading (Reddit)
- QuantConnect forums
- Discord trading bot communities

## Next Steps

1. **Validate strategy manually** - Trade it yourself for 2 weeks
2. **Set up development environment** - Node.js, TypeScript, PostgreSQL
3. **Choose a broker** - Open demo account for testing
4. **Start coding** - Begin with Phase 1 (Foundation)
5. **Test relentlessly** - Don't skip this step

---

## Notes for Levi

Given your Spring Boot + Next.js experience:
- The architecture mirrors your HomeQuest setup (services, models, config)
- TypeScript will feel natural coming from Java
- Consider building a Next.js dashboard for monitoring
- Redis caching patterns similar to what you'd use in Spring
- API integration similar to your KCB Bank payment flows

**Key difference**: In trading bots, bugs cost real money. Test 10x more than you would for a web app.

Good luck! Start with the strategy validation and foundation phase. Don't rush to live trading.