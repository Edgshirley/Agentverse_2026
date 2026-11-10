import { useEffect, useRef } from 'react';
import { ChatMessage } from '../shared/types';

/**
 * Dev only: two fake friends reply in chat to say they're joining whenever a
 * new bet is announced or someone talks about betting.
 */
const FRIENDS = [
  {
    id: 'maya',
    delayMs: 1800,
    lines: ["I'm in! Count me in on this one 🙌", "Ooh easy money, I'm joining", "Say less. I'm in."],
  },
  {
    id: 'theo',
    delayMs: 4200,
    lines: ["Joining. You're going down 😤", "Fine, I'm in too. Taking the other side.", 'Deal. Put me down for a lot.'],
  },
];
const FRIEND_IDS = new Set(FRIENDS.map((f) => f.id));

/** Plain chat messages that sound like a bet proposal also get replies. */
const BET_TALK = /\b(bet|bets|betting|wager|market|odds|chip|chips)\b/i;

let paused = false;

/** The simulator pauses the fake friends so they don't talk over its script. */
export function setFakeFriendsPaused(value: boolean): void {
  paused = value;
}

const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

export function useFakeFriends(
  chatMessages: ChatMessage[] | undefined,
  postChat: (path: string, body: Record<string, unknown>) => Promise<unknown>
): void {
  // Messages that were already in the chat when this tab loaded are left alone.
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV || !chatMessages) return;
    const prompts = chatMessages.filter(
      (m) => !FRIEND_IDS.has(m.player_id) && (m.market_id || BET_TALK.test(m.text))
    );
    if (seen.current === null) {
      seen.current = new Set(prompts.map((m) => m.id));
      return;
    }
    for (const msg of prompts) {
      if (seen.current.has(msg.id)) continue;
      seen.current.add(msg.id);
      if (paused) continue;
      for (const friend of FRIENDS) {
        timers.current.push(
          window.setTimeout(() => {
            void postChat('/api/chat', { playerId: friend.id, text: pick(friend.lines) });
          }, friend.delayMs)
        );
      }
    }
  }, [chatMessages, postChat]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );
}
