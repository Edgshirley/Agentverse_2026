// Scripted betting session for the dev-only /sim page. Every step goes through
// the real API as one of the personas, so the page exercises the real engine.

export type SimPost = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

export interface SimStep {
  chapter: string;
  label: string;
  run: (post: SimPost) => Promise<void>;
  /** Market the UI should show once the step has run. */
  marketId?: string;
  /** Opens the bet drawer once the step has run. */
  openBet?: boolean;
}

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

function say(chapter: string, playerId: string, text: string): SimStep {
  return {
    chapter,
    label: `${NAMES[playerId]}: ${text}`,
    run: async (post) => {
      await post('/api/chat', { playerId, text });
    },
  };
}

function act(
  chapter: string,
  label: string,
  path: string,
  body: Record<string, unknown>,
  marketId: string,
  openBet = false
): SimStep {
  return {
    chapter,
    label,
    marketId,
    openBet,
    run: async (post) => {
      await post(path, body);
    },
  };
}

const take = (chapter: string, id: string, playerId: string, side: string, amount: number) =>
  act(
    chapter,
    `${NAMES[playerId]} takes ${side}`,
    market(id, 'take'),
    { playerId, side, amount },
    id
  );

const tick = (chapter: string, id: string, label: string, openBet = false) =>
  act(chapter, label, market(id, 'replay/step'), {}, id, openBet);

const IDEA = 'The idea';
const AUCTION = 'Width auction';
const SIDES = 'Taking sides';
const MATCH = 'Match day';
const WEATHER_BET = 'Weather bet';
const STOPS = 'Stops fire';

export const SIM_STEPS: SimStep[] = [
  say(IDEA, 'michel', "Arsenal v Chelsea tonight. Who's calling the first goal?"),
  say(IDEA, 'nathalie', 'Not before half time. Those two cancel each other out.'),
  say(IDEA, 'edouard', "Let's price it. First goal minute, 10 chips a lot."),

  act(
    AUCTION,
    'Michel opens the market',
    '/api/markets',
    {
      id: ARSENAL,
      proposer_id: 'michel',
      archetype: 'spread',
      question: 'Arsenal v Chelsea: minute of the first goal?',
      unit: 'min',
      bounds: [0, 95],
      no_event_value: 95,
      criteria: 'Minute of the first goal, per the official match report',
      resolution_source: 'Match feed',
      payoff_mode: 'linear',
      lot_stake_k: 10,
      cap_widths_c: 3,
      verifiability: 'public_verifiable',
      route: 'auto',
      live_implied_value: 40,
      toggles: TOGGLES,
    },
    ARSENAL
  ),
  act(AUCTION, 'Jules bids a 12 minute window', market(ARSENAL, 'auction/bid'), { playerId: 'jules', width: 12 }, ARSENAL),
  act(AUCTION, 'Édouard undercuts at 8 minutes', market(ARSENAL, 'auction/bid'), { playerId: 'edouard', width: 8 }, ARSENAL),
  say(AUCTION, 'jules', 'Eight? Bon courage, Édouard.'),
  act(AUCTION, 'Auction closes: Édouard is market maker', market(ARSENAL, 'auction/finalize'), {}, ARSENAL),
  act(AUCTION, 'Édouard quotes [35, 43]', market(ARSENAL, 'auction/quote'), { playerId: 'edouard', L: 35 }, ARSENAL),

  say(SIDES, 'edouard', 'Window is 35 to 43. Above or below, mes amis.'),
  take(SIDES, ARSENAL, 'nathalie', 'OVER', 2),
  take(SIDES, ARSENAL, 'michel', 'UNDER', 2),
  take(SIDES, ARSENAL, 'jules', 'UNDER', 1),
  take(SIDES, ARSENAL, 'andre', 'OVER', 1),
  act(SIDES, 'Takes lock: the market is live', market(ARSENAL, 'lock-takes'), {}, ARSENAL, true),

  tick(MATCH, ARSENAL, "1': kickoff", true),
  tick(MATCH, ARSENAL, "18': Saka hits the bar"),
  say(MATCH, 'michel', 'So close. Early goal incoming.'),
  tick(MATCH, ARSENAL, "30': still scoreless"),
  say(MATCH, 'nathalie', 'Half an hour gone. Comfortable.'),
  tick(MATCH, ARSENAL, "38': Havertz scores, provisional"),
  say(MATCH, 'michel', 'HAVERTZ! Right inside the window!'),
  tick(MATCH, ARSENAL, "40': VAR rules it out"),
  say(MATCH, 'nathalie', 'Offside. Désolée, Michel.'),
  tick(MATCH, ARSENAL, "45': half time, past the window"),
  tick(MATCH, ARSENAL, "50': Ødegaard scores, market settles"),
  say(MATCH, 'andre', 'Above wins. Merci, Ødegaard.'),

  say(WEATHER_BET, 'andre', 'Quick one for tomorrow. Does it hit 24°C?'),
  act(
    WEATHER_BET,
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
      route: 'auto',
      live_implied_value: 50,
      toggles: TOGGLES,
    },
    WEATHER,
    true
  ),
  take(WEATHER_BET, WEATHER, 'andre', 'YES', 50),
  take(WEATHER_BET, WEATHER, 'jules', 'YES', 30),
  take(WEATHER_BET, WEATHER, 'michel', 'NO', 40),
  take(WEATHER_BET, WEATHER, 'nathalie', 'YES', 20),
  act(
    WEATHER_BET,
    'André sets a stop at 46%',
    market(WEATHER, 'orders'),
    { playerId: 'andre', side: 'YES', type: 'stop_loss', triggerLevel: 46, sizeToks: 40 },
    WEATHER
  ),
  act(
    WEATHER_BET,
    'Nathalie sets a take-profit at 70%',
    market(WEATHER, 'orders'),
    { playerId: 'nathalie', side: 'YES', type: 'take_profit', triggerLevel: 70, sizeToks: 20 },
    WEATHER
  ),

  tick(STOPS, WEATHER, 'Forecast update: 49%'),
  tick(STOPS, WEATHER, "Forecast drops to 45%: André's stop fires"),
  say(STOPS, 'andre', 'Stopped out. Discipline.'),
  tick(STOPS, WEATHER, 'Forecast recovers to 58%'),
  say(STOPS, 'jules', 'André, you sold the bottom.'),
  tick(STOPS, WEATHER, "Forecast jumps to 74%: Nathalie's take-profit fires"),
  act(STOPS, 'It hits 25°C: market settles YES', market(WEATHER, 'resolve/settle'), { outcomeX: 100 }, WEATHER),
  say(STOPS, 'nathalie', 'Tomorrow, same table?'),
];

/** Chapters in script order, with the index of each one's first step. */
export const SIM_CHAPTERS: { name: string; firstStep: number }[] = SIM_STEPS.reduce(
  (chapters, step, index) =>
    chapters.some((c) => c.name === step.chapter)
      ? chapters
      : [...chapters, { name: step.chapter, firstStep: index }],
  [] as { name: string; firstStep: number }[]
);
