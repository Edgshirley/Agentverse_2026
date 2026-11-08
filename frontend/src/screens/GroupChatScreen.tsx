import React from 'react';
import { Market, Player } from '../shared/types';
import { ActiveMarketBundle } from '../hooks/useMarketSync';
import { ChatFeed, LocalChatMessage, MascotWidgetAlert } from '../components/chat/ChatFeed';
import { LiveBetsList } from '../components/chat/LiveBetsList';
import { AppScreen } from '../App';

export type { LocalChatMessage, MascotWidgetAlert };

interface GroupChatScreenProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  activePlayer: Player;
  chatMessages: LocalChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<LocalChatMessage[]>>;
  mascotAlert: MascotWidgetAlert | null;
  setMascotAlert: React.Dispatch<React.SetStateAction<MascotWidgetAlert | null>>;
  onForwardChatPromptToMainPage: (promptText: string) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const GroupChatScreen: React.FC<GroupChatScreenProps> = ({
  activeBundle,
  allMarkets,
  onSelectMarket,
  ...chatProps
}) => {
  return (
    <div className="chat-screen-grid">
      <ChatFeed {...chatProps} />
      <LiveBetsList
        activeBundle={activeBundle}
        allMarkets={allMarkets}
        onSelectMarket={onSelectMarket}
        onNavigateScreen={chatProps.onNavigateScreen}
      />
    </div>
  );
};
