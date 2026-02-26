import 'dotenv/config';
import { requireEnv } from '../utils/helpers';

export interface BrokerConfig {
  /** Capital.com API key (My Account → API access) */
  apiKey: string;
  /** Capital.com login email */
  identifier: string;
  /** Capital.com login password */
  password: string;
  isDemo: boolean;
}

export const brokerConfig: Readonly<BrokerConfig> = Object.freeze({
  apiKey: requireEnv('CAPITAL_COM_API_KEY'),
  identifier: requireEnv('CAPITAL_COM_IDENTIFIER'),
  password: requireEnv('CAPITAL_COM_PASSWORD'),
  isDemo: process.env.CAPITAL_COM_IS_DEMO !== 'false',
});
