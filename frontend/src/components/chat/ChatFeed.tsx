import React, { useState } from 'react';
import { Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { AppScreen } from '../../App';

export interface LocalChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  isMine: boolean;
}

export interface MascotWidgetAlert {
  question: string;
  archetype: string;
  route: string;
}

interface ChatFeedProps {
  activePlayer: Player;
  chatMessages: LocalChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<LocalChatMessage[]>>;
  mascotAlert: MascotWidgetAlert | null;
  setMascotAlert: React.Dispatch<React.SetStateAction<MascotWidgetAlert | null>>;
  onForwardChatPromptToMainPage: (promptText: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  activePlayer,
  chatMessages,
  setChatMessages,
  mascotAlert,
  setMascotAlert,
  onForwardChatPromptToMainPage,
  onDispatch,
  onNavigateScreen,
}) => {
  const [chatInput, setChatInput] = useState('');

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

    const nowStr = new Date().toTimeString().slice(0, 5);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `usr_${Date.now()}`,
        sender: activePlayer.nickname,
        text: trimmed,
        time: nowStr,
        isMine: true,
      },
    ]);
    setChatInput('');

    // If the chat message looks like a bet idea (e.g. "lets make a bet on f1"),
    // queue it onto the Main Page (ASK BOT) and pop up the Tuxedo Cat widget!
    if (looksLikeBetProposal(trimmed)) {
      onForwardChatPromptToMainPage(trimmed);
      try {
        const res = await onDispatch('/api/agents/intake', {
          prompt: trimmed,
          playerId: activePlayer.id,
        });
        const c = res.classification;
        setMascotAlert({
          question: trimmed.replace(/TOKS/gi, 'CHIP'),
          archetype: c.archetype === 'spread' ? 'LINEAR WINDOW' : c.archetype.toUpperCase(),
          route: c.route,
        });
      } catch {
        setMascotAlert({
          question: trimmed,
          archetype: 'BET',
          route: 'auto',
        });
      }
    }
  };

  const handleSimulateFriendReply = () => {
    const nowStr = new Date().toTimeString().slice(0, 5);
    const friendSamples = [
      {
        sender: 'ALEX',
        text: 'I want to make a market for pit stops in the F1 race tomorrow, 25 CHIP!',
      },
      { sender: 'SAM', text: "I'm down! Let's bet 50 CHIP on whether it hits 24°C tomorrow." },
      { sender: 'JORDAN', text: 'Are we doing the Q4 team ranking bet with the boss as arbiter?' },
    ];
    const pick = friendSamples[chatMessages.length % friendSamples.length];
    setChatMessages((prev) => [
      ...prev,
      {
        id: `fr_${Date.now()}`,
        sender: pick.sender,
        text: pick.text,
        time: nowStr,
        isMine: false,
      },
    ]);
    onForwardChatPromptToMainPage(pick.text);
    setMascotAlert({
      question: pick.text,
      archetype: pick.text.toLowerCase().includes('f1') ? 'LINEAR WINDOW' : 'SIMPLE',
      route: 'auto',
    });
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
        <span className="pixel-font" style={{ fontSize: 12 }}>
          CHAT ({chatMessages.length})
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-sky"
            style={{ fontSize: 10.5, padding: '3px 8px' }}
            onClick={handleSimulateFriendReply}
          >
            + SIMULATE FRIEND MESSAGE
          </button>
          <span className="badge-outline">INVITE: MARKETMATE-2026</span>
        </div>
      </div>

      <div className="chat-messages-scroll">
        {chatMessages.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', textAlign: 'center', margin: 'auto 0' }}>
            No messages yet — say hi to your group or type a bet idea (e.g. &ldquo;lets make a bet
            on f1&rdquo;)!
          </div>
        )}

        {chatMessages.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble ${m.isMine ? 'mine' : 'friend-msg'}`}
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
              <strong className="pixel-font">{m.sender}</strong>
              <span>{m.time}</span>
            </div>
            <div>{m.text}</div>
          </div>
        ))}
      </div>

      {/* Bottom-Right Floating 8-Bit Tuxedo Cat Widget with Animated [!] Exclamation */}
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
                TUX CAT DEALER · {mascotAlert.archetype}
              </span>
              <button
                onClick={() => setMascotAlert(null)}
                style={{ padding: '0px 5px', fontSize: 10 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 11.5, marginBottom: 8 }}>
              Hey! I&apos;ve put your chat message (&ldquo;{mascotAlert.question.slice(0, 48)}
              &rdquo;) on the Main Page to make the bet!
            </div>
            <button
              className="btn-brand pixel-font"
              style={{ fontSize: 10, padding: '5px 10px', width: '100%' }}
              onClick={() => {
                onNavigateScreen('voice');
              }}
            >
              GO TO MAIN PAGE &amp; MAKE BET -&gt;
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
          placeholder="Message friends (e.g. 'lets make a bet on f1')..."
          style={{ flex: 1, padding: '8px 12px' }}
        />
        <button type="submit" className="btn-brand pixel-font">
          SEND
        </button>
      </form>
    </div>
  );
};
