import React from 'react';
import { ArrowDown } from 'pixelarticons/react/ArrowDown.js';
import { ArrowRight } from 'pixelarticons/react/ArrowRight.js';
import { ArrowUp } from 'pixelarticons/react/ArrowUp.js';
import { Building } from 'pixelarticons/react/Building.js';
import { Car } from 'pixelarticons/react/Car.js';
import { Chart } from 'pixelarticons/react/Chart.js';
import { Check } from 'pixelarticons/react/Check.js';
import { ChevronDown } from 'pixelarticons/react/ChevronDown.js';
import { ChevronUp } from 'pixelarticons/react/ChevronUp.js';
import { Close } from 'pixelarticons/react/Close.js';
import { Coins } from 'pixelarticons/react/Coins.js';
import { Flag } from 'pixelarticons/react/Flag.js';
import { Forward } from 'pixelarticons/react/Forward.js';
import { Link } from 'pixelarticons/react/Link.js';
import { Lock } from 'pixelarticons/react/Lock.js';
import { Login } from 'pixelarticons/react/Login.js';
import { Logout } from 'pixelarticons/react/Logout.js';
import { Message } from 'pixelarticons/react/Message.js';
import { Mic } from 'pixelarticons/react/Mic.js';
import { Minus } from 'pixelarticons/react/Minus.js';
import { Moon } from 'pixelarticons/react/Moon.js';
import { Play } from 'pixelarticons/react/Play.js';
import { Plus } from 'pixelarticons/react/Plus.js';
import { Reload } from 'pixelarticons/react/Reload.js';
import { Send } from 'pixelarticons/react/Send.js';
import { Shield } from 'pixelarticons/react/Shield.js';
import { Sliders } from 'pixelarticons/react/Sliders.js';
import { Star } from 'pixelarticons/react/Star.js';
import { Sun } from 'pixelarticons/react/Sun.js';
import { Target } from 'pixelarticons/react/Target.js';
import { Thermometer } from 'pixelarticons/react/Thermometer.js';
import { Trophy } from 'pixelarticons/react/Trophy.js';
import { Undo } from 'pixelarticons/react/Undo.js';
import { User } from 'pixelarticons/react/User.js';
import { UserPlus } from 'pixelarticons/react/UserPlus.js';
import { Users } from 'pixelarticons/react/Users.js';
import { Wallet } from 'pixelarticons/react/Wallet.js';
import { Zap } from 'pixelarticons/react/Zap.js';
import { Volume3 } from 'pixelarticons/react/Volume3.js';
import { VolumeX } from 'pixelarticons/react/VolumeX.js';

const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  building: Building,
  car: Car,
  chart: Chart,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  close: Close,
  coins: Coins,
  flag: Flag,
  forward: Forward,
  link: Link,
  lock: Lock,
  login: Login,
  logout: Logout,
  message: Message,
  mic: Mic,
  minus: Minus,
  moon: Moon,
  play: Play,
  plus: Plus,
  reload: Reload,
  send: Send,
  shield: Shield,
  sliders: Sliders,
  star: Star,
  sun: Sun,
  target: Target,
  thermometer: Thermometer,
  trophy: Trophy,
  undo: Undo,
  user: User,
  'user-plus': UserPlus,
  users: Users,
  wallet: Wallet,
  zap: Zap,
  volume: Volume3,
  'volume-x': VolumeX,
};

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
}

/**
 * Single entry point for the app's pixel icons. Icons are decorative here, so
 * icon-only controls must set their own aria-label and title.
 */
export const Icon: React.FC<IconProps> = ({ name, size = 16 }) => {
  const Glyph = ICONS[name];
  return <Glyph width={size} height={size} className="px-icon" aria-hidden="true" />;
};
