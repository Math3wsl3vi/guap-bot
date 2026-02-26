import 'dotenv/config';
import { requireEnv } from '../utils/helpers';

export interface BrokerConfig {
  apiKey: string;
  accountId: string;
  baseUrl: string;
  streamUrl: string;
  isDemo: boolean;
}

export const brokerConfig: Readonly<BrokerConfig> = Object.freeze({
  apiKey: requireEnv('OANDA_API_KEY'),
  accountId: requireEnv('OANDA_ACCOUNT_ID'),
  baseUrl: process.env.OANDA_BASE_URL || 'https://api-fxpractice.oanda.com/v3',
  streamUrl: process.env.OANDA_STREAM_URL || 'https://stream-fxpractice.oanda.com/v3',
  isDemo: process.env.OANDA_IS_DEMO !== 'false',
});
