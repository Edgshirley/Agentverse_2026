import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ChatMessage, Market, Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { AppPanel } from '../../App';
import { sfx } from '../../utils/soundEffects';
import { looksLikeBetProposal } from '../../utils/betDetection';
import { HintBubble } from '../HintBubble';

export interface MascotWidgetAlert {
  question: string;
}

interface ChatFeedProps {
  activePlayer: Player;
  chatMessages: ChatMessage[];
  players: Player[];
  mascotAlert: MascotWidgetAlert | null;
  setMascotAlert: React.Dispatch<React.SetStateAction<MascotWidgetAlert | null>>;
  onForwardChatPrompt: (promptText: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onOpenPanel: (panel: AppPanel) => void;
  standInFriends: boolean;
  /** Markets are announced in the chat with a "CLICK TO JOIN" bubble. */
  allMarkets: Market[];
  onSelectMarket: (marketId: string) => void;
}

/** States where friends can still get in on a market. */
const JOINABLE_STATES = new Set(['width_auction', 'quoting', 'open', 'live']);
const JOINED_STORAGE_KEY = 'marketmate.joinedMarkets.v1';

function loadJoined(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(JOINED_STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  activePlayer,
  chatMessages,
  players,
  mascotAlert,
  setMascotAlert,
  onForwardChatPrompt,
  onDispatch,
  onOpenPanel,
  standInFriends,
  allMarkets,
  onSelectMarket,
}) => {
  const [chatInput, setChatInput] = useState('');

  // Market announcements: markets already there on load sit at the top; new ones are
  // stamped with the time they first appear (engine and chat clocks differ, so the
  // markets' own created_at can't be sorted against chat messages).
  const marketSeenAt = useRef<Map<string, number> | null>(null);
  if (marketSeenAt.current === null) {
    marketSeenAt.current = new Map(allMarkets.map((m, i) => [m.id, -allMarkets.length + i]));
  }
  allMarkets.forEach((m) => {
    if (!marketSeenAt.current!.has(m.id)) marketSeenAt.current!.set(m.id, Date.now());
  });
  const [joined, setJoined] = useState<Set<string>>(() => loadJoined());
  const joinMarket = (marketId: string) => {
    onSelectMarket(marketId);
    onOpenPanel('bet');
    setJoined((prev) => {
      const next = new Set(prev).add(marketId);
      try {
        window.localStorage.setItem(JOINED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // storage blocked: the bubble just comes back on reload
      }
      return next;
    });
  };

  type TimelineItem =
    | { kind: 'msg'; at: number; msg: ChatMessage }
    | { kind: 'market'; at: number; market: Market };
  const timeline: TimelineItem[] = [
    ...chatMessages.map((msg) => ({ kind: 'msg' as const, at: msg.created_at, msg })),
    ...allMarkets.map((market) => ({
      kind: 'market' as const,
      at: marketSeenAt.current!.get(market.id)!,
      market,
    })),
  ].sort((a, b) => a.at - b.at);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length, allMarkets.length]);

