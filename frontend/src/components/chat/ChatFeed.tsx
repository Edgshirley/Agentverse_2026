import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ChatMessage, Market, Player } from '../../shared/types';
import { AppPanel } from '../../App';
import { sfx } from '../../utils/soundEffects';

const BET_COMMAND = /^\/bet\s+/i;

interface ChatFeedProps {
  activePlayer: Player;
  chatMessages: ChatMessage[];
  players: Player[];
  markets: Market[];
  onForwardChatPrompt: (promptText: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onOpenPanel: (panel: AppPanel) => void;
  onOpenMarket: (marketId: string) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  activePlayer,
  chatMessages,
  players,
  markets,
  onForwardChatPrompt,
  onDispatch,
  onOpenPanel,
  onOpenMarket,
}) => {
  const [chatInput, setChatInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  const proposeBet = (text: string) => {
    setChatInput('');
    onForwardChatPrompt(text);
    onOpenPanel('askbot');
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    if (BET_COMMAND.test(trimmed)) {
      proposeBet(trimmed.replace(BET_COMMAND, ''));
      return;
    }

    setChatInput('');
    sfx.playChatPop();
    try {
      await onDispatch('/api/chat', { playerId: activePlayer.id, text: trimmed });
    } catch {
      setChatInput(trimmed); // keep the draft so a failed send can be retried
    }
  };

  return (
    <div className="chat-feed-box">
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '2px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="pixel-font icon-label" style={{ fontSize: 12 }} title="Messages">
          <Icon name="message" />
          {chatMessages.length}
        </span>
        <span className="badge-outline" title="Invite code">
          <Icon name="link" size={12} />
          MARKETMATE-2026
        </span>
      </div>

      <div className="chat-messages-scroll" ref={scrollRef}>
        {chatMessages.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', textAlign: 'center', margin: 'auto 0' }}>
            No messages yet
          </div>
        )}

        {chatMessages.map((m) => {
          const isMine = m.player_id === activePlayer.id;
          const isBot = m.player_id === 'marketmate';
          const sender =
            players.find((p) => p.id === m.player_id)?.nickname ?? m.player_id.toUpperCase();
          const betCard = !isBot && m.market_id != null;
          const market = markets.find((candidate) => candidate.id === m.market_id);
          return (
            <div
              key={m.id}
              className={`chat-bubble ${isMine ? 'mine' : 'friend-msg'} ${isBot ? 'bot-msg' : ''}`}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 10,
                  opacity: 0.8,
                  marginBottom: 4,
                }}
              >
                <strong className="pixel-font">{sender}</strong>
                <span>{new Date(m.created_at).toTimeString().slice(0, 5)}</span>
              </div>
              {betCard ? (
                <div className="chat-bet-card">
                  <div>
                    <div className="pixel-font chat-bet-label">
                      NEW BET
                      {market?.active_width_w != null &&
                        ` · ${market.active_width_w} ${market.unit} SPREAD`}
                    </div>
                    <div>{m.text}</div>
                  </div>
                  <button
                    className="btn-inverted"
                    onClick={() => onOpenMarket(m.market_id as string)}
                    title="Open bet"
                    aria-label="Open bet"
                  >
                    <Icon name="arrow-right" size={14} />
                  </button>
                </div>
              ) : (
                <div>{m.text}</div>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleSendChat}
        style={{
          borderTop: '2px solid var(--border-color)',
          padding: 12,
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Message the group, or /bet to propose one..."
          style={{ flex: 1, padding: '8px 12px' }}
        />
        <button
          type="button"
          disabled={!chatInput.trim()}
          onClick={() => proposeBet(chatInput.trim().replace(BET_COMMAND, ''))}
          title="Make this a bet"
          aria-label="Make this a bet"
        >
          <Icon name="zap" size={18} />
        </button>
        <button type="submit" className="btn-brand" title="Send" aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
};
