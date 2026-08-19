// River Stakes — versioned content data: themes, tutorial, journey, challenges, daily, achievements
import { seedFromString, Rng } from './rules/rng.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Themes — exactly 5, all original. Palettes feed both CSS custom properties
// and the 3D scene (felt/table/river/sky).
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'firstlight',
    name: 'Firstlight',
    desc: 'A quiet dawn on the water — pale sky, warm wood, soft green felt.',
    palette: {
      background: '#f4e9d8', felt: '#7fae8e', table: '#8a6a4f', accent: '#d98e4a',
      text: '#2e2620', cardBack: '#d96f5a', river: '#9fc6d8', sky: '#ffd9a8',
    },
    unlock: 'default',
  },
  {
    id: 'emberdusk',
    name: 'Emberdusk',
    desc: 'Lantern light and a slow orange sky as the evening game begins.',
    palette: {
      background: '#241d26', felt: '#3f5d52', table: '#4a3428', accent: '#e07b39',
      text: '#f2e6d8', cardBack: '#8c3b46', river: '#31465e', sky: '#5a3a4a',
    },
    unlock: 'default',
  },
  {
    id: 'noir-tide',
    name: 'Noir Tide',
    desc: 'A monochrome midnight salon — chrome accents on black water.',
    palette: {
      background: '#101216', felt: '#1d2b2a', table: '#191919', accent: '#c0c4cc',
      text: '#e8e8ea', cardBack: '#2a2f3a', river: '#16202c', sky: '#0a0c10',
    },
    unlock: { journey: 10 },
  },
  {
    id: 'willowbank',
    name: 'Willowbank',
    desc: 'A shaded garden bend — willow green, brass, and slow bright water.',
    palette: {
      background: '#e8f0df', felt: '#5d8a5a', table: '#7a5c3d', accent: '#b5892d',
      text: '#22301e', cardBack: '#4d7a63', river: '#7fb3a3', sky: '#d8ecc8',
    },
    unlock: { journey: 20 },
  },
  {
    id: 'regatta',
    name: 'Regatta',
    desc: 'Race-day colors — crisp blues and signal red on open water.',
    palette: {
      background: '#e9eef4', felt: '#2e5f7a', table: '#6b4f35', accent: '#c94f3d',
      text: '#1c2733', cardBack: '#274b6d', river: '#4d8fb5', sky: '#cfe4f2',
    },
    unlock: { achievement: 'estuary_champion' },
  },
];

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

const YOU = { id: 'you', name: 'You', ai: null };
const OPP = (name, ai) => ({ id: name.toLowerCase(), name, ai });

/** Engine config: human seat first, then opponents. Chips = bigBlind * stackBB. */
function mkConfig(seed, opponents, bigBlind, stackBB, maxHands) {
  if (bigBlind % 2 !== 0) throw new Error('bigBlind must be even so smallBlind is an integer');
  return {
    seed,
    smallBlind: bigBlind / 2,
    bigBlind,
    players: [
      { ...YOU, chips: bigBlind * stackBB },
      ...opponents.map(([name, ai]) => ({ ...OPP(name, ai), chips: bigBlind * stackBB })),
    ],
    maxHands: maxHands ?? null,
  };
}

// Goal shorthands (keep stage tables readable; expand to contract goal objects)
const gWin = () => ({ type: 'winMatch' });
const gChips = (amount) => ({ type: 'chipsAtLeast', amount });
const gHands = (count) => ({ type: 'winHands', count });
const gShow = (count) => ({ type: 'winShowdowns', count });
const gSurvive = (count) => ({ type: 'surviveHands', count });
const gTop = (place) => ({ type: 'finishTop', place });

export const GOAL_TYPES = ['winMatch', 'chipsAtLeast', 'winHands', 'winShowdowns', 'surviveHands', 'finishTop'];

// ---------------------------------------------------------------------------
// Tutorial — one rule at a time, vs a passive easy AI. Hints read legalActions.
// ---------------------------------------------------------------------------

const tutConfig = (key, maxHands) =>
  mkConfig(seedFromString(`riverstakes:tutorial:${key}`), [['Moss', 'easy']], 10, 100, maxHands);