  // Rule-based bet detection (utils/betDetection.ts) on every NEW message, from you or
  // a friend: the tuxedo cat chimes and offers to turn it into a bet. Messages already
  // in the history when the page loads never trigger it.
  const seenMessageIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenMessageIds.current === null) {
      seenMessageIds.current = new Set(chatMessages.map((m) => m.id));
      return;
    }
    const fresh = chatMessages.filter((m) => !seenMessageIds.current!.has(m.id));
    fresh.forEach((m) => seenMessageIds.current!.add(m.id));
    const betIdea = [...fresh].reverse().find((m) => looksLikeBetProposal(m.text));
    if (betIdea) {
      sfx.playCatAlert();
      setMascotAlert({ question: betIdea.text });
    }
  }, [chatMessages, setMascotAlert]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    setChatInput('');
    sfx.playChatPop();
    try {
      await onDispatch('/api/chat', { playerId: activePlayer.id, text: trimmed });
    } catch {
      setChatInput(trimmed); // keep the draft so a failed send can be retried
    }
  };

  const handleSimulateFriendReply = async () => {
    const friendSamples = [
      { playerId: 'michel', text: 'I want to make a market for pit stops in the F1 race tomorrow, 25 CHIP!' },
      { playerId: 'nathalie', text: "I'm down! Let's bet 50 CHIP on whether it hits 24°C tomorrow." },
      { playerId: 'andre', text: 'Are we doing the Q4 team ranking bet with the boss as arbiter?' },
    ];
    const pick = friendSamples[chatMessages.length % friendSamples.length];
    sfx.playChatPop();
    await onDispatch('/api/chat', pick); // the new-message effect above raises the cat
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {import.meta.env.DEV && standInFriends && (
          <button
            className="btn-sky"
            style={{ padding: '3px 8px' }}
            onClick={handleSimulateFriendReply}
            title="Simulate a friend's message"
            aria-label="Simulate a friend's message"
          >
            <Icon name="user-plus" size={14} />
          </button>
          )}
          <span className="badge-outline" title="Invite code">
            <Icon name="link" size={12} />
            MARKETMATE-2026
          </span>
        </div>
      </div>

      <div className="chat-messages-scroll" ref={scrollRef}>
        {timeline.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', textAlign: 'center', margin: 'auto 0' }}>
            No messages yet
          </div>
        )}

        {timeline.map((item) => {
          if (item.kind === 'market') {
            const mk = item.market;
            const joinable = JOINABLE_STATES.has(mk.state);
            return (
              <button
                key={`mkt-${mk.id}`}
                type="button"
                className={`chat-market-card ${joinable ? 'joinable' : ''}`}
                onClick={() => joinMarket(mk.id)}
                title="Open this bet"
              >
                <PixelMascot size={30} />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span className="pixel-font chat-market-card__kicker">
                    {joinable ? 'NEW BET OPEN' : mk.state.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span className="chat-market-card__question">{mk.question}</span>
                </span>
                {joinable && !joined.has(mk.id) && (
                  <HintBubble text="CLICK TO JOIN" placement="inline" />
                )}
                <Icon name="arrow-right" size={16} />
              </button>
            );
          }
          const m = item.msg;
          const isMine = m.player_id === activePlayer.id;
          const sender =
            players.find((p) => p.id === m.player_id)?.nickname ?? m.player_id.toUpperCase();
          return (
            <div key={m.id} className={`chat-bubble ${isMine ? 'mine' : 'friend-msg'}`}>
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
              <div>{m.text}</div>
            </div>
          );
        })}
      </div>

      {/* Bottom-right tuxedo cat offer to turn a chat message into a bet */}
      {mascotAlert && (
        <div className="chat-mascot-widget">
          <PixelMascot size={44} showExclamation={true} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <span className="pixel-font" style={{ fontSize: 10, color: 'var(--pastel-gold-text)' }}>
                BET IDEA?
              </span>
              <button
                onClick={() => setMascotAlert(null)}
                style={{ padding: '2px 4px' }}
                aria-label="Dismiss"
                title="Dismiss"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <div style={{ fontSize: 11.5, marginBottom: 8 }}>
              &ldquo;{mascotAlert.question.slice(0, 64)}&rdquo;
            </div>
            <button
              className="btn-brand pixel-font"
              style={{ fontSize: 10, padding: '5px 10px', width: '100%' }}
              onClick={() => {
                onForwardChatPrompt(mascotAlert.question);
                setMascotAlert(null);
                onOpenPanel('askbot');
              }}
            >
              BET
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
        </div>
      )}

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
          placeholder="Message the group..."
          style={{ flex: 1, padding: '8px 12px' }}
        />
        <button type="submit" className="btn-brand" title="Send" aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
};
