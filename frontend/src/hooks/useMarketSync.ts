// ============================================================================
// Real-Time Market State Sync & Action Dispatcher Hook
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChatMessage,
  Group,
  LedgerEntry,
  LiveEvent,
  Market,
  Order,
  OutcomeProposal,
  Player,
  Position,
  PositionBid,
  StrategyMandate,
  SwimlaneEvent,
  SwingTreeProjection,
  WidthBid,
  WireTraceEntry,
} from '../shared/types';

export interface ActiveMarketBundle {
  market: Market;
  positions: Position[];
  orders: Order[];
  p2pBids: PositionBid[];
  widthBids: WidthBid[];
  swimlanes: SwimlaneEvent[];
  wireTrace: WireTraceEntry[];
  swingTree: SwingTreeProjection;
  swingRiskLabel: string;
  proposal: OutcomeProposal | null;
  mandates: StrategyMandate[];
  liveEvents: LiveEvent[];
  mmEscrowToks: number;
}

export interface TerminalStatePayload {
  stateVersion: number;
  serverClockMs: number;
  group: Group;
  players: Player[];
  markets: Market[];
  activeBundle: ActiveMarketBundle | null;
  chatMessages: ChatMessage[];
  ledgerEntries: LedgerEntry[];
}

export interface AuthUser {
  id: string;
  username: string;
  email?: string | null;
  player_id: string;
}

/**
 * checking      asking the FastAPI gateway who we are
 * authenticated Keycloak session cookie is valid
 * anonymous     gateway answered 401: show the login screen
 * disabled      no gateway (engine-only local run): legacy single-player mode
 */
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'disabled';

const LOGIN_URL = '/api/v1/system/login';
const POLL_MS = 2000;
const POLL_WITH_WS_MS = 15000;

export function useMarketSync() {
  const [data, setData] = useState<TerminalStatePayload | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/me', { credentials: 'same-origin' });
      if (res.status === 401 || res.status === 423) {
        setAuthUser(null);
        setAuthStatus('anonymous');
        return;
      }
      if (!res.ok) {
        setAuthStatus('disabled');
        return;
      }
      const json = await res.json();
      setAuthUser(json.user as AuthUser);
      setAuthStatus('authenticated');
    } catch {
      setAuthStatus('disabled');
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(() => {
    window.location.assign(LOGIN_URL);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/v1/system/logout', { method: 'POST', credentials: 'same-origin' }).catch(
      () => undefined
    );
    setAuthUser(null);
    setData(null);
    setAuthStatus('anonymous');
  }, []);

  const fetchState = useCallback(
    async (marketIdOverride?: string) => {
      try {
        const targetId = marketIdOverride ?? selectedMarketId;
        const query = targetId ? `?marketId=${encodeURIComponent(targetId)}` : '';
        const res = await fetch(`/api/state${query}`, { credentials: 'same-origin' });
        if (res.status === 401) {
          setAuthStatus('anonymous');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TerminalStatePayload;
        setData(json);
        if (json.activeBundle?.market.id && json.activeBundle.market.id !== selectedMarketId) {
          setSelectedMarketId(json.activeBundle.market.id);
        } else if (!json.activeBundle && selectedMarketId !== '') {
          setSelectedMarketId('');
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    },
    [selectedMarketId]
  );

  const canSync = authStatus === 'authenticated' || authStatus === 'disabled';

  // Polling: fast without a live socket, a slow safety net with one
  useEffect(() => {
    if (!canSync) return;
    fetchState();
    const timer = setInterval(() => {
      fetchState();
    }, wsConnected ? POLL_WITH_WS_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [fetchState, canSync, wsConnected]);

  // Live updates: FastAPI /api/v1/ws pushes one frame per engine mutation
  const fetchStateRef = useRef(fetchState);
  fetchStateRef.current = fetchState;
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const deviceId = Math.random().toString(36).slice(2, 10);

    const open = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/ws?device_id=${deviceId}`);
      socket.onopen = () => setWsConnected(true);
      socket.onmessage = (msg) => {
        try {
          const frame = JSON.parse(msg.data);
          if (frame.event !== 'connected' && frame.event !== 'pong') {
            fetchStateRef.current();
          }
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = (evt) => {
        setWsConnected(false);
        if (closed) return;
        if (evt.code === 1008) {
          // Session rejected on the handshake: re-check who we are
          refreshAuth();
          return;
        }
        retryTimer = setTimeout(open, 3000);
      };
    };
    open();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      setWsConnected(false);
    };
  }, [authStatus, refreshAuth]);

  const dispatchAction = useCallback(
    async (path: string, body: Record<string, any> = {}) => {
      setErrorBanner(null);
      try {
        const res = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          setAuthStatus('anonymous');
          throw new Error('Your session expired, please log in again');
        }
        const json: any = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Request failed (${res.status})`);
        }
        await fetchState();
        return json;
      } catch (err: any) {
        setErrorBanner(err.message || 'Action rejected');
        throw err;
      }
    },
    [fetchState]
  );

  return {
    data,
    loading,
    errorBanner,
    setErrorBanner,
    selectedMarketId,
    setSelectedMarketId: (id: string) => {
      setSelectedMarketId(id);
      fetchState(id);
    },
    
    refresh: fetchState,
    dispatchAction,
    authStatus,
    authUser,
    refreshAuth,
    login,
    logout,
    wsConnected,
  };
}
