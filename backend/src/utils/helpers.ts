/**
 * Parse an environment variable as a number, returning the fallback if missing or NaN.
 */
export function parseEnvNumber(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseFloat(envVar);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Require an environment variable to be present, throwing on missing.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
