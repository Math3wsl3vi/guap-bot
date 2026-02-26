import 'dotenv/config';
import { parseEnvNumber } from '../utils/helpers';

export interface RiskConfig {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  maxOpenPositions: number;
  minRiskRewardRatio: number;
  maxSlippagePips: number;
  stalePositionTimeoutMinutes: number;
}

export const riskConfig: Readonly<RiskConfig> = Object.freeze({
  maxRiskPerTrade: parseEnvNumber(process.env.MAX_RISK_PER_TRADE, 0.01),
  maxDailyLoss: parseEnvNumber(process.env.MAX_DAILY_LOSS, 0.03),
  maxDrawdown: parseEnvNumber(process.env.MAX_DRAWDOWN, 0.15),
  maxOpenPositions: parseEnvNumber(process.env.MAX_OPEN_POSITIONS, 3),
  minRiskRewardRatio: parseEnvNumber(process.env.MIN_RISK_REWARD_RATIO, 1.5),
  maxSlippagePips: parseEnvNumber(process.env.MAX_SLIPPAGE_PIPS, 2),
  stalePositionTimeoutMinutes: parseEnvNumber(process.env.STALE_POSITION_TIMEOUT_MINUTES, 30),
});
