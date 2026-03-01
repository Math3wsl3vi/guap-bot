import 'dotenv/config';
import { requireEnv } from '../utils/helpers';

export interface BrokerConfig {
  /** Deriv app ID — get a free one at https://developers.deriv.com/docs/app-registration */
  appId: string;
  /** Deriv API token with Read + Trade + Payments scopes (app.deriv.com/account/api-token) */
  apiToken: string;
  /** false = live account, true = demo account (controlled by which token you use) */
  isDemo: boolean;
  /**
   * Leverage multiplier for Multiplier contracts.
   * Supported values for frxXAUUSD: 5, 10, 20, 50, 100.
   * Higher multiplier = larger position per dollar staked.
   */
  multiplier: number;
}

export const brokerConfig: Readonly<BrokerConfig> = Object.freeze({
  appId:      requireEnv('DERIV_APP_ID'),
  apiToken:   requireEnv('DERIV_API_TOKEN'),
  isDemo:     process.env.DERIV_IS_DEMO !== 'false',
  multiplier: parseInt(process.env.DERIV_MULTIPLIER ?? '100', 10),
});

// ─── MT5 via MetaApi ──────────────────────────────────────────────────────────

export interface MT5Config {
  metaApiToken: string;
  accountId: string;
}

/**
 * Lazy MT5 config — only validates env vars when called (i.e. when BROKER=mt5).
 * This avoids requiring METAAPI_TOKEN / MT5_ACCOUNT_ID when using the Deriv adapter.
 */
export function getMT5Config(): MT5Config {
  return {
    metaApiToken: requireEnv('METAAPI_TOKEN'),
    accountId: requireEnv('MT5_ACCOUNT_ID'),
  };
}