export const TUTORIAL = [
  {
    id: 't01-blinds',
    title: 'Posting the Blinds',
    body: 'Every hand starts with two forced bets — the small blind and the big blind — so there is always something to play for. Heads-up, the dealer posts the small blind and acts first after the flop.',
    config: tutConfig('blinds', 2),
    goal: 'Start the hand and watch the blinds go in.',
    steps: [
      {
        text: 'The table is set and the dealer button sits in front of you. Start the hand to post the blinds.',
        requireAction: 'advance',
        hint: (state, legal) => legal.some((a) => a.type === 'advance')
          ? 'Press Deal to post the blinds and receive your cards.'
          : 'Wait for the table to be ready, then deal the hand.',
      },
      {
        text: 'The blinds are in: you posted the small blind, Moss posted the big blind. These chips seed the pot.',
        requireEvent: 'post',
        hint: (state, legal) => 'Watch the pot — the small and big blinds were just added automatically.',
      },
      {
        text: 'Two private cards slide to each player. Only you can see yours.',
        requireEvent: 'deal',
        hint: (state, legal) => 'Your two face-up cards at the bottom are yours alone.',
      },
    ],
  },
  {
    id: 't02-check-call',
    title: 'Check and Call',
    body: 'When a bet is live in front of you, calling means matching it to stay in the hand. When no bet is live, checking passes the action along for free.',
    config: tutConfig('check-call', 4),
    goal: 'Call a bet to stay in the hand.',
    steps: [
      {
        text: 'Moss has posted the big blind, so 10 chips is the live bet. Match it to see the flop.',
        requireAction: 'call',
        hint: (state, legal) => {
          const call = legal.find((a) => a.type === 'call');
          return call
            ? `Press Call to put in the ${call.amount} chips needed to match the big blind.`
            : 'No bet to match right now — wait for the action to reach you.';
        },
      },
      {
        text: 'On later streets, when nobody has bet yet, you can check to pass without adding chips.',
        requireEvent: 'street',
        hint: (state, legal) => legal.some((a) => a.type === 'check')
          ? 'Check is available — it costs nothing and keeps you in the hand.'
          : 'If a bet is live, calling matches it; if not, checking is free.',
      },
    ],
  },
  {
    id: 't03-bet-raise',
    title: 'Bet and Raise',
    body: 'Fixed-limit poker uses set bet sizes: one big blind before and on the flop, two big blinds on the turn and river. A raise adds exactly one more fixed bet, and each round allows at most four bets.',
    config: tutConfig('bet-raise', 4),
    goal: 'Make a bet or raise to build the pot.',
    steps: [
      {
        text: 'The action is yours. Put pressure on Moss with a bet or a raise.',
        requireAction: 'bet',
        hint: (state, legal) => {
          const bet = legal.find((a) => a.type === 'bet');
          const raise = legal.find((a) => a.type === 'raise');
          if (bet) return `Press Bet to put in the fixed bet of ${bet.amount} chips.`;
          if (raise) return `Press Raise to make it ${raise.amount} chips total this round.`;
          return 'Wait until the action reaches you, then bet or raise.';
        },
      },
      {
        text: 'Well played. Watch how the fixed bet size doubles on the turn and river.',
        requireEvent: 'street',
        hint: (state, legal) => {
          const bet = legal.find((a) => a.type === 'bet');
          const raise = legal.find((a) => a.type === 'raise');
          const sized = bet || raise;
          return sized
            ? `The fixed amount on this street is ${sized.amount} chips.`
            : 'Fixed-limit means the bet size is never a guess — it is set by the street.';
        },
      },
    ],
  },
  {
    id: 't04-folding',
    title: 'Folding',
    body: 'Folding surrenders the hand and any chips you already put in — but it costs nothing more. When the price is wrong, folding is the move that keeps you at the table.',
    config: tutConfig('folding', 4),
    goal: 'Fold a hand you do not want to pay for.',
    steps: [
      {
        text: 'A bet is live and your hand is weak. Let this one go.',
        requireAction: 'fold',
        hint: (state, legal) => legal.some((a) => a.type === 'fold')
          ? 'Press Fold to give up the hand without adding another chip.'
          : 'Folding is only possible when the action is on you — wait for your turn.',
      },
      {
        text: 'The hand ends the moment everyone but one player has folded. The pot goes to the last player standing.',
        requireEvent: 'handEnd',
        hint: (state, legal) => 'After your fold the pot is awarded immediately — no showdown needed.',
      },
    ],
  },
  {
    id: 't05-streets',
    title: 'The Community Cards',
    body: 'Five shared cards arrive in stages: the flop (three cards), the turn (one), and the river (one). A round of betting follows each stage. Combine them with your two private cards to make the best five-card hand.',
    config: tutConfig('streets', 3),
    goal: 'See a flop, a turn, and a river.',
    steps: [
      {
        text: 'Call or check your way to the flop — three community cards dealt at once.',
        requireEvent: 'street',
        hint: (state, legal) => {
          const call = legal.find((a) => a.type === 'call');
          if (call) return `Call ${call.amount} to see the flop.`;
          return legal.some((a) => a.type === 'check')
            ? 'Check to see the next community cards for free.'
            : 'Match the action to reach the flop.';
        },
      },
      {
        text: 'That was a new street. Two more stages may follow: the turn, then the river.',
        requireEvent: 'street',
        hint: (state, legal) => legal.some((a) => a.type === 'check')
          ? 'Check or call to keep moving through the streets.'
          : 'Each new community card is followed by a betting round.',
      },
      {
        text: 'One more stage and the board is complete — five shared cards at most.',
        requireEvent: 'street',
        hint: (state, legal) => 'After the river there are no more cards — just one last betting round.',
      },
    ],
  },
  {
    id: 't06-showdown',
    title: 'Showdown and Hand Rankings',
    body: 'If more than one player remains after the river, hands are revealed. The best five-card hand wins: from high card up through pairs, straights and flushes, to the rare straight flush. Split pots divide evenly, odd chips to the earliest seat.',
    config: tutConfig('showdown', 3),
    goal: 'Reach a showdown and see how hands are compared.',
    steps: [
      {
        text: 'Stay in the hand — call or check down and take Moss to a showdown.',
        requireEvent: 'showdown',
        hint: (state, legal) => {
          const call = legal.find((a) => a.type === 'call');
          if (call) return `Call ${call.amount} — never fold while you are trying to reach showdown.`;
          return legal.some((a) => a.type === 'check')
            ? 'Check — keeping the pot small still reaches showdown.'
            : 'Match any bet and the hands will be revealed after the river.';
        },
      },
      {
        text: 'Both hands were revealed and ranked. The best five cards took the pot.',
        requireEvent: 'handEnd',
        hint: (state, legal) => 'Read the revealed hands: the named rank beside each shows why it won or lost.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Journey — 40 authored stages in 8 arcs. Difficulty comes from structure:
// opponent count and skill, stack depth in big blinds, blind level, and
// maxHands pressure. Every 5th stage is a mastery stage.
// ---------------------------------------------------------------------------

// row: [title, desc, opponents, bigBlind, stackBB, maxHands, goals, teaches, theme]
const JOURNEY_ROWS = [
  // Arc A — First Current: heads-up, deep stacks, passive AI
  ['First Stake', 'A quiet heads-up game at dawn. Learn the rhythm of the blinds and stay for a few hands.',
    [['Moss', 'easy']], 10, 100, 10, [gSurvive(5)], 'posting blinds', 'firstlight'],
  ['Call the Current', 'Moss rarely raises. Practice matching the price and seeing flops.',
    [['Moss', 'easy']], 10, 100, 12, [gHands(1)], 'check/call', 'firstlight'],
  ['Raise the River', 'Pots are built one fixed bet at a time. Finish ahead of where you started.',
    [['Moss', 'easy']], 10, 100, 12, [gChips(1100)], 'bet/raise', 'firstlight'],
  ['Knowing When to Fold', 'Not every hand is worth a chip. Pick your spots and still take two pots.',
    [['Moss', 'easy']], 10, 100, 12, [gHands(2)], 'folding', 'firstlight'],
  ['Dawn Examination', 'Mastery: everything so far, one opponent, twenty hands. Win the match.',
    [['Moss', 'easy']], 10, 100, 20, [gWin()], null, 'firstlight'],
  // Arc B — Three at the Table: a third seat, hand limits arrive
  ['A Wider Table', 'A third chair changes everything — more hands to beat, more chips to win.',
    [['Moss', 'easy'], ['Heron', 'easy']], 10, 90, 15, [gTop(2)], 'seats & position', 'emberdusk'],
  ['Three-Way Waters', 'Multiway pots grow fast. Two winning hands will prove you can navigate them.',
    [['Moss', 'easy'], ['Heron', 'easy']], 10, 90, 15, [gHands(2)], 'multiway pots', 'emberdusk'],
  ['The Clock of the River', 'A hand limit now bounds the match. Be alive — and ahead — when it ends.',
    [['Moss', 'easy'], ['Heron', 'easy']], 10, 90, 12, [gSurvive(12)], 'hand limits', 'emberdusk'],
  ['Reading the Board', 'Community cards tell a story. Win one pot with the best hand at showdown.',
    [['Moss', 'easy'], ['Heron', 'easy']], 10, 90, 15, [gShow(1)], 'community cards', 'emberdusk'],
  ['Bend in the River', 'Mastery: three seats, one match, first place or nothing.',
    [['Moss', 'easy'], ['Heron', 'easy']], 10, 90, 20, [gWin()], null, 'emberdusk'],
  // Arc C — Steady Water: normal AI sits down
  ['Stronger Swimmers', 'Heron has sharpened up. Top two against a thinking opponent.',
    [['Moss', 'easy'], ['Heron', 'normal']], 20, 80, 18, [gTop(2)], 'tougher opponents', 'firstlight'],
  ['Value and Price', 'Fixed limits reward patience. Grow your stack by two hundred.',
    [['Moss', 'easy'], ['Heron', 'normal']], 20, 80, 18, [gChips(1800)], 'fixed-limit value', 'firstlight'],
  ['Patience in the Eddy', 'Fifteen hands, no more. Survive every one of them.',
    [['Moss', 'easy'], ['Heron', 'normal']], 20, 80, 15, [gSurvive(15)], 'survival', 'firstlight'],
  ['Showdown Craft', 'Win two showdowns against opponents who now fight back.',
    [['Moss', 'easy'], ['Heron', 'normal']], 20, 80, 18, [gShow(2)], 'showdowns', 'firstlight'],
  ['Stillwater Test', 'Mastery: calm water hides strong currents. Take first place.',
    [['Moss', 'easy'], ['Heron', 'normal']], 20, 80, 24, [gWin()], null, 'firstlight'],
  // Arc D — Narrowing Banks: four seats, shallower stacks
  ['Four at Dusk', 'Four players and shorter stacks. Finish in the top half.',
    [['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal']], 20, 60, 20, [gTop(2)], 'four-handed play', 'emberdusk'],
  ['Shortening Stacks', 'Sixty big blinds goes faster than you think. Last all sixteen hands.',
    [['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal']], 20, 60, 16, [gSurvive(16)], 'stack depth', 'emberdusk'],
  ['Pressure Play', 'Three winning hands against a crowded table.',
    [['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal']], 20, 60, 20, [gHands(3)], 'aggression', 'emberdusk'],
  ['Chip Ledger', 'End the match three hundred chips richer than you began.',
    [['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal']], 20, 60, 20, [gChips(1500)], 'bankroll tracking', 'emberdusk'],
  ['Willow Gate', 'Mastery: four seats, dusk light, first place required.',
    [['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal']], 20, 60, 24, [gWin()], null, 'emberdusk'],
  // Arc E — Quickwater: five seats, forty-five big blinds
  ['Crowded Water', 'Five seats and shallow stacks. A podium finish is a real result here.',
    [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy'], ['Otter', 'normal']], 20, 45, 16, [gTop(3)], 'five-handed play', 'noir-tide'],
  ['Thin Margins', 'Forty-five big blinds, no wasted chips. Finish two hundred ahead.',
    [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy'], ['Otter', 'normal']], 20, 45, 16, [gChips(1100)], 'efficiency', 'noir-tide'],
  ['Steady Hands', 'Fourteen hands, five seats. Simply outlast the table.',
    [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy'], ['Otter', 'normal']], 20, 45, 14, [gSurvive(14)], 'discipline', 'noir-tide'],
  ['River Decisions', 'The river is where pots are won. Take two at showdown.',
    [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy'], ['Otter', 'normal']], 20, 45, 16, [gShow(2)], 'river play', 'noir-tide'],
  ['Quickwater Test', 'Mastery: five seats, shallow water, win it all.',
    [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy'], ['Otter', 'normal']], 20, 45, 20, [gWin()], null, 'noir-tide'],
  // Arc F — Hard Pull: the first hard AI arrives
  ['The Hard Pull', 'Pike does not give chips away. A podium finish against the current.',
    [['Pike', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 35, 14, [gTop(3)], 'expert opponents', 'emberdusk'],
  ['Deep Trouble', 'Thirty-five big blinds against Pike. Survive all twelve hands.',
    [['Pike', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 35, 12, [gSurvive(12)], 'damage control', 'emberdusk'],
  ["Pike's Territory", 'Take three pots from a table that includes a genuine expert.',
    [['Pike', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 35, 14, [gHands(3)], 'pot selection', 'emberdusk'],
  ['Narrow Escape', 'Leave the table two hundred chips richer. Pike will object.',
    [['Pike', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 35, 14, [gChips(1600)], 'defense', 'emberdusk'],
  ['Regatta Qualifier', 'Mastery: beat the field — Pike included — for first place.',
    [['Pike', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 35, 18, [gWin()], null, 'emberdusk'],
  // Arc G — Regatta Trials: full six-seat tables
  ['Full Regatta', 'Six seats, two experts, twenty-eight big blinds. Reach the podium.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 28, 12, [gTop(3)], 'six-handed play', 'willowbank'],
  ['Six-Handed Squeeze', 'Ten hands at a full table. Be standing at the end.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 28, 10, [gSurvive(10)], 'endgame survival', 'willowbank'],
  ['Tide of Chips', 'Short stacks, full table. Finish two hundred and eighty ahead.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 28, 12, [gChips(1400)], 'chip accumulation', 'willowbank'],
  ['Showdown at the Buoys', 'Win two showdowns with five opponents reading your play.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 28, 12, [gShow(2)], 'showdown selection', 'willowbank'],
  ['Buoy Line Test', 'Mastery: the full table, the full distance, first place.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'normal'], ['Silt', 'normal'], ['Otter', 'normal']], 40, 28, 16, [gWin()], null, 'willowbank'],
  // Arc H — The Estuary: six seats, twenty big blinds, the toughest water
  ['Estuary Mouth', 'Where the river meets the sea: six seats and only twenty big blinds.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'hard'], ['Heron', 'normal'], ['Otter', 'normal']], 50, 20, 10, [gTop(3)], 'short-stack play', 'regatta'],
  ['Last Deep Water', 'Ten hands to prove you belong here. Survive them all.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'hard'], ['Heron', 'normal'], ['Otter', 'normal']], 50, 20, 10, [gSurvive(10)], 'final-table nerve', 'regatta'],
  ['Salt and Silt', 'Three pots against three experts. Nothing comes easy now.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'hard'], ['Heron', 'normal'], ['Otter', 'normal']], 50, 20, 10, [gHands(3)], 'opportunism', 'regatta'],
  ["Champion's Stretch", 'The penultimate test: finish top two at the hardest table on the river.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'hard'], ['Heron', 'normal'], ['Otter', 'normal']], 50, 20, 12, [gTop(2)], 'closing', 'regatta'],
  ['The Estuary Crown', 'Final mastery: six seats, three experts, twenty big blinds. Win the crown.',
    [['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'hard'], ['Heron', 'normal'], ['Otter', 'normal']], 50, 20, 14, [gWin()], null, 'regatta'],
];

export const JOURNEY = JOURNEY_ROWS.map((row, i) => {
  const [title, desc, opponents, bigBlind, stackBB, maxHands, goals, teaches, theme] = row;
  const id = `j${String(i + 1).padStart(2, '0')}`;
  const stage = {
    id,
    index: i + 1,
    title,
    desc,
    seed: seedFromString(`riverstakes:journey:${id}`),
    theme,
    config: mkConfig(seedFromString(`riverstakes:journey:${id}`), opponents, bigBlind, stackBB, maxHands),
    par: maxHands ?? 15,
    mastery: (i + 1) % 5 === 0,
    goals,
    teaches,
  };
  if (id === 'j10') stage.unlocksTheme = 'noir-tide';
  if (id === 'j20') stage.unlocksTheme = 'willowbank';
  return stage;
});

// ---------------------------------------------------------------------------
// Challenges — constrained variants
// ---------------------------------------------------------------------------

export const CONSTRAINT_TYPES = ['moveLimit', 'speedTarget', 'shortStack', 'noFoldPreflop'];

const chSeed = (id) => seedFromString(`riverstakes:challenge:${id}`);

export const CHALLENGES = [
  {
    id: 'c01-no-easy-out',
    title: 'No Easy Out',
    desc: 'Folding before the flop is off the table. Every starting hand is played.',
    seed: chSeed('c01'),
    theme: 'firstlight',
    config: mkConfig(chSeed('c01'), [['Moss', 'easy'], ['Heron', 'easy']], 20, 40, 12),
    constraint: { type: 'noFoldPreflop' },
    goals: [gTop(2)],
    par: 12,
  },
  {
    id: 'c02-low-water',
    title: 'Low Water',
    desc: 'Ten big blinds and a short match. Every decision is nearly for your tournament life.',
    seed: chSeed('c02'),
    theme: 'emberdusk',
    config: mkConfig(chSeed('c02'), [['Heron', 'normal'], ['Silt', 'normal'], ['Reed', 'easy']], 20, 10, 10),
    constraint: { type: 'shortStack', bigBlinds: 10 },
    goals: [gSurvive(8)],
    par: 10,
  },
  {
    id: 'c03-twenty-moves',
    title: 'Twenty Moves',
    desc: 'You may act only twenty times. Make each one count.',
    seed: chSeed('c03'),
    theme: 'noir-tide',
    config: mkConfig(chSeed('c03'), [['Moss', 'normal'], ['Heron', 'normal']], 20, 50, 10),
    constraint: { type: 'moveLimit', moves: 20 },
    goals: [gHands(2)],
    par: 10,
  },
  {
    id: 'c04-four-minute-mile',
    title: 'Four-Minute Mile',
    desc: 'Win the whole match in under four minutes of table time.',
    seed: chSeed('c04'),
    theme: 'willowbank',
    config: mkConfig(chSeed('c04'), [['Moss', 'easy'], ['Heron', 'easy']], 20, 60, 8),
    constraint: { type: 'speedTarget', maxMs: 240000 },
    goals: [gWin()],
    par: 8,
  },
  {
    id: 'c05-one-bullet',
    title: 'One Bullet',
    desc: 'Five big blinds, twelve actions, three experts circling. Survive to the end.',
    seed: chSeed('c05'),
    theme: 'regatta',
    config: mkConfig(chSeed('c05'), [['Pike', 'hard'], ['Darter', 'hard'], ['Heron', 'hard']], 40, 5, 6),
    constraint: { type: 'shortStack', bigBlinds: 5, moveLimit: 12 },
    goals: [gSurvive(6)],
    par: 6,
  },
  {
    id: 'c06-downstream-dash',
    title: 'Downstream Dash',
    desc: 'Heads-up against Pike, no folding before the flop, two minutes on the clock.',
    seed: chSeed('c06'),
    theme: 'emberdusk',
    config: mkConfig(chSeed('c06'), [['Pike', 'hard']], 20, 30, 8),
    constraint: { type: 'speedTarget', maxMs: 120000, noFoldPreflop: true },
    goals: [gWin()],
    par: 8,
  },
];

// ---------------------------------------------------------------------------
// Daily — one deterministic stage-like object per UTC date
// ---------------------------------------------------------------------------

const DAILY_OPPONENTS = [
  ['Moss', 'easy'], ['Heron', 'normal'], ['Silt', 'easy'], ['Reed', 'normal'],
  ['Otter', 'normal'], ['Pike', 'hard'], ['Darter', 'hard'], ['Wren', 'easy'],
];

/**
 * Deterministic daily challenge. Same 'YYYY-MM-DD' in => identical object out.
 * @param {string} utcDate 'YYYY-MM-DD'
 * @returns {{id:string, date:string, seed:number, theme:string, config:object, goals:Array, par:number}}
 */
export function dailyForDate(utcDate) {
  if (typeof utcDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) {
    throw new Error('dailyForDate expects a YYYY-MM-DD string');
  }
  const seed = seedFromString(`riverstakes:daily:${utcDate}`);
  const rng = new Rng(seed, 'daily-content');

  const opponents = rng.shuffle([...DAILY_OPPONENTS]).slice(0, rng.range(1, 4));
  const bigBlind = rng.pick([10, 20, 40]);
  const stackBB = rng.pick([30, 40, 50, 75, 100]);
  const maxHands = rng.pick([10, 12, 16, 20]);
  const theme = rng.pick(THEMES).id;
  const startChips = bigBlind * stackBB;

  const goalPool = [
    () => gWin(),
    () => gTop(Math.min(2, opponents.length + 1)),
    () => gChips(startChips + rng.range(2, 6) * bigBlind * 5),
    () => gHands(rng.range(2, 4)),
    () => gShow(rng.range(1, 3)),
    () => gSurvive(maxHands),
  ];
  const goals = [];
  const kinds = rng.shuffle([0, 1, 2, 3, 4, 5]).slice(0, rng.range(1, 2));
  for (const k of kinds) goals.push(goalPool[k]());

  return {
    id: `daily-${utcDate}`,
    date: utcDate,
    seed,
    theme,
    config: mkConfig(seed, opponents, bigBlind, stackBB, maxHands),
    goals,
    par: maxHands,
  };
}

// ---------------------------------------------------------------------------
// Goal evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate stage goals against a Session.summary().
 * @param {Array} goals
 * @param {object} summary Session.summary()
 * @param {string} humanId
 * @returns {{passed:boolean, results:Array<{goal:object, ok:boolean, detail:string}>}}
 */
export function evaluateGoals(goals, summary, humanId) {
  const ctx = (summary && summary.goalsContext) || { finalChips: {}, places: {} };
  const stats = (summary && summary.stats && summary.stats[humanId]) || {};
  const handsPlayed = (summary && summary.handsPlayed) || 0;
  const terminal = !!(summary && summary.terminal);
  const chips = ctx.finalChips[humanId] ?? 0;
  const place = ctx.places[humanId] ?? null;

  const results = (goals || []).map((goal) => {
    switch (goal.type) {
      case 'winMatch': {
        const ok = terminal && place === 1;
        return { goal, ok, detail: ok ? 'Finished 1st.' : terminal ? `Finished ${place ?? '?'} — 1st required.` : 'Match is not over yet.' };
      }
      case 'finishTop': {
        const ok = terminal && place != null && place <= goal.place;
        return { goal, ok, detail: ok ? `Finished ${place}, top ${goal.place}.` : terminal ? `Finished ${place ?? '?'} — top ${goal.place} required.` : 'Match is not over yet.' };
      }
      case 'chipsAtLeast': {
        const ok = chips >= goal.amount;
        return { goal, ok, detail: `${chips} chips — ${goal.amount} required.` };
      }
      case 'winHands': {
        const n = stats.handsWon || 0;
        const ok = n >= goal.count;
        return { goal, ok, detail: `${n} hands won — ${goal.count} required.` };
      }
      case 'winShowdowns': {
        const n = stats.showdownsWon || 0;
        const ok = n >= goal.count;
        return { goal, ok, detail: `${n} showdowns won — ${goal.count} required.` };
      }
      case 'surviveHands': {
        const alive = chips > 0;
        const ok = handsPlayed >= goal.count && alive;
        return { goal, ok, detail: alive ? `${handsPlayed} hands played — ${goal.count} required.` : 'Busted before the hand count was reached.' };
      }
      default:
        return { goal, ok: false, detail: `Unknown goal type '${goal.type}'.` };
    }
  });
  return { passed: results.length > 0 && results.every((r) => r.ok), results };
}

// ---------------------------------------------------------------------------
// Achievements (unlock logic lives in main.js; `check` names the condition)
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_flow', name: 'First Flow', desc: 'Complete your first journey stage.', check: 'first_completion' },
  { key: 'mechanic_master', name: 'Mechanic Master', desc: 'Complete any journey mastery stage.', check: 'mechanic_mastery' },
  { key: 'steady_current', name: 'Steady Current', desc: 'Play the daily challenge seven days in a row.', check: 'daily_streak' },
  { key: 'estuary_champion', name: 'Estuary Champion', desc: 'Complete the final journey stage, The Estuary Crown.', check: 'difficult_milestone' },
  { key: 'thousand_hands', name: 'A Thousand Hands', desc: 'Play one thousand hands across all modes.', check: 'long_term_total' },
];

// ---------------------------------------------------------------------------
// Structural validation (offline; run in tests and tooling)
// ---------------------------------------------------------------------------

const AI_LEVELS = ['easy', 'normal', 'hard'];

function validateConfig(config, label, errors) {
  if (!config || typeof config !== 'object') { errors.push(`${label}: missing config`); return; }
  if (!Number.isInteger(config.seed) || config.seed < 0) errors.push(`${label}: config.seed must be a uint32`);
  if (!Number.isInteger(config.smallBlind) || config.smallBlind <= 0) errors.push(`${label}: smallBlind must be a positive int`);
  if (!Number.isInteger(config.bigBlind) || config.bigBlind <= config.smallBlind) errors.push(`${label}: bigBlind must exceed smallBlind`);
  if (config.maxHands != null && (!Number.isInteger(config.maxHands) || config.maxHands <= 0)) errors.push(`${label}: maxHands must be a positive int or null`);
  const players = config.players;
  if (!Array.isArray(players) || players.length < 2 || players.length > 6) {
    errors.push(`${label}: config needs 2-6 players`);
    return;
  }
  const ids = new Set();
  let humans = 0;
  for (const p of players) {
    if (!p || typeof p.id !== 'string' || !p.id) { errors.push(`${label}: player missing id`); continue; }
    if (ids.has(p.id)) errors.push(`${label}: duplicate player id '${p.id}'`);
    ids.add(p.id);
    if (!Number.isInteger(p.chips) || p.chips <= 0) errors.push(`${label}: player '${p.id}' chips must be a positive int`);
    if (p.ai == null) humans++;
    else if (!AI_LEVELS.includes(p.ai)) errors.push(`${label}: player '${p.id}' has bad ai level '${p.ai}'`);
  }
  if (humans !== 1) errors.push(`${label}: exactly one human seat (ai:null) expected, found ${humans}`);
}

function validateGoals(goals, label, errors) {
  if (!Array.isArray(goals) || goals.length === 0) { errors.push(`${label}: needs at least one goal`); return; }
  for (const g of goals) {
    if (!g || !GOAL_TYPES.includes(g.type)) { errors.push(`${label}: bad goal type '${g && g.type}'`); continue; }
    if (g.type === 'chipsAtLeast' && (!Number.isInteger(g.amount) || g.amount <= 0)) errors.push(`${label}: chipsAtLeast.amount must be a positive int`);
    if ((g.type === 'winHands' || g.type === 'winShowdowns' || g.type === 'surviveHands') && (!Number.isInteger(g.count) || g.count <= 0)) errors.push(`${label}: ${g.type}.count must be a positive int`);
    if (g.type === 'finishTop' && (!Number.isInteger(g.place) || g.place < 1 || g.place > 6)) errors.push(`${label}: finishTop.place must be 1-6`);
  }
}

/**
 * Structural validation of all content. @returns {{errors: string[]}}
 */
export function validateAll() {
  const errors = [];
  const themeIds = new Set();

  if (THEMES.length !== 5) errors.push(`THEMES must contain exactly 5 entries, found ${THEMES.length}`);
  for (const t of THEMES) {
    if (!t || typeof t.id !== 'string' || !t.id) { errors.push('theme missing id'); continue; }
    if (themeIds.has(t.id)) errors.push(`duplicate theme id '${t.id}'`);
    themeIds.add(t.id);
    const pal = t.palette || {};
    for (const key of ['background', 'felt', 'table', 'accent', 'text', 'cardBack', 'river', 'sky']) {
      if (typeof pal[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(pal[key])) errors.push(`theme '${t.id}': palette.${key} must be a #rrggbb string`);
    }
    const u = t.unlock;
    const unlockOk = u === 'default'
      || (u && Number.isInteger(u.journey) && u.journey > 0)
      || (u && typeof u.achievement === 'string' && u.achievement);
    if (!unlockOk) errors.push(`theme '${t.id}': invalid unlock metadata`);
  }

  const seenIds = new Set();
  const claim = (id, label) => {
    if (typeof id !== 'string' || !id) { errors.push(`${label}: missing id`); return; }
    if (seenIds.has(id)) errors.push(`duplicate content id '${id}'`);
    seenIds.add(id);
  };

  // tutorial
  if (TUTORIAL.length < 6) errors.push(`TUTORIAL needs at least 6 lessons, found ${TUTORIAL.length}`);
  for (const lesson of TUTORIAL) {
    claim(lesson.id, 'tutorial');
    if (typeof lesson.title !== 'string' || !lesson.title) errors.push(`tutorial '${lesson.id}': missing title`);
    if (typeof lesson.body !== 'string' || !lesson.body) errors.push(`tutorial '${lesson.id}': missing body`);
    validateConfig(lesson.config, `tutorial '${lesson.id}'`, errors);
    if (!Array.isArray(lesson.steps) || lesson.steps.length === 0) { errors.push(`tutorial '${lesson.id}': needs steps`); continue; }
    for (const [i, step] of lesson.steps.entries()) {
      const sl = `tutorial '${lesson.id}' step ${i}`;
      if (typeof step.text !== 'string' || !step.text) errors.push(`${sl}: missing text`);
      if (step.requireAction == null && step.requireEvent == null) errors.push(`${sl}: needs requireAction or requireEvent`);
      if (typeof step.hint !== 'function') { errors.push(`${sl}: hint must be a function`); continue; }
      let out;
      try {
        out = step.hint(null, [{ type: 'call', amount: 10 }, { type: 'fold' }, { type: 'raise', amount: 20 }, { type: 'check' }, { type: 'advance' }]);
      } catch (e) {
        errors.push(`${sl}: hint threw: ${(e && e.message) || e}`);
        continue;
      }
      if (typeof out !== 'string' || !out) errors.push(`${sl}: hint must return a non-empty string`);
    }
  }

  // journey
  if (JOURNEY.length < 40) errors.push(`JOURNEY needs at least 40 stages, found ${JOURNEY.length}`);
  for (const [i, stage] of JOURNEY.entries()) {
    const label = `journey '${stage.id}'`;
    claim(stage.id, 'journey');
    const expectedId = `j${String(i + 1).padStart(2, '0')}`;
    if (stage.id !== expectedId) errors.push(`${label}: expected id '${expectedId}' at position ${i}`);
    if (stage.index !== i + 1) errors.push(`${label}: index must be ${i + 1}`);
    if (!Number.isInteger(stage.seed) || stage.seed < 0) errors.push(`${label}: missing seed`);
    if (!themeIds.has(stage.theme)) errors.push(`${label}: unknown theme '${stage.theme}'`);
    const shouldBeMastery = (i + 1) % 5 === 0;
    if (!!stage.mastery !== shouldBeMastery) errors.push(`${label}: mastery cadence broken (expected ${shouldBeMastery})`);
    if (!Number.isInteger(stage.par) || stage.par <= 0) errors.push(`${label}: par must be a positive int`);
    if (stage.unlocksTheme != null && !themeIds.has(stage.unlocksTheme)) errors.push(`${label}: unlocksTheme '${stage.unlocksTheme}' is not a theme`);
    validateConfig(stage.config, label, errors);
    validateGoals(stage.goals, label, errors);
  }

  // challenges
  if (CHALLENGES.length < 6) errors.push(`CHALLENGES needs at least 6 entries, found ${CHALLENGES.length}`);
  for (const ch of CHALLENGES) {
    const label = `challenge '${ch.id}'`;
    claim(ch.id, 'challenge');
    if (!Number.isInteger(ch.seed) || ch.seed < 0) errors.push(`${label}: missing seed`);
    if (!themeIds.has(ch.theme)) errors.push(`${label}: unknown theme '${ch.theme}'`);
    if (!ch.constraint || !CONSTRAINT_TYPES.includes(ch.constraint.type)) errors.push(`${label}: bad constraint type '${ch.constraint && ch.constraint.type}'`);
    validateConfig(ch.config, label, errors);
    validateGoals(ch.goals, label, errors);
  }

  // daily determinism + sanity (fixed reference dates)
  for (const date of ['2026-01-01', '2026-06-15']) {
    const a = dailyForDate(date);
    const b = dailyForDate(date);
    if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`dailyForDate('${date}') is not deterministic`);
    validateConfig(a.config, `daily '${date}'`, errors);
    validateGoals(a.goals, `daily '${date}'`, errors);
    if (!themeIds.has(a.theme)) errors.push(`daily '${date}': unknown theme '${a.theme}'`);
  }

  // achievements
  const achKeys = new Set();
  for (const a of ACHIEVEMENTS) {
    if (!a || typeof a.key !== 'string' || a.key !== a.key.toLowerCase() || !a.key) errors.push(`achievement with bad key '${a && a.key}'`);
    if (achKeys.has(a.key)) errors.push(`duplicate achievement key '${a.key}'`);
    achKeys.add(a.key);
    if (typeof a.check !== 'string' || !a.check) errors.push(`achievement '${a.key}': missing check id`);
  }
  for (const t of THEMES) {
    if (t.unlock && typeof t.unlock === 'object' && t.unlock.achievement && !achKeys.has(t.unlock.achievement)) {
      errors.push(`theme '${t.id}': unlock references unknown achievement '${t.unlock.achievement}'`);
    }
  }

  return { errors };
}
