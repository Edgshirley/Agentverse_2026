// Scripted betting session for the dev-only simulator. Every step goes through
// the real API as one of the personas, so the page exercises the real engine.

export type SimPost = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

export interface SimStep {
  label: string;
  run: (post: SimPost) => Promise<void>;
  /** Market the UI should show once the step has run. */
  marketId?: string;
  /** Opens the bet drawer once the step has run. */
  openBet?: boolean;
  /** Sound effect played when the step runs. */
  sound?: SimSound;
  /** UI-only beat: show the MarketMate suggestion card, or press its button. */
  ui?: 'suggest' | 'create';
  /** Relative screen time (default 1). */
  weight?: number;
}

/** The real player watching the sim. */
export interface SimMe {
  id: string;
  name: string;
}

export const SIM_SUGGESTION = {
  quote: "Arsenal v Chelsea tonight. I reckon the first goal comes before half time. Who's in?",
  question: 'Arsenal v Chelsea: minute of the first goal?',
  detail: 'Spread bet · 0–95 min · 10 CHIP a lot',
};

export type SimSound =
  | 'chat'
  | 'open'
  | 'bid'
  | 'confirm'
  | 'chips'
  | 'lock'
  | 'tick'
  | 'goal'
  | 'buzz'
  | 'alarm'
  | 'cash'
  | 'win';

const ARSENAL = 'sim_arsenal';
const WEATHER = 'sim_weather';

const TOGGLES = {
  max_lots: 3,
  forced_trading: false,
  hidden_takes: false,
  single_mm_requote: true,
  live_reopen_halftime: false,
  public_positions_and_stops: true,
};

const NAMES: Record<string, string> = {
  edouard: 'Édouard',
  jules: 'Jules',
  andre: 'André',
  michel: 'Michel',
  nathalie: 'Nathalie',
};

const market = (id: string, action: string) => `/api/markets/${id}/${action}`;

function say(playerId: string, text: string, name = NAMES[playerId]): SimStep {
  return {
    label: `${name}: ${text}`,
    sound: 'chat',
    run: async (post) => {
      await post('/api/chat', { playerId, text });
    },
  };
}

function act(
  label: string,
  path: string,
  body: Record<string, unknown>,
  marketId: string,
  openBet = false,
  sound: SimSound = soundFor(label)
): SimStep {
  return {
    sound,
    label,
    marketId,
    openBet,
    run: async (post) => {
      await post(path, body);
    },
  };
}

