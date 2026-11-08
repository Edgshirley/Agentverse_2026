import React from 'react';
import { Order, Player, PositionBid, SwingTreeProjection } from '../shared/types';

interface ExhibitBSwingTreeProps {
  swingTree: SwingTreeProjection;
  orders: Order[];
  p2pBids: PositionBid[];
  players: Player[];
}

export const ExhibitB_SwingTree: React.FC<ExhibitBSwingTreeProps> = ({
  swingTree,
  orders,
  p2pBids,
  players,
}) => {
  const openOrders = orders.filter((o) => o.status === 'open');
  const openP2P = p2pBids.filter((b) => b.status === 'open');

  const getNick = (id: string) =>
    players.find((p) => p.id === id)?.nickname || id.toUpperCase();

  return (
    <section className="exhibit-box">
      <div className="exhibit-title">
        <span>31 │ === EXHIBIT B (BOTTOM) :: BRANCHING SWING TREE & PUBLIC SWING MAP ====</span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          ACTUAL PATH vs COUNTERFACTUAL STOP/LIMIT CASCADES
        </span>
      </div>

      {/* Main Line Trajectory */}
      <div style={{ marginBottom: 10 }}>
        <div className="gutter-row">
          <span className="gutter-num">32</span>
          <div>
            <strong>MAIN LINE: MARKET AS PLAYED</strong> ──&gt;{' '}
            {swingTree.main_line_history.map((pt, idx) => (
              <span key={idx}>
                {idx > 0 && ' ─── '}
                <span className="badge-outline">
                  {pt.step} [{pt.implied_value}]
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Side Branches: Counterfactual Stop/Limit Clusters */}
      <div style={{ marginBottom: 12 }}>
        <div className="gutter-row">
          <span className="gutter-num">33</span>
          <div>
            <strong>SIDE BRANCHES: STOPS / LIMITS NOT HIT YET (COUNTERFACTUAL SWINGS)</strong>
          </div>
        </div>

        {swingTree.counterfactual_branches.length === 0 ? (
          <div className="gutter-row">
            <span className="gutter-num">34</span>
            <span style={{ color: 'var(--fg-muted)' }}>
              └─┬─&gt; [NO UNTRIGGERED STOP/LIMIT CLUSTERS ON SWING MAP]
            </span>
          </div>
        ) : (
          swingTree.counterfactual_branches.map((branch, bIdx) => (
            <div key={branch.id} className="gutter-row">
              <span className="gutter-num">{34 + bIdx}</span>
              <div>
                <span style={{ color: 'var(--fg-muted)' }}>
                  {bIdx === swingTree.counterfactual_branches.length - 1 ? '└───> ' : '├───> '}
                </span>
                <span className="badge-inverted">{branch.label}</span>
                <span style={{ marginLeft: 8, color: 'var(--fg-muted)' }}>
                  ODDS -&gt; {branch.implied_value_after}% | SWINGS:{' '}
                </span>
                {Object.entries(branch.player_swings).map(([pid, delta]) => (
                  <span key={pid} style={{ marginRight: 8, fontWeight: 600 }}>
                    {getNick(pid)}:{delta >= 0 ? `+${delta}` : delta} CHIP
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Public Order Book ("Swing Map") Table */}
      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          paddingTop: 8,
          fontSize: 11,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--fg-muted)' }}>
          PUBLIC ORDER BOOK ("SWING MAP" — VISIBLE TO ALL PLAYERS):
        </div>
        {openOrders.length === 0 && openP2P.length === 0 ? (
          <div style={{ color: 'var(--fg-dim)' }}>No active public limit/stop orders or P2P bids.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {openOrders.map((o) => (
              <span key={o.id} className="badge-outline">
                {getNick(o.player_id)} :: {o.type.toUpperCase()} {o.side} @ {o.trigger_level} (
                {o.size_toks} CHIP)
              </span>
            ))}
            {openP2P.map((b) => (
              <span key={b.id} className="badge-inverted">
                P2P {b.kind} :: {getNick(b.buyer_id || b.seller_id || '')} 1x {b.side} @{' '}
                {b.price_toks} CHIP
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
