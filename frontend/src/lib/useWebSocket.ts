import { useEffect, useRef, useState, useCallback } from 'react';
import { CandleData, Trade } from '@/types';
import { WS_URL } from './api';

export type WsEvent =
  | { type: 'candle'; data: CandleData }
  | { type: 'trade'; data: Trade }
  | { type: 'status'; data: Record<string, unknown> };

interface UseWebSocketResult {
  isConnected: boolean;
  lastCandle: CandleData | null;
  lastTrade: Trade | null;
}

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useWebSocket(): UseWebSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [lastCandle, setLastCandle] = useState<CandleData | null>(null);
  const [lastTrade, setLastTrade] = useState<Trade | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_INITIAL_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectDelay.current = RECONNECT_INITIAL_MS;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsEvent;
        if (msg.type === 'candle') setLastCandle(msg.data);
        if (msg.type === 'trade') setLastTrade(msg.data);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => {
      // onclose will fire next and trigger reconnect
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(
            reconnectDelay.current * 2,
            RECONNECT_MAX_MS,
          );
          connect();
        }, reconnectDelay.current);
      }
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { isConnected, lastCandle, lastTrade };
}