function soundFor(label: string): SimSound {
  if (/settles/.test(label)) return 'win';
  if (/scores/.test(label)) return 'goal';
  if (/VAR|rules it out/.test(label)) return 'buzz';
  if (/stop fires/.test(label)) return 'alarm';
  if (/take-profit fires/.test(label)) return 'cash';
  if (/opens/.test(label)) return 'open';
  if (/bids|undercuts/.test(label)) return 'bid';
  if (/takes /.test(label)) return 'chips';
  if (/lock/i.test(label)) return 'lock';
  if (/^\d+'|Forecast/.test(label)) return 'tick';
  return 'confirm';
}

const take = (id: string, playerId: string, side: string, amount: number) =>
  act(
    `${NAMES[playerId]} takes ${side}`,
    market(id, 'take'),
    { playerId, side, amount },
    id
  );

const tick = (id: string, label: string, openBet = false) =>
  act(label, market(id, 'replay/step'), {}, id, openBet);

const ui = (label: string, kind: 'suggest' | 'create', weight: number): SimStep => ({
  label,
  ui: kind,
  weight,
  sound: kind === 'suggest' ? 'open' : 'confirm',
  run: async () => {},
});

export function buildSimSteps(me: SimMe): SimStep[] {
  return [
    { ...say(me.id, SIM_SUGGESTION.quote, me.name), weight: 1.5 },
    ui('MarketMate: that sounds like a bet. Make it a market?', 'suggest', 2.5),
    say('michel', "I'm in. Early goal, easy."),
    say('nathalie', 'Not before half time. Those two cancel each other out.'),
    ui('You tap CREATE MARKET', 'create', 1.5),

    act(
      'You open the market',
      '/api/markets',
      {
        id: ARSENAL,
        proposer_id: me.id,
        archetype: 'spread',
        question: SIM_SUGGESTION.question,
        unit: 'min',
        bounds: [0, 95],
        no_event_value: 95,
        criteria: 'Minute of the first goal, per the official match report',
        resolution_source: 'Match feed',
        payoff_mode: 'linear',
        lot_stake_k: 10,
        cap_widths_c: 3,
        verifiability: 'public_verifiable',
        origin: 'preset',
        route: 'auto',
        live_implied_value: 40,
        toggles: TOGGLES,
      },
      ARSENAL
    ),
    act('Jules bids a 12 minute window', market(ARSENAL, 'auction/bid'), { playerId: 'jules', width: 12 }, ARSENAL),
    act('Édouard undercuts at 8 minutes', market(ARSENAL, 'auction/bid'), { playerId: 'edouard', width: 8 }, ARSENAL),
    act('Auction closes: Édouard is market maker', market(ARSENAL, 'auction/finalize'), {}, ARSENAL),
    act('Édouard quotes [35, 43]', market(ARSENAL, 'auction/quote'), { playerId: 'edouard', L: 35 }, ARSENAL),

    take(ARSENAL, 'nathalie', 'OVER', 2),
    take(ARSENAL, 'michel', 'UNDER', 2),
    take(ARSENAL, 'jules', 'UNDER', 1),
    take(ARSENAL, 'andre', 'OVER', 1),
    act('Takes lock: the market is live', market(ARSENAL, 'lock-takes'), { playerId: 'edouard' }, ARSENAL, true),

    tick(ARSENAL, "1': kickoff", true),
    tick(ARSENAL, "18': Saka hits the bar"),
    tick(ARSENAL, "30': still scoreless"),
    tick(ARSENAL, "38': Havertz scores, provisional"),
    say('michel', 'HAVERTZ! Right inside the window!'),
    tick(ARSENAL, "40': VAR rules it out"),
    tick(ARSENAL, "45': half time, past the window"),
    tick(ARSENAL, "50': Ødegaard scores, market settles"),
    say('andre', 'Above wins. Thank you, Ødegaard!'),

    say('andre', 'Quick one for tomorrow. Does it hit 24°C?'),
    act(
      'André opens a yes/no market',
      '/api/markets',
      {
        id: WEATHER,
        proposer_id: 'andre',
        archetype: 'simple',
        question: 'Will it hit 24°C tomorrow?',
        unit: '%',
        bounds: [0, 100],
        no_event_value: 0,
        criteria: 'Highest temperature recorded tomorrow',
        resolution_source: 'Weather feed',
        payoff_mode: 'pot',
        lot_stake_k: 10,
        cap_widths_c: 3,
        verifiability: 'public_verifiable',
        origin: 'preset',
        route: 'auto',
        live_implied_value: 50,
        toggles: TOGGLES,
      },
      WEATHER,
      true
    ),
    take(WEATHER, 'andre', 'YES', 50),
    take(WEATHER, 'jules', 'YES', 30),
    take(WEATHER, 'michel', 'NO', 40),
    take(WEATHER, 'nathalie', 'YES', 20),
    act(
      'André sets a stop at 46%',
      market(WEATHER, 'orders'),
      { playerId: 'andre', side: 'YES', type: 'stop_loss', triggerLevel: 46, sizeToks: 40 },
      WEATHER
    ),
    act(
      'Nathalie sets a take-profit at 70%',
      market(WEATHER, 'orders'),
      { playerId: 'nathalie', side: 'YES', type: 'take_profit', triggerLevel: 70, sizeToks: 20 },
      WEATHER
    ),

    tick(WEATHER, 'Forecast update: 49%'),
    tick(WEATHER, "Forecast drops to 45%: André's stop fires"),
    say('andre', 'Stopped out. Discipline.'),
    tick(WEATHER, 'Forecast recovers to 58%'),
    tick(WEATHER, "Forecast jumps to 74%: Nathalie's take-profit fires"),
    {
      ...act('It hits 25°C: market settles YES', market(WEATHER, 'resolve/settle'), { outcomeX: 100 }, WEATHER),
      weight: 2,
    },
  ];
}
