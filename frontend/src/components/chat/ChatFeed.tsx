import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ChatMessage, Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { AppPanel } from '../../App';
import { sfx } from '../../utils/soundEffects';

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
}) => {
  const [chatInput, setChatInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  // Heuristic check so casual greetings like "hi!" do not trigger the bet widget,
  // while any bet/market/F1/sport/temperature message triggers the Tuxedo Cat handoff!
  const looksLikeBetProposal = (text: string): boolean => {
    const t = text.trim().toLowerCase();
    if (t.length < 5) return false;
    if (/^(hi|hey|hello|yo|sup|ok|okay|thanks|lol|haha)[!?.]*$/i.test(t)) return false;
    return /\b(bet|make a|market|f1|race|pit|stop|odds|will|score|temp|°c|chips?|rank|win|over|under|window|linear|who|when|how many)\b/i.test(
      t
    );
  };

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
      return;
    }

    if (looksLikeBetProposal(trimmed)) {
      sfx.playCatAlert();
      setMascotAlert({ question: trimmed });
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
    await onDispatch('/api/chat', pick);
    setTimeout(() => sfx.playCatAlert(), 120);
    setMascotAlert({ question: pick.text });
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
        {chatMessages.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', textAlign: 'center', margin: 'auto 0' }}>
            No messages yet
          </div>
        )}

        {chatMessages.map((m) => {
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
