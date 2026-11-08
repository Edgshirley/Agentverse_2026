// ============================================================================
// Real-Time Market State Sync & Action Dispatcher Hook
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
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
  ledgerEntries: LedgerEntry[];
}

export function useMarketSync() {
  const [data, setData] = useState<TerminalStatePayload | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string>('');
  const [activePlayerId, setActivePlayerId] = useState<string>('you');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchState = useCallback(
    async (marketIdOverride?: string) => {
      try {
        const targetId = marketIdOverride ?? selectedMarketId;
        const query = targetId ? `?marketId=${encodeURIComponent(targetId)}` : '';
        const res = await fetch(`/api/state${query}`);
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

  useEffect(() => {
    fetchState();
    const timer = setInterval(() => {
      fetchState();
    }, 2000);
    return () => clearInterval(timer);
  }, [fetchState]);

  const dispatchAction = useCallback(
    async (path: string, body: Record<string, any> = {}) => {
      setErrorBanner(null);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
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
    activePlayerId,
    setActivePlayerId,
    refresh: fetchState,
    dispatchAction,
  };
}
