'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshSession, WS_BASE_URL } from '@/lib/api/client';
import type { LiveMatchUpdate } from '@/lib/api/types';
import { useAuth } from '@/features/auth/AuthProvider';

export type LiveConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface MatchLiveState {
  state: LiveConnectionState;
  update: LiveMatchUpdate | null;
  receivedAt: string | null;
  error: string | null;
}

const MAX_BACKOFF_MS = 30_000;
const PING_INTERVAL_MS = 25_000;

/**
 * Match-scoped live updates.
 *
 * The backend channel is authenticated by the httpOnly access cookie (its path
 * is `/ws`), so no token is ever put in a URL. The channel only carries live
 * match state; announcements and notifications are HTTP only.
 *
 * When the socket is unavailable the UI keeps working through React Query
 * polling, so this hook never blocks the rest of the page.
 */
export function useMatchLive(matchId: string, enabled = true): MatchLiveState {
  const { status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveConnectionState>('idle');
  const [update, setUpdate] = useState<LiveMatchUpdate | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const pingRef = useRef<number | null>(null);
  const backoffRef = useRef(1_000);
  const disposedRef = useRef(false);
  const attemptRef = useRef(0);
  const invalidateRef = useRef(() => {
    void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
  });
  invalidateRef.current = () => {
    void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
  };

  const canConnect = enabled && authStatus === 'authenticated' && Boolean(matchId);

  useEffect(() => {
    disposedRef.current = false;
    if (!canConnect) {
      setState('idle');
      return () => {
        disposedRef.current = true;
      };
    }

    const clearTimers = () => {
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (pingRef.current !== null) {
        window.clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    const scheduleReconnect = (immediate = false) => {
      if (disposedRef.current) return;
      if (reconnectRef.current !== null) return;
      setState('reconnecting');
      const delay = immediate ? 0 : backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectRef.current = window.setTimeout(() => {
        reconnectRef.current = null;
        setError(null);
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposedRef.current) return;
      clearTimers();
      setState(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
      attemptRef.current += 1;

      const url = `${WS_BASE_URL}/ws/matches/${encodeURIComponent(matchId)}`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposedRef.current) {
          socket.close();
          return;
        }
        backoffRef.current = 1_000;
        setState('open');
        setError(null);
        // The channel is already bound to this match; subscribe re-checks
        // authorization and surfaces a clear error frame if it is refused.
        socket.send(JSON.stringify({ type: 'subscribe', matchId }));
        pingRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (message.type === 'match.update') {
          const payload = message as unknown as LiveMatchUpdate;
          setUpdate(payload);
          setReceivedAt(typeof message.at === 'string' ? message.at : new Date().toISOString());
          setError(null);
          invalidateRef.current();
          return;
        }

        if (message.type === 'error') {
          const text = typeof message.message === 'string' ? message.message : 'Live updates are unavailable.';
          setError(text);
          if (message.code === 'SESSION_REVOKED' || message.code === 'RESOURCE_NOT_FOUND') {
            socket.close();
          }
        }
      };

      socket.onerror = () => {
        // `onclose` follows and drives the retry strategy.
      };

      socket.onclose = (event) => {
        if (pingRef.current !== null) {
          window.clearInterval(pingRef.current);
          pingRef.current = null;
        }
        if (disposedRef.current) return;
        if (event.code === 4404) {
          setState('closed');
          setError('Live updates are not available for this match.');
          return;
        }
        if (event.code === 4401 || event.code === 4403) {
          setState('reconnecting');
          void (async () => {
            const refreshed = await refreshSession();
            scheduleReconnect(refreshed !== null);
          })();
          return;
        }
        scheduleReconnect();
      };
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const socket = socketRef.current;
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          backoffRef.current = 1_000;
          scheduleReconnect(true);
        }
      }
    };

    void connect();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposedRef.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearTimers();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close(1000, 'page_closed');
      }
    };
  }, [canConnect, matchId]);

  return { state, update, receivedAt, error };
}
