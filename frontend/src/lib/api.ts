import {
  Account,
  BotStatus,
  CandleData,
  Instrument,
  LogEntry,
  Metrics,
  StrategyConfig,
  SystemHealth,
  Trade,
} from '@/types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Endpoints ──────────────────────────────────────────────────────────────────

export const api = {
  status: (): Promise<BotStatus & { lastStarted: string | null }> =>
    get('/api/status'),

  account: (): Promise<Account & { currency: string }> =>
    get('/api/account'),

  positions: (): Promise<Trade[]> =>
    get('/api/positions'),

  trades: (limit = 50): Promise<Trade[]> =>
    get('/api/trades', { limit }),

  metrics: (): Promise<Metrics> =>
    get('/api/metrics'),

  candles: (limit = 60): Promise<CandleData[]> =>
    get('/api/candles', { limit }),

  logs: (limit = 100): Promise<LogEntry[]> =>
    get('/api/logs', { limit }),

  health: (): Promise<SystemHealth> =>
    get('/api/health'),

  instruments: (): Promise<Instrument[]> =>
    get('/api/instruments'),

  strategy: (): Promise<StrategyConfig> =>
    get('/api/strategy'),

  updateStrategy: (config: StrategyConfig): Promise<{ success: boolean }> =>
    put('/api/strategy', config),

  closePosition: (id: string): Promise<{ success: boolean }> =>
    post(`/api/positions/${id}/close`),

  botStart: (): Promise<{ success: boolean; message?: string }> =>
    post('/api/bot/start'),

  botStop: (): Promise<{ success: boolean; message?: string }> =>
    post('/api/bot/stop'),

  botPause: (): Promise<{ success: boolean; isPaused: boolean }> =>
    post('/api/bot/pause'),
};

export const WS_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(
  /^http/,
  'ws',
);
