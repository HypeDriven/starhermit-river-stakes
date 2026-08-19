// River Stakes — DOM UI layer (screens, HUD, modals, accessibility)

/**
 * All user-facing text lives here, grouped by screen/purpose, so the game can
 * be localized later by swapping this object (pass opts.strings to UI).
 * Template placeholders use {name} syntax and are filled by fmt().
 */
export const STRINGS = {
  app: {
    title: 'River Stakes',
    tagline: 'A riverside card salon. Fixed-limit Hold\u2019em, played for pride alone.',
  },
  common: {
    back: 'Back',
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    start: 'Start',
    play: 'Play',
    retry: 'Retry',
    next: 'Next',
    leave: 'Leave',
    save: 'Save',
    on: 'On',
    off: 'Off',
    yes: 'Yes',
    no: 'No',
    loading: 'Loading\u2026',
    you: 'You',
    ranked: 'Ranked',
    unranked: 'Unranked',
    locked: 'Locked',
    available: 'Available',
    completed: 'Completed',
    stars: '{n} of 3 stars',
    mastery: 'Mastery',
  },
  title: {
    heading: 'River Stakes',
    play: 'Play',
    daily: 'Daily challenge',
    journey: 'Journey',
    profile: 'Profile',
    settings: 'Settings',
    help: 'How to play',
    tagline: 'Pull up a chair by the river.',
  },
  modes: {
    heading: 'Choose your table',
    intro: 'Every mode uses fixed-limit betting: bets and raises are set amounts, so the math stays readable.',
    commitNote: 'You can review the setup on the next screen before anything starts.',
    list: {
      learn:     { name: 'Learn', rules: 'Guided lessons that teach one rule at a time and make you perform it.', duration: '5\u201310 min', players: '1 player + tutor', ranked: false },
      journey:   { name: 'Journey', rules: 'Authored stages up the river. Goals, par scores and mastery stages.', duration: '10\u201320 min', players: '2\u20136 seats vs AI', ranked: false },
      daily:     { name: 'Daily', rules: 'One shared seed per UTC day. Same cards for everyone.', duration: '~10 min', players: '1 player vs AI', ranked: true },
      practice:  { name: 'Practice', rules: 'Pick difficulty, seats and assists. Undo allowed. Nothing at stake.', duration: '5\u201315 min', players: '2\u20136 seats vs AI', ranked: false },
      challenge: { name: 'Challenge', rules: 'Constrained variants: short stacks, hand limits, speed targets.', duration: '5\u201315 min', players: '2\u20136 seats vs AI', ranked: true },
      hosted:    { name: 'Hosted table', rules: 'Private room with a code. Friends take seats; the server deals.', duration: '15\u201340 min', players: '2\u20136 players', ranked: false },
    },
  },
  setup: {
    heading: 'Set up: {mode}',
    rulesSummary: 'Fixed-limit Texas Hold\u2019em. Bets are the big blind before the turn, double after. Maximum one bet and three raises per round.',
    difficulty: 'Difficulty',
    difficultyEasy: 'Gentle',
    difficultyNormal: 'Regular',
    difficultyHard: 'Sharp',
    players: 'Seats at the table',
    playersOption: '{n} seats',
    assists: 'Assists',
    assistHints: 'Hints available',
    assistUndo: 'Undo allowed',
    blinds: 'Blinds',
    rankedNote: 'This result is ranked.',
    unrankedNote: 'This result is not ranked.',
    commit: 'Take your seat',
    hostedCreateTitle: 'Create a table',
    hostedCreateNote: 'You host. Empty seats are filled by house AI until friends join.',
    hostedCreate: 'Create room',
    hostedJoinTitle: 'Join a table',
    hostedJoinNote: 'Enter the 5-character room code your host shared.',
    hostedCodeLabel: 'Room code',
    hostedJoin: 'Join room',
    lessons: 'Lessons',
    lessonStart: 'Start lesson',
  },
  game: {
    objective: 'Objective',
    progress: 'Progress',
    tableStatus: 'Table status',
    hand: 'Hand {n}',
    phase: 'Street: {phase}',
    pot: 'Pot',
    currentBet: 'Current bet',
    toCall: 'To call',
    feedTitle: 'Action',
    yourTurn: 'Your turn',
    waiting: 'Waiting for {name}',
    actions: 'Actions',
    fold: 'Fold',
    check: 'Check',
    call: 'Call {amount}',
    bet: 'Bet {amount}',
    raise: 'Raise to {amount}',
    allin: 'All in ({amount})',
    advanceDeal: 'Deal',
    advanceNext: 'Next hand',
    advanceContinue: 'Continue',
    raiseAmount: 'Raise amount',
    undo: 'Undo',
    hint: 'Hint',
    hintGotIt: 'Got it',
    pause: 'Pause',
    chat: 'Chat',
    openDrawerLeft: 'Objective',
    openDrawerRight: 'Table info',
    seatDealer: 'Dealer',
    seatFolded: 'Folded',
    seatAllIn: 'All in',
    seatOut: 'Out',
    seatActing: 'Acting',
    seatLastAction: '{name}: {action}',
    shortcutsTitle: 'Shortcuts',
    shortcutsDismiss: 'Hide shortcuts',
    communityLabel: 'Community cards',
    yourCards: 'Your cards',
    hiddenCards: 'Face-down cards',
  },
  results: {
    heading: 'Hand results',
    breakdown: 'Breakdown',
    progressTitle: 'Progress',
    achievementsTitle: 'Achievements unlocked',
    comparison: 'Comparison',
    recommendation: 'Recommended next',
    backToTitle: 'Back to title',
    starsEarned: 'Stars earned: {n}',
    goalsPassed: '{passed} of {total} goals passed',
  },
  journey: {
    heading: 'Journey upriver',
    intro: 'Complete stages to open the next reach of the river. Every fifth stage is a mastery test.',
    stagePar: 'Par {n} hands',
    stageMastery: 'Mastery stage',
    stageLocked: 'Locked \u2014 finish earlier stages first',
    stageTeaches: 'Teaches: {topic}',
    starsLabel: '{n} stars',
  },
  challenges: {
    heading: 'Challenges',
    intro: 'Constrained tables with their own goals and leaderboard entries.',
    constraint: 'Constraint: {text}',
    completedBadge: 'Cleared',
    par: 'Par {n}',
  },
  achievements: {
    heading: 'Achievements',
    intro: 'Milestones from your time at the tables.',
    unlockedOn: 'Unlocked {date}',
    lockedYet: 'Not yet unlocked',
  },
  settings: {
    heading: 'Settings',
    audio: 'Audio',
    master: 'Master volume',
    music: 'Music volume',
    effects: 'Effects volume',
    ambience: 'Ambience volume',
    voice: 'Voice volume',
    muted: 'Mute all audio',
    graphics: 'Graphics',
    tier: 'Quality tier',
    tierLow: 'Low',
    tierMedium: 'Medium',
    tierHigh: 'High',
    accessibility: 'Accessibility',
    reducedMotion: 'Reduced motion',
    highContrast: 'High contrast',
    palette: 'Color palette',
    paletteDefault: 'Default',
    paletteDeuteranopia: 'Deuteranopia-safe',
    paletteTritanopia: 'Tritanopia-safe',
    textSize: 'Text size',
    textNormal: 'Normal',
    textLarge: 'Large',
    textXl: 'Extra large',
    leftHanded: 'Left-handed action tray',
    hintMode: 'Hint button behavior',
    hintToggle: 'Tap to toggle',
    hintHold: 'Hold to peek',
    haptics: 'Haptic feedback',
    tutorialReplay: 'Replay tutorial',
    tutorialReplayNote: 'Start the first lesson again from the beginning.',
    saved: 'Settings saved.',
  },
  help: {
    heading: 'How to play',
    blindsTitle: 'Blinds',
    blindsBody: 'Each hand, the two players left of the dealer post forced bets: the small blind and the big blind. This seeds the pot so every hand matters. Heads-up, the dealer posts the small blind and acts first before the flop.',
    bettingTitle: 'Fixed-limit betting',
    bettingBody: 'Before the turn, bets and raises are exactly one big blind. On the turn and river they are two big blinds. A round allows at most one bet plus three raises. Going all in for less than a full bet is always allowed and does not count against the raise cap.',
    rankingsTitle: 'Hand rankings',
    rankingsIntro: 'Make the best five-card hand from your two cards and the five community cards. From strongest to weakest:',
    controlsTitle: 'Controls',
    controlsIntro: 'Every action is a button on screen; the keys below are shortcuts.',
    handNames: ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'],
    handExamples: [
      ['Ah', 'Kd', '7c', '5s', '2h'],
      ['9h', '9d', 'Kc', '5s', '2h'],
      ['9h', '9d', 'Kc', 'Ks', '2h'],
      ['9h', '9d', '9c', 'Ks', '2h'],
      ['9h', '8d', '7c', '6s', '5h'],
      ['Ah', 'Kh', '7h', '5h', '2h'],
      ['9h', '9d', '9c', 'Ks', 'Kh'],
      ['9h', '9d', '9c', '9s', '2h'],
      ['9h', '8h', '7h', '6h', '5h'],
    ],
  },
  profile: {
    heading: 'Profile',
    nameLabel: 'Display name',
    nameSave: 'Save name',
    statsTitle: 'Lifetime at the tables',
    statLabels: {
      handsPlayed: 'Hands played',
      handsWon: 'Hands won',
      showdownsWon: 'Showdowns won',
      potsWon: 'Chips won',
      bestHand: 'Best hand',
      journeysCleared: 'Journey stages cleared',
      dailiesPlayed: 'Dailies played',
      achievements: 'Achievements',
    },
    empty: 'No stats yet \u2014 play a few hands first.',
  },
  lobby: {
    heading: 'Hosted table',
    roomCode: 'Room code',
    codeNote: 'Share this code with friends so they can take a seat.',
    roster: 'Roster',
    ready: 'Ready',
    notReady: 'Not ready',
    hostBadge: 'Host',
    away: 'Away',
    youBadge: 'You',
    imReady: 'I\u2019m ready',
    notReadyYet: 'Not ready yet',
    startGame: 'Start the game',
    startWaiting: 'Waiting for players\u2026',
    leaveRoom: 'Leave room',
    waitingHost: 'The host starts the game when everyone is ready.',
  },
  daily: {
    heading: 'Daily challenge',
    dateLine: 'Table for {date}',
    seedLine: 'Seed {seed} \u2014 identical cards for every player today.',
    par: 'Par: {n} hands',
    goals: 'Today\u2019s goals',
    play: 'Play today\u2019s table',
    rankedNote: 'Daily results are ranked against everyone who plays this seed.',
  },
  chat: {
    title: 'Chat',
    open: 'Open chat',
    close: 'Close chat',
    unread: '{n} unread',
    placeholder: 'Message the table\u2026',
    send: 'Send',
    counter: '{n}/240',
    rateNote: 'Up to 10 messages per minute.',
    rateLimited: 'Slow down \u2014 the table allows 10 messages per minute.',
    empty: 'No messages yet. Say hello.',
  },
  modals: {
    pauseTitle: 'Paused',
    resume: 'Resume',
    pauseSettings: 'Settings',
    pauseHelp: 'How to play',
    pauseLeave: 'Leave table',
    confirmLeaveTitle: 'Leave the table?',
    confirmLeaveBody: 'Your seat and current hand progress will be forfeited.',
    confirmLeaveConfirm: 'Leave table',
    confirmLeaveStay: 'Stay',
  },
  events: {
    handStart: 'Hand {n} begins \u2014 {dealer} has the button.',
    postSb: '{name} posts the small blind, {amount}.',
    postBb: '{name} posts the big blind, {amount}.',
    deal: 'Cards are dealt.',
    fold: '{name} folds.',
    check: '{name} checks.',
    call: '{name} calls {amount}.',
    bet: '{name} bets {amount}.',
    raise: '{name} raises to {amount}.',
    allin: '{name} is all in for {amount}.',
    advance: '{name} moves the hand along.',
    streetFlop: 'Flop: {cards}',
    streetTurn: 'Turn: {cards}',
    streetRiver: 'River: {cards}',
    street: '{phase}: {cards}',
    showdown: '{name} shows {hand}.',
    award: '{name} wins {amount} with {hand}.',
    awardSplit: '{name} collects {amount}.',
    eliminated: '{name} is eliminated.',
    handEnd: 'Hand {n} is complete.',
    terminal: '{name} wins the table!',
    youWin: 'You win {amount} with {hand}.',
  },
  cards: {
    suits: ['Spades', 'Hearts', 'Diamonds', 'Clubs'],
    suitSymbols: ['\u2660', '\u2665', '\u2666', '\u2663'],
    ranks: { '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' },
    cardBack: 'Card face down',
  },
  a11y: {
    screenChanged: '{screen} screen',
    actionTaken: '{action} sent.',
    invalidAction: 'That action is not available right now.',
    hintShown: 'Hint: {text}',
  },
};

/** Keyboard bindings — the help screen control list is generated from this. */
const KEY_BINDINGS = [
  { key: 'f',        label: 'F',     desc: 'Fold',                 action: 'fold' },
  { key: 'c',        label: 'C',     desc: 'Check / call (whichever is legal)', action: 'checkOrCall' },
  { key: 'x',        label: 'X',     desc: 'Check / call (alternate)',          action: 'checkOrCall' },
  { key: 'b',        label: 'B',     desc: 'Bet / raise',          action: 'betOrRaise' },
  { key: 'r',        label: 'R',     desc: 'Bet / raise (alternate)', action: 'betOrRaise' },
  { key: 'a',        label: 'A',     desc: 'All in',               action: 'allin' },
  { key: 'Enter',    label: 'Enter', desc: 'Confirm the focused button', action: 'confirm' },
  { key: 'Escape',   label: 'Esc',   desc: 'Pause / close panel',  action: 'pause' },
  { key: 'u',        label: 'U',     desc: 'Undo (when allowed)',  action: 'undo' },
  { key: 'h',        label: 'H',     desc: 'Hint',                 action: 'hint' },
  { key: 'ArrowLeft',  label: '\u2190/\u2192', desc: 'Move between action buttons', action: 'navigate' },
  { key: 'ArrowRight', label: '',    desc: '',                     action: 'navigate', hidden: true },
];

/** Static per-mode metadata for the mode-select screen. */
const MODE_ORDER = ['learn', 'journey', 'daily', 'practice', 'challenge', 'hosted'];

const SUIT_CLASS = ['suit-s', 'suit-h', 'suit-d', 'suit-c'];
const RED_SUITS = new Set([1, 2]); // hearts, diamonds

const FEED_MAX = 6;
const CHAT_MAX_LEN = 240;
const CHAT_RATE = 10;          // messages
const CHAT_RATE_WINDOW = 60000; // per minute

/* ------------------------------------------------------------------ helpers */

/** Fill {placeholders} in a template string. */
function fmt(tpl, vars) {
  if (!vars) return tpl;
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Tiny element builder: el('button', {class:'x', onclick:fn}, 'Label') */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'aria') for (const [ak, av] of Object.entries(v)) node.setAttribute('aria-' + ak, av);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const chipFmt = new Intl.NumberFormat('en-US');
function fmtChips(n) { return chipFmt.format(Math.round(Number(n) || 0)); }

/** Card int -> {rank char label, suit index}. Rank 14 = Ace (see js/rules/cards.js). */
function cardParts(c) {
  const rank = 2 + (c % 13);
  const suit = (c / 13) | 0;
  const chars = '23456789TJQKA';
  const ch = chars[rank - 2];
  return { rankLabel: ch === 'T' ? '10' : ch, suit };
}

/** Parse 'Ah' / 'Td' style strings into card ints (for help-screen examples). */
function cardFromText(s) {
  const chars = '23456789TJQKA';
  const r = chars.indexOf(s[0].toUpperCase());
  const su = 'shdc'.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) return null;
  return su * 13 + r;
}

function isInteractiveTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/* -------------------------------------------------------------- UI class */

export class UI {
  /**
   * @param {HTMLElement} root  the #ui container
   * @param {object} controller  main.js callbacks (see docs/contracts.md)
   * @param {object} [opts]  { strings?: partial STRINGS override }
   */
  constructor(root, controller, opts = {}) {
    this.root = root;
    this.c = controller || {};
    this.s = mergeDeep(structuredClone(STRINGS), opts.strings || {});
    this.screen = null;
    this.cache = {};              // last data per screen, for re-entry
    this.settings = defaultSettings();
    this.modals = [];             // open modal stack [{wrap, prevFocus}]
    this.playerNames = new Map(); // playerId -> display name
    this.youId = null;
    this.g = null;                // game HUD refs, built lazily by updateGame
    this.feed = [];               // action feed strings (unbounded store, render last FEED_MAX)
    this.logSeen = 0;             // snapshot.log lines already folded into feed
    this.legalSig = '';           // signature of rendered legal actions
    this.raiseAmount = null;      // current stepper value (total round bet)
    this.actionPending = false;   // double-commit guard, cleared by updateGame
    this.hintVisible = false;
    this.chat = { open: false, unread: 0, sentAt: [], messages: [] };
    this.lastAnnounce = { turn: '', objective: '' };

    this.livePolite = document.getElementById('live-polite') || el('div', { class: 'visually-hidden' });
    this.liveAssertive = document.getElementById('live-assertive') || el('div', { class: 'visually-hidden' });
    if (!this.livePolite.parentNode) document.body.append(this.livePolite, this.liveAssertive);

    // Respect the OS-level reduced-motion preference until settings say otherwise.
    try {
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.settings.accessibility.reducedMotion = true;
      }
    } catch { /* no matchMedia — keep defaults */ }

    this.applySettings(this.settings);
    document.addEventListener('keydown', (e) => this._onKeydown(e));
    this.root.classList.add('ui-root');
  }

  /** Call a controller method if main.js implemented it. */
  _call(name, ...args) {
    const fn = this.c[name];
    if (typeof fn === 'function') return fn.apply(this.c, args);
    return undefined;
  }

  /* ------------------------------------------------------------ screens */

  /**
   * Switch the visible screen.
   * @param {string} name one of: title modes setup game results journey
   *   challenges achievements settings help profile lobby daily
   * @param {*} [data] screen-specific payload (cached for re-entry)
   */
  showScreen(name, data) {
    if (data !== undefined) this.cache[name] = data;
    else if (this.cache[name] !== undefined) data = this.cache[name];
    const builder = this['_screen_' + name];
    this.screen = name;
    this.g = null;
    this.legalSig = '';
    this.actionPending = false;
    this.root.textContent = '';
    const node = builder ? builder.call(this, data) : el('section', { class: 'screen' },
      el('h1', { text: this.s.app.title }), el('p', { text: this.s.common.loading }));
    node.classList.add('screen', 'screen-' + name);
    this.root.append(node);
    this.announce(fmt(this.s.a11y.screenChanged, { screen: name }));
    const focusTarget = node.querySelector('[data-autofocus]') || node.querySelector('h1[tabindex]') || node.querySelector('h1');
    if (focusTarget) {
      if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }
  }

  _backBar(label, target) {
    return el('div', { class: 'screen-bar' },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.showScreen(target) },
        '\u2039 ' + (label || this.s.common.back)));
  }

  _screen_title() {
    const s = this.s;
    return el('section', { class: 'screen-title' },
      el('div', { class: 'title-card' },
        el('p', { class: 'title-kicker', text: s.title.tagline }),
        el('h1', { class: 'title-logo', text: s.title.heading }),
        el('p', { class: 'title-tag', text: s.app.tagline }),
        el('button', {
          class: 'btn btn-primary btn-xl', type: 'button', 'data-autofocus': '',
          onclick: () => this.showScreen('modes'),
        }, s.title.play),
        el('div', { class: 'title-secondary' },
          el('button', { class: 'btn', type: 'button', onclick: () => this.showScreen('daily') }, s.title.daily),
          el('button', { class: 'btn', type: 'button', onclick: () => this.showScreen('journey') }, s.title.journey),
          el('button', { class: 'btn', type: 'button', onclick: () => this.showScreen('profile') }, s.title.profile)),
        el('div', { class: 'title-tertiary' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.showScreen('settings') }, s.title.settings),
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.showScreen('help') }, s.title.help))));
  }

  _screen_modes() {
    const s = this.s;
    const grid = el('div', { class: 'mode-grid', role: 'list' });
    for (const id of MODE_ORDER) {
      const meta = s.modes.list[id];
      if (!meta) continue;
      grid.append(el('div', { class: 'mode-card', role: 'listitem' },
        el('h3', { text: meta.name }),
        el('p', { class: 'mode-rules', text: meta.rules }),
        el('ul', { class: 'mode-meta' },
          el('li', { text: '\u23F1 ' + meta.duration }),
          el('li', { text: '\u2694 ' + meta.players }),
          el('li', { class: 'badge ' + (meta.ranked ? 'badge-ranked' : 'badge-unranked'), text: meta.ranked ? s.common.ranked : s.common.unranked })),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => this.showScreen('setup', { mode: id }),
        }, s.common.play)));
    }
    return el('section', {},
      this._backBar(s.common.back, 'title'),
      el('h1', { text: s.modes.heading, 'data-autofocus': '' }),
      el('p', { class: 'screen-intro', text: s.modes.intro }),
      grid);
  }

  _screen_setup(data) {
    const s = this.s;
    const mode = (data && data.mode) || 'practice';
    const meta = s.modes.list[mode] || { name: mode, ranked: false };
    const form = el('div', { class: 'setup-form' });
    const opts = { mode, difficulty: 'normal', players: 4, hints: true, undo: mode === 'practice', blinds: { sb: 5, bb: 10 } };

    const commit = () => this._call('play', mode, structuredClone(opts));

    if (mode === 'hosted') {
      const code = el('input', {
        class: 'input input-code', type: 'text', maxlength: '5', autocomplete: 'off',
        'aria-label': s.setup.hostedCodeLabel, placeholder: 'RIVER',
      });
      form.append(
        el('section', { class: 'panel' },
          el('h2', { text: s.setup.hostedCreateTitle }),
          el('p', { text: s.setup.hostedCreateNote }),
          el('label', { class: 'field' }, el('span', { text: s.setup.players }),
            selectEl('hosted-seats', [2, 3, 4, 5, 6].map(n => [n, fmt(s.setup.playersOption, { n })]),
              (v) => { opts.players = Number(v); }, String(opts.players))),
          el('button', {
            class: 'btn btn-primary', type: 'button', 'data-autofocus': '',
            onclick: () => this._call('hostedCreate', structuredClone(opts)),
          }, s.setup.hostedCreate)),
        el('section', { class: 'panel' },
          el('h2', { text: s.setup.hostedJoinTitle }),
          el('p', { text: s.setup.hostedJoinNote }),
          el('div', { class: 'field-row' }, code,
            el('button', {
              class: 'btn btn-primary', type: 'button',
              onclick: () => { if (code.value.trim()) this._call('hostedJoin', code.value.trim().toUpperCase()); },
            }, s.setup.hostedJoin))));
    } else if (mode === 'learn') {
      const lessons = (data && data.lessons) || this._call('listLessons') || [];
      form.append(el('section', { class: 'panel' },
        el('h2', { text: s.setup.lessons }),
        lessons.length
          ? el('ol', { class: 'lesson-list' }, lessons.map((l, i) => el('li', {},
              el('button', {
                class: 'btn btn-wide', type: 'button', 'data-autofocus': i === 0 ? '' : null,
                onclick: () => this._call('play', 'learn', { lesson: l.id != null ? l.id : i }),
              }, l.title || ('Lesson ' + (i + 1))))))
          : el('button', {
              class: 'btn btn-primary', type: 'button', 'data-autofocus': '',
              onclick: commit,
            }, s.setup.lessonStart)));
    } else {
      // practice / journey / daily / challenge share the option sheet;
      // journey/daily/challenge configs are fixed by content, so only assists apply.
      const fixed = mode !== 'practice';
      const diffSel = selectEl('setup-difficulty',
        [['easy', s.setup.difficultyEasy], ['normal', s.setup.difficultyNormal], ['hard', s.setup.difficultyHard]],
        (v) => { opts.difficulty = v; }, opts.difficulty);
      const seatSel = selectEl('setup-seats',
        [2, 3, 4, 5, 6].map(n => [n, fmt(s.setup.playersOption, { n })]),
        (v) => { opts.players = Number(v); }, String(opts.players));
      if (fixed) { diffSel.disabled = true; seatSel.disabled = true; }
      const hintChk = checkboxEl('setup-hints', s.setup.assistHints, opts.hints, (v) => { opts.hints = v; });
      const undoChk = checkboxEl('setup-undo', s.setup.assistUndo, opts.undo, (v) => { opts.undo = v; });
      form.append(el('section', { class: 'panel' },
        el('h2', { text: fmt(s.setup.heading, { mode: meta.name }) }),
        el('p', { text: s.setup.rulesSummary }),
        el('p', { class: 'badge ' + (meta.ranked ? 'badge-ranked' : 'badge-unranked'), text: meta.ranked ? s.setup.rankedNote : s.setup.unrankedNote }),
        el('label', { class: 'field' }, el('span', { text: s.setup.difficulty }), diffSel),
        el('label', { class: 'field' }, el('span', { text: s.setup.players }), seatSel),
        el('fieldset', { class: 'field-group' }, el('legend', { text: s.setup.assists }), hintChk, undoChk),
        el('button', { class: 'btn btn-primary btn-xl', type: 'button', 'data-autofocus': '', onclick: commit }, s.setup.commit)));
    }

    return el('section', {},
      this._backBar(s.common.back, 'modes'),
      el('h1', { text: fmt(s.setup.heading, { mode: meta.name }) }),
      form);
  }

  _screen_daily(data) {
    const s = this.s;
    const d = data || {};
    const goals = (d.goals || []).map((g) => el('li', { text: goalText(g) }));
    return el('section', {},
      this._backBar(s.common.back, 'title'),
      el('h1', { text: s.daily.heading, 'data-autofocus': '' }),
      el('div', { class: 'panel daily-card' },
        el('p', { class: 'daily-date', text: fmt(s.daily.dateLine, { date: d.date || s.common.loading }) }),
        d.seed != null ? el('p', { class: 'daily-seed', text: fmt(s.daily.seedLine, { seed: d.seed }) }) : null,
        d.par != null ? el('p', { text: fmt(s.daily.par, { n: d.par }) }) : null,
        goals.length ? el('div', {}, el('h2', { text: s.daily.goals }), el('ul', {}, goals)) : null,
        el('p', { class: 'badge badge-ranked', text: s.daily.rankedNote }),
        el('button', {
          class: 'btn btn-primary btn-xl', type: 'button',
          onclick: () => this._call('selectDaily'),
        }, s.daily.play)));
  }

  _screen_journey(data) {
    const s = this.s;
    const d = data || {};
    const stages = d.stages || [];
    const progress = d.progress || {};
    const starsBy = progress.stars || progress.starsByStage || {};
    const grid = el('div', { class: 'journey-grid', role: 'list' });
    if (!stages.length) {
      grid.append(el('p', { class: 'muted', text: s.common.loading }));
    }
    stages.forEach((st, i) => {
      const stars = starsBy[st.id] || 0;
      const prevId = stages[i - 1] && stages[i - 1].id;
      const unlocked = i === 0 || (starsBy[prevId] || 0) > 0 || (progress.unlocked != null && i <= progress.unlocked);
      const state = stars > 0 ? 'completed' : unlocked ? 'available' : 'locked';
      const starStr = '\u2605'.repeat(stars) + '\u2606'.repeat(Math.max(0, 3 - stars));
      const node = el('button', {
        class: 'journey-node is-' + state + (st.mastery ? ' is-mastery' : ''),
        type: 'button', role: 'listitem', disabled: state === 'locked',
        aria: { label: `${st.title || st.id} — ${s.common[state]}, ${fmt(s.journey.starsLabel, { n: stars })}` },
        onclick: () => { if (state !== 'locked') this._call('selectJourney', st.id); },
      },
        el('span', { class: 'journey-idx', text: String(st.index != null ? st.index : i + 1) }),
        el('span', { class: 'journey-name', text: st.title || st.id }),
        el('span', { class: 'journey-stars', 'aria-hidden': 'true', text: starStr }),
        st.mastery ? el('span', { class: 'badge badge-mastery', text: s.common.mastery }) : null,
        state === 'locked' ? el('span', { class: 'journey-lock', text: '\u26BF ' + s.common.locked }) : null);
      grid.append(node);
    });
    return el('section', {},
      this._backBar(s.common.back, 'title'),
      el('h1', { text: s.journey.heading, 'data-autofocus': '' }),
      el('p', { class: 'screen-intro', text: s.journey.intro }),
      grid);
  }

  _screen_challenges(data) {
    const s = this.s;
    const d = data || {};
    const list = d.challenges || [];
    const done = d.completed || {};
    const wrap = el('div', { class: 'card-list', role: 'list' });
    if (!list.length) wrap.append(el('p', { class: 'muted', text: s.common.loading }));
    for (const ch of list) {
      wrap.append(el('article', { class: 'list-card', role: 'listitem' },
        el('h3', { text: ch.title || ch.id }),
        el('p', { text: ch.desc || '' }),
        ch.constraint ? el('p', { class: 'badge', text: fmt(s.challenges.constraint, { text: constraintText(ch.constraint) }) }) : null,
        ch.par != null ? el('p', { class: 'muted', text: fmt(s.challenges.par, { n: ch.par }) }) : null,
        done[ch.id] ? el('p', { class: 'badge badge-ok', text: '\u2713 ' + s.challenges.completedBadge }) : null,
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => this._call('selectChallenge', ch.id),
        }, s.common.play)));
    }
    return el('section', {},
      this._backBar(s.common.back, 'modes'),
      el('h1', { text: s.challenges.heading, 'data-autofocus': '' }),
      el('p', { class: 'screen-intro', text: s.challenges.intro }),
      wrap);
  }

  _screen_achievements(data) {
    const s = this.s;
    const d = Array.isArray(data) ? { list: data } : (data || {});
    const list = d.list || d.achievements || [];
    const unlocked = d.unlocked || {};
    const wrap = el('div', { class: 'card-list', role: 'list' });
    if (!list.length) wrap.append(el('p', { class: 'muted', text: s.common.loading }));
    for (const a of list) {
      const ts = unlocked[a.key];
      wrap.append(el('article', { class: 'list-card' + (ts ? ' is-unlocked' : ''), role: 'listitem' },
        el('h3', { text: (ts ? '\u2605 ' : '\u2606 ') + (a.name || a.key) }),
        el('p', { text: a.desc || '' }),
        el('p', { class: 'muted', text: ts ? fmt(s.achievements.unlockedOn, { date: new Date(ts).toLocaleDateString() }) : s.achievements.lockedYet })));
    }
    return el('section', {},
      this._backBar(s.common.back, 'profile'),
      el('h1', { text: s.achievements.heading, 'data-autofocus': '' }),
      el('p', { class: 'screen-intro', text: s.achievements.intro }),
      wrap);
  }

  _screen_profile(data) {
    const s = this.s;
    const d = data || {};
    const input = el('input', {
      class: 'input', type: 'text', maxlength: '24', value: d.name || '',
      'aria-label': s.profile.nameLabel,
    });
    const statsRows = [];
    const stats = d.stats || {};
    for (const [key, label] of Object.entries(s.profile.statLabels)) {
      if (stats[key] == null) continue;
      statsRows.push(el('tr', {}, el('th', { scope: 'row', text: label }), el('td', { text: String(stats[key]) })));
    }
    return el('section', {},
      this._backBar(s.common.back, 'title'),
      el('h1', { text: s.profile.heading, 'data-autofocus': '' }),
      el('section', { class: 'panel' },
        el('label', { class: 'field' }, el('span', { text: s.profile.nameLabel }), input),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => this._call('profileSave', { name: input.value.trim() }),
        }, s.profile.nameSave)),
      el('section', { class: 'panel' },
        el('h2', { text: s.profile.statsTitle }),
        statsRows.length
          ? el('table', { class: 'stats-table' }, el('tbody', {}, statsRows))
          : el('p', { class: 'muted', text: s.profile.empty })),
      el('section', { class: 'panel' },
        el('button', { class: 'btn', type: 'button', onclick: () => this.showScreen('achievements') }, s.achievements.heading)));
  }

  _screen_lobby(data) {
    const s = this.s;
    this.lobbyRefs = {};
    const refs = this.lobbyRefs;
    refs.code = el('code', { class: 'room-code', text: (data && data.code) || '-----' });
    refs.roster = el('ul', { class: 'roster', role: 'list' });
    refs.start = el('button', {
      class: 'btn btn-primary btn-xl', type: 'button',
      onclick: () => this._call('hostedReady', true),
    }, s.lobby.startGame);
    refs.readyBtn = el('button', {
      class: 'btn', type: 'button',
      onclick: () => this._call('hostedReady', !(this._lobbyData && this._lobbyData.youReady)),
    }, s.lobby.imReady);
    refs.note = el('p', { class: 'muted' });
    const chatPanel = this._buildChatPanel();
    refs.chat = chatPanel;
    const screen = el('section', {},
      this._backBar(s.lobby.leaveRoom, 'modes'),
      el('h1', { text: s.lobby.heading, 'data-autofocus': '' }),
      el('section', { class: 'panel' },
        el('h2', { text: s.lobby.roomCode }),
        el('p', { class: 'room-code-row' }, refs.code),
        el('p', { class: 'muted', text: s.lobby.codeNote })),
      el('section', { class: 'panel' },
        el('h2', { text: s.lobby.roster }), refs.roster,
        el('div', { class: 'field-row' }, refs.readyBtn, refs.start),
        refs.note),
      chatPanel,
      el('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => this._confirmLeave(() => this._call('hostedLeave')),
      }, s.lobby.leaveRoom));
    if (data) this.lobbyUpdate(data);
    return screen;
  }

  /** Hosted lobby/roster/readiness/chat update from main.js. */
  lobbyUpdate(lobby) {
    if (!lobby) return;
    this._lobbyData = lobby;
    if (Array.isArray(lobby.chat)) this._chatMerge(lobby.chat);
    const refs = this.lobbyRefs;
    if (!refs || this.screen !== 'lobby') return;
    const s = this.s;
    if (lobby.code) refs.code.textContent = lobby.code;
    refs.roster.textContent = '';
    for (const p of lobby.players || []) {
      const isYou = lobby.youId != null && p.id === lobby.youId;
      const badges = [];
      if (p.isHost || p.host) badges.push(el('span', { class: 'badge', text: s.lobby.hostBadge }));
      if (isYou) badges.push(el('span', { class: 'badge', text: s.lobby.youBadge }));
      if (p.away) badges.push(el('span', { class: 'badge badge-warn', text: s.lobby.away }));
      refs.roster.append(el('li', { class: 'roster-row' },
        el('span', {
          class: 'ready-dot ' + (p.ready ? 'is-ready' : 'is-not'), 'aria-hidden': 'true', text: p.ready ? '\u25CF' : '\u25CB',
        }),
        el('span', { class: 'roster-name', text: p.name || p.id }),
        el('span', { class: 'badge ' + (p.ready ? 'badge-ok' : ''), text: p.ready ? s.lobby.ready : s.lobby.notReady }),
        badges));
    }
    const youReady = !!lobby.youReady;
    refs.readyBtn.textContent = youReady ? s.lobby.notReadyYet : s.lobby.imReady;
    refs.readyBtn.onclick = () => this._call('hostedReady', !youReady);
    const canStart = !!lobby.isHost && !!lobby.canStart;
    refs.start.disabled = !lobby.isHost || !canStart;
    refs.start.textContent = lobby.isHost ? s.lobby.startGame : s.lobby.waitingHost;
    refs.note.textContent = lobby.isHost
      ? (canStart ? '' : s.lobby.startWaiting)
      : s.lobby.waitingHost;
  }

  _screen_help(data, inModal = false) {
    const s = this.s;
    const rankingCards = s.help.handNames.map((name, i) => {
      const example = (s.help.handExamples[i] || []).map(cardFromText).filter(c => c != null);
      return el('li', { class: 'rank-row' },
        el('span', { class: 'rank-name', text: `${i + 1}. ${name}` }),
        el('span', { class: 'rank-cards' }, example.map(c => this._cardEl(c))));
    });
    const controlRows = KEY_BINDINGS.filter(b => !b.hidden).map(b =>
      el('tr', {}, el('th', { scope: 'row' }, el('kbd', { text: b.label })), el('td', { text: b.desc })));
    return el('section', {},
      inModal ? null : this._backBar(s.common.back, 'title'),
      el('h1', { text: s.help.heading, 'data-autofocus': inModal ? null : '' }),
      el('div', { class: 'rule-cards' },
        el('article', { class: 'panel rule-card' }, el('h2', { text: s.help.blindsTitle }), el('p', { text: s.help.blindsBody })),
        el('article', { class: 'panel rule-card' }, el('h2', { text: s.help.bettingTitle }), el('p', { text: s.help.bettingBody })),
        el('article', { class: 'panel rule-card' },
          el('h2', { text: s.help.rankingsTitle }),
          el('p', { text: s.help.rankingsIntro }),
          el('ol', { class: 'rank-list' }, rankingCards)),
        el('article', { class: 'panel rule-card' },
          el('h2', { text: s.help.controlsTitle }),
          el('p', { text: s.help.controlsIntro }),
          el('table', { class: 'stats-table controls-table' }, el('tbody', {}, controlRows)))));
  }

  _screen_settings() {
    return el('section', {},
      this._backBar(this.s.common.back, 'title'),
      el('h1', { text: this.s.settings.heading, 'data-autofocus': '' }),
      this._buildSettingsPanel());
  }

  /** Settings controls; every change saves live via controller.saveSettings(patch). */
  _buildSettingsPanel() {
    const s = this.s;
    const st = this.settings;
    const save = (patch) => {
      mergeDeep(st, patch);
      this.applySettings(st);
      this._call('saveSettings', patch);
    };
    const slider = (label, value, onInput, id) => {
      const input = el('input', {
        type: 'range', min: '0', max: '100', step: '1', value: String(Math.round((value ?? 1) * 100)),
        id, 'aria-label': label,
      });
      const out = el('output', { class: 'slider-value', text: input.value });
      input.addEventListener('input', () => { out.textContent = input.value; onInput(Number(input.value) / 100); });
      return el('label', { class: 'field field-slider' }, el('span', { text: label }), input, out);
    };
    return el('div', { class: 'settings-panels' },
      el('section', { class: 'panel' },
        el('h2', { text: s.settings.audio }),
        slider(s.settings.master, st.audio.master, v => save({ audio: { master: v } }), 'set-master'),
        slider(s.settings.music, st.audio.music, v => save({ audio: { music: v } }), 'set-music'),
        slider(s.settings.effects, st.audio.effects, v => save({ audio: { effects: v } }), 'set-effects'),
        slider(s.settings.ambience, st.audio.ambience, v => save({ audio: { ambience: v } }), 'set-ambience'),
        slider(s.settings.voice, st.audio.voice, v => save({ audio: { voice: v } }), 'set-voice'),
        checkboxEl('set-muted', s.settings.muted, st.audio.muted, v => save({ audio: { muted: v } }))),
      el('section', { class: 'panel' },
        el('h2', { text: s.settings.graphics }),
        el('label', { class: 'field' }, el('span', { text: s.settings.tier }),
          selectEl('set-tier',
            [['low', s.settings.tierLow], ['medium', s.settings.tierMedium], ['high', s.settings.tierHigh]],
            v => save({ graphics: { tier: v } }), st.graphics.tier)),
        (() => {
          const themes = this._call('listThemes') || [];
          if (!themes.length) return null;
          return el('label', { class: 'field' }, el('span', { text: s.settings.themeLabel || 'Theme' }),
            selectEl('set-theme', themes.map(t => [t.id, t.name + (t.locked ? ' 🔒' : '')]),
              v => this._call('setTheme', v), this._themeId || themes[0].id));
        })()),
      el('section', { class: 'panel' },
        el('h2', { text: s.settings.accessibility }),
        checkboxEl('set-motion', s.settings.reducedMotion, st.accessibility.reducedMotion,
          v => save({ accessibility: { reducedMotion: v } })),
        checkboxEl('set-contrast', s.settings.highContrast, st.accessibility.highContrast,
          v => save({ accessibility: { highContrast: v } })),
        el('label', { class: 'field' }, el('span', { text: s.settings.palette }),
          selectEl('set-palette',
            [['default', s.settings.paletteDefault], ['deuteranopia', s.settings.paletteDeuteranopia], ['tritanopia', s.settings.paletteTritanopia]],
            v => save({ accessibility: { palette: v } }), st.accessibility.palette)),
        el('label', { class: 'field' }, el('span', { text: s.settings.textSize }),
          selectEl('set-textsize',
            [['normal', s.settings.textNormal], ['large', s.settings.textLarge], ['xl', s.settings.textXl]],
            v => save({ accessibility: { textSize: v } }), st.accessibility.textSize)),
        checkboxEl('set-handed', s.settings.leftHanded, st.accessibility.leftHanded,
          v => save({ accessibility: { leftHanded: v } })),
        el('label', { class: 'field' }, el('span', { text: s.settings.hintMode }),
          selectEl('set-hintmode',
            [['toggle', s.settings.hintToggle], ['hold', s.settings.hintHold]],
            v => save({ accessibility: { hintMode: v } }), st.accessibility.hintMode)),
        checkboxEl('set-haptics', s.settings.haptics, st.accessibility.haptics,
          v => save({ accessibility: { haptics: v } })),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => this._call('play', 'learn', { replay: true }),
        }, s.settings.tutorialReplay),
        el('p', { class: 'muted', text: s.settings.tutorialReplayNote })));
  }

  _screen_results() {
    // Populated by showResults(); shell only for direct navigation.
    return el('section', {},
      el('h1', { text: this.s.results.heading, 'data-autofocus': '' }),
      el('div', { class: 'results-body' }));
  }

  /**
   * Results screen.
   * data: { headline, breakdown:[{label,value}], progress, achievements:[keys],
   *         comparison, canRetry, canNext, recommendation }
   */
  showResults(data) {
    const d = data || {};
    const s = this.s;
    this.screen = 'results';
    this.g = null;
    this.root.textContent = '';
    const known = {};
    for (const a of (this.cache.achievements && (this.cache.achievements.list || this.cache.achievements.achievements)) || []) {
      known[a.key] = a;
    }
    const achNodes = (d.achievements || []).map(key => {
      const a = known[key];
      return el('li', { class: 'list-card is-unlocked' },
        el('strong', { text: '\u2605 ' + (a ? a.name : key) }),
        a && a.desc ? el('p', { text: a.desc }) : null);
    });
    const breakdown = (d.breakdown || []).map(row =>
      el('tr', {}, el('th', { scope: 'row', text: row.label }), el('td', { text: String(row.value) })));
    let progressNode = null;
    if (d.progress) {
      progressNode = typeof d.progress === 'string'
        ? el('p', { text: d.progress })
        : el('div', {},
            d.progress.stars != null ? el('p', { class: 'results-stars', text: '\u2605'.repeat(d.progress.stars) + '\u2606'.repeat(Math.max(0, 3 - d.progress.stars)) + ' ' + fmt(s.results.starsEarned, { n: d.progress.stars }) }) : null,
            d.progress.goalsPassed != null ? el('p', { text: fmt(s.results.goalsPassed, { passed: d.progress.goalsPassed, total: d.progress.goalsTotal != null ? d.progress.goalsTotal : '?' }) }) : null,
            d.progress.text ? el('p', { text: d.progress.text }) : null);
    }
    const node = el('section', { class: 'screen screen-results' },
      el('div', { class: 'panel results-panel' },
        el('h1', { text: d.headline || s.results.heading, 'data-autofocus': '' }),
        breakdown.length ? el('section', {},
          el('h2', { text: s.results.breakdown }),
          el('table', { class: 'stats-table' }, el('tbody', {}, breakdown))) : null,
        progressNode ? el('section', {}, el('h2', { text: s.results.progressTitle }), progressNode) : null,
        achNodes.length ? el('section', {}, el('h2', { text: s.results.achievementsTitle }), el('ul', { class: 'card-list' }, achNodes)) : null,
        d.comparison ? el('p', { class: 'results-compare', text: d.comparison }) : null,
        d.recommendation ? el('p', { class: 'results-next' }, el('strong', { text: s.results.recommendation + ': ' }), d.recommendation) : null,
        el('div', { class: 'field-row results-actions' },
          d.canRetry !== false ? el('button', {
            class: 'btn btn-primary', type: 'button', 'data-autofocus': '',
            onclick: () => { this._call('dismissResults'); this._call('retry'); },
          }, s.common.retry) : null,
          d.canNext ? el('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: () => { this._call('dismissResults'); this._call('nextStage'); },
          }, s.common.next) : null,
          el('button', {
            class: 'btn', type: 'button',
            onclick: () => { this._call('dismissResults'); this._call('leaveToTitle'); },
          }, s.results.backToTitle))));
    this.root.append(node);
    if (d.headline) this.announce(d.headline, true);
    const focusTarget = node.querySelector('[data-autofocus]');
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- game HUD */

  _screen_game() {
    return this._buildHud();
  }

  _buildHud() {
    const s = this.s;
    const g = this.g = {};
    g.objective = el('p', { class: 'objective-text' });
    g.progress = el('p', { class: 'progress-text' });
    g.handInfo = el('p', { class: 'status-line' });
    g.pot = el('span', { class: 'pot-total', text: '0' });
    g.currentBet = el('span', { text: '0' });
    g.toCall = el('span', { text: '0' });
    g.banner = el('p', { class: 'turn-banner', role: 'status' });
    g.community = el('div', { class: 'community', role: 'group', aria: { label: s.game.communityLabel } });
    g.seats = el('div', { class: 'seats' });
    g.seatEls = new Map();
    g.feed = el('ol', { class: 'feed', 'aria-label': s.game.feedTitle, reversed: '' });
    g.tray = el('div', { class: 'tray-buttons', role: 'group', aria: { label: s.game.actions } });
    g.undoBtn = el('button', {
      class: 'btn btn-ghost tray-assist', type: 'button', disabled: true,
      onclick: () => this._call('undo'),
    }, s.game.undo);
    g.hintBtn = this._buildHintButton();
    g.hintText = el('p', { class: 'hint-text', hidden: true });
    g.stepper = this._buildStepper();
    g.shortcutBar = this._buildShortcutBar();
    g.toasts = el('div', { class: 'toast-stack', 'aria-hidden': 'true' });
    g.chatPanel = this._buildChatPanel();

    const railLeft = el('aside', { class: 'rail rail-left', id: 'rail-left', 'aria-label': s.game.objective },
      el('h2', { text: s.game.objective }), g.objective,
      el('h2', { text: s.game.progress }), g.progress,
      g.shortcutBar);
    const railRight = el('aside', { class: 'rail rail-right', id: 'rail-right', 'aria-label': s.game.tableStatus },
      el('h2', { text: s.game.tableStatus }),
      g.handInfo,
      el('p', { class: 'status-line' }, el('strong', { text: s.game.pot + ': ' }), g.pot),
      el('p', { class: 'status-line' }, el('strong', { text: s.game.currentBet + ': ' }), g.currentBet),
      el('p', { class: 'status-line' }, el('strong', { text: s.game.toCall + ': ' }), g.toCall),
      el('h2', { text: s.game.feedTitle }), g.feed,
      g.chatPanel);

    g.drawerLeftBtn = el('button', {
      class: 'btn drawer-toggle drawer-toggle-left', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'rail-left',
      onclick: () => this._toggleDrawer(railLeft, g.drawerLeftBtn),
    }, s.game.openDrawerLeft);
    g.drawerRightBtn = el('button', {
      class: 'btn drawer-toggle drawer-toggle-right', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'rail-right',
      onclick: () => this._toggleDrawer(railRight, g.drawerRightBtn),
    }, s.game.openDrawerRight);

    g.pauseBtn = el('button', {
      class: 'btn btn-ghost hud-pause', type: 'button',
      onclick: () => this._openPause(),
    }, '\u23F8 ' + s.game.pause);

    return el('section', { class: 'hud-wrap' },
      el('div', { class: 'hud' },
        el('header', { class: 'hud-top' },
          g.drawerLeftBtn,
          g.banner,
          el('div', { class: 'hud-top-right' }, g.drawerRightBtn, g.pauseBtn)),
        railLeft,
        el('main', { class: 'table-zone', 'aria-label': s.app.title },
          el('div', { class: 'pot-line' }, el('span', { class: 'pot-chip', 'aria-hidden': 'true', text: '\u25CF' }), ' ', g.pot),
          g.community,
          g.seats),
        railRight,
        el('footer', { class: 'action-tray' },
          g.hintText,
          g.stepper.wrap,
          g.tray,
          el('div', { class: 'tray-assists' }, g.undoBtn, g.hintBtn)),
        g.toasts));
  }

  _toggleDrawer(rail, btn) {
    const open = rail.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
  }

  _buildStepper() {
    const s = this.s;
    const range = el('input', {
      type: 'range', class: 'raise-range', min: '0', max: '0', step: '1',
      'aria-label': s.game.raiseAmount,
    });
    const value = el('output', { class: 'raise-value', text: '0' });
    const minus = el('button', { class: 'btn btn-step', type: 'button', 'aria-label': '\u2212', text: '\u2212' });
    const plus = el('button', { class: 'btn btn-step', type: 'button', 'aria-label': '+', text: '+' });
    const applyVal = (v) => {
      const lo = Number(range.min), hi = Number(range.max), step = Number(range.step) || 1;
      v = Math.min(hi, Math.max(lo, Math.round((v - lo) / step) * step + lo));
      range.value = String(v);
      value.textContent = fmtChips(v);
      this.raiseAmount = v;
      this._refreshAmountLabels();
    };
    minus.addEventListener('click', () => applyVal(Number(range.value) - (Number(range.step) || 1)));
    plus.addEventListener('click', () => applyVal(Number(range.value) + (Number(range.step) || 1)));
    range.addEventListener('input', () => applyVal(Number(range.value)));
    const wrap = el('div', { class: 'raise-stepper', role: 'group', aria: { label: s.game.raiseAmount }, hidden: true },
      el('span', { class: 'raise-label', text: s.game.raiseAmount }), minus, range, plus, value);
    return { wrap, range, value, minus, plus, applyVal };
  }

  _buildHintButton() {
    const s = this.s;
    const btn = el('button', { class: 'btn btn-ghost tray-assist', type: 'button', disabled: true }, s.game.hint);
    const show = () => { this.hintVisible = true; this._call('hint'); this._renderHint(); };
    const hide = () => { this.hintVisible = false; this._renderHint(); };
    btn.addEventListener('click', () => {
      if (this.settings.accessibility.hintMode === 'hold') return;
      this.hintVisible ? hide() : show();
    });
    btn.addEventListener('pointerdown', () => {
      if (this.settings.accessibility.hintMode === 'hold') show();
    });
    btn.addEventListener('pointerup', () => {
      if (this.settings.accessibility.hintMode === 'hold') hide();
    });
    btn.addEventListener('pointerleave', () => {
      if (this.settings.accessibility.hintMode === 'hold') hide();
    });
    return btn;
  }

  _renderHint() {
    const g = this.g;
    if (!g) return;
    const text = this._lastHint;
    const showIt = this.hintVisible && !!text;
    g.hintText.hidden = !showIt;
    if (showIt) {
      g.hintText.textContent = text;
      if (this._lastMode === 'learn' && !g.hintAck) {
        g.hintAck = el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => { this._call('tutorialAck'); this.hintVisible = false; this._renderHint(); },
        }, this.s.game.hintGotIt);
        g.hintText.after(g.hintAck);
      }
      if (g.hintAck) g.hintAck.hidden = this._lastMode !== 'learn';
    }
  }

  _buildShortcutBar() {
    const s = this.s;
    const bar = el('div', { class: 'shortcut-bar' },
      el('div', { class: 'shortcut-head' },
        el('h2', { class: 'shortcut-title', text: s.game.shortcutsTitle }),
        el('button', {
          class: 'btn btn-ghost btn-small', type: 'button',
          onclick: () => {
            bar.hidden = true;
            this.settings.ui.shortcutHints = false;
            this._call('saveSettings', { ui: { shortcutHints: false } });
          },
        }, s.game.shortcutsDismiss)),
      el('ul', { class: 'shortcut-list' },
        KEY_BINDINGS.filter(b => !b.hidden).map(b =>
          el('li', {}, el('kbd', { text: b.label }), ' ', el('span', { text: b.desc })))));
    bar.hidden = this.settings.ui.shortcutHints === false;
    return bar;
  }

  /** Small DOM card element. cardInt null -> face-down back. */
  _cardEl(cardInt, opts = {}) {
    const s = this.s.cards;
    if (cardInt == null) {
      return el('span', { class: 'card card-back', role: 'img', aria: { label: opts.label || s.cardBack } },
        el('span', { class: 'card-back-pattern', 'aria-hidden': 'true' }));
    }
    const { rankLabel, suit } = cardParts(cardInt);
    const symbol = s.suitSymbols[suit];
    const rankName = s.ranks[rankLabel] || rankLabel;
    const suitName = s.suits[suit];
    return el('span', {
      class: 'card ' + SUIT_CLASS[suit] + (opts.small ? ' card-small' : ''),
      role: 'img', aria: { label: `${rankName} of ${suitName}` },
    },
      el('span', { class: 'card-rank', 'aria-hidden': 'true', text: rankLabel }),
      el('span', { class: 'card-suit', 'aria-hidden': 'true', text: symbol }),
      RED_SUITS.has(suit) ? el('span', { class: 'card-corner', 'aria-hidden': 'true' }) : null);
  }

  cardsText(cards) {
    return (cards || []).map(c => {
      if (c == null) return this.s.cards.cardBack;
      const { rankLabel, suit } = cardParts(c);
      return rankLabel + this.s.cards.suitSymbols[suit];
    }).join(' ');
  }

  /**
   * Idempotent snapshot render. Keeps element references and updates
   * text/classes instead of rebuilding the DOM.
   * view: { snapshot, legal, isYourTurn, objective, progress, mode,
   *         canUndo, hint, seatedYou }
   */
  updateGame(view) {
    if (!view || !view.snapshot) return;
    if (this.screen !== 'game' || !this.g || !this.g.seats || !this.g.seats.isConnected) {
      this.showScreen('game');
    }
    const g = this.g;
    const s = this.s;
    const snap = view.snapshot;
    this._lastMode = view.mode;
    this._lastHint = view.hint || null;

    // Player name/id bookkeeping (used by event strings + chat).
    for (const p of snap.players || []) this.playerNames.set(p.id, p.name);
    const you = view.seatedYou || (snap.players || []).find(p => p.id === this.youId) || null;
    if (you) this.youId = you.id;
    if (snap.terminal && snap.terminal.standings) {
      for (const st of snap.terminal.standings) this.playerNames.set(st.id, st.name);
    }

    // Objective / progress rail.
    const obj = view.objective || '';
    if (g.objective.textContent !== obj) {
      g.objective.textContent = obj;
      if (obj && obj !== this.lastAnnounce.objective) {
        this.announce(obj);
        this.lastAnnounce.objective = obj;
      }
    }
    const prog = view.progress || '';
    if (g.progress.textContent !== prog) g.progress.textContent = prog;

    // Status rail.
    g.handInfo.textContent = fmt(s.game.hand, { n: snap.handNumber || 0 }) + ' · ' +
      fmt(s.game.phase, { phase: snap.phase });
    g.pot.textContent = fmtChips(this._potTotal(snap));
    g.currentBet.textContent = fmtChips(snap.currentBet || 0);
    g.toCall.textContent = fmtChips(snap.toCall || 0);

    // Turn banner.
    const actor = snap.currentActor != null ? snap.players[snap.currentActor] : null;
    const banner = view.isYourTurn ? s.game.yourTurn
      : actor ? fmt(s.game.waiting, { name: actor.name }) : '';
    if (g.banner.textContent !== banner) {
      g.banner.textContent = banner;
      g.banner.classList.toggle('is-you', !!view.isYourTurn);
      if (banner && banner !== this.lastAnnounce.turn) {
        this.announce(banner);
        this.lastAnnounce.turn = banner;
      }
    }

    // Community cards — rebuild only when contents change.
    const commSig = (snap.community || []).join(',');
    if (g._commSig !== commSig) {
      g._commSig = commSig;
      g.community.textContent = '';
      for (const c of snap.community || []) g.community.append(this._cardEl(c));
    }

    this._renderSeats(snap, view);
    this._renderTray(view);
    this._renderHint();

    // Assists.
    this.actionPending = false;
    g.undoBtn.disabled = !view.canUndo;
    g.hintBtn.disabled = !(view.hintsEnabled || view.hint);

    // Fold any new engine log lines into the feed (covers reconnects).
    const log = snap.log || [];
    if (this.logSeen > log.length) { this.logSeen = 0; this.feed.length = 0; } // new game
    for (let i = this.logSeen; i < log.length; i++) this._feedPush(log[i]);
    this.logSeen = log.length;

    this.actionPending = false;
  }

  _potTotal(snap) {
    if (typeof snap.potTotal === 'number') return snap.potTotal;
    let total = 0;
    for (const p of snap.players || []) total += (p.totalBet || 0);
    for (const pot of snap.pots || []) total += pot.amount || 0;
    return total;
  }

  _renderSeats(snap, view) {
    const g = this.g;
    const s = this.s;
    const players = snap.players || [];
    // Rotate so the viewer sits at the bottom (position 0).
    const youSeat = view.seatedYou ? view.seatedYou.seat
      : (this.youId != null ? (players.find(p => p.id === this.youId) || {}).seat : null);
    const ordered = players.slice();
    if (youSeat != null && ordered.length) {
      ordered.sort((a, b) => (((a.seat - youSeat) % ordered.length + ordered.length) % ordered.length)
        - (((b.seat - youSeat) % ordered.length + ordered.length) % ordered.length));
    }
    const idsSig = ordered.map(p => p.id).join('|');
    if (g._seatsSig !== idsSig) {
      g._seatsSig = idsSig;
      g.seats.textContent = '';
      g.seatEls.clear();
      g.seats.dataset.count = String(ordered.length);
      ordered.forEach((p, pos) => {
        const name = el('span', { class: 'seat-name' });
        const chips = el('span', { class: 'seat-chips' });
        const badges = el('span', { class: 'seat-badges' });
        const cards = el('span', { class: 'seat-cards' });
        const last = el('span', { class: 'seat-last' });
        const panel = el('div', {
          class: 'seat seat-pos-' + pos, dataset: { playerId: p.id },
          role: 'group',
        }, el('div', { class: 'seat-row' }, name, badges), chips, cards, last);
        g.seats.append(panel);
        g.seatEls.set(p.id, { panel, name, chips, badges, cards, last, pos });
      });
    }
    for (const p of ordered) {
      const refs = g.seatEls.get(p.id);
      if (!refs) continue;
      const isYou = p.id === this.youId;
      const name = isYou ? s.common.you : p.name;
      if (refs.name.textContent !== name) refs.name.textContent = name;
      const chipText = fmtChips(p.chips);
      if (refs.chips.textContent !== chipText) refs.chips.textContent = chipText;
      refs.panel.setAttribute('aria-label', `${name}, ${chipText} chips`);

      // Badges.
      const badgeList = [];
      if (p.seat === snap.dealer) badgeList.push(['seat-dealer', 'D', s.game.seatDealer]);
      if (p.status === 'folded') badgeList.push(['seat-folded', '\u2715', s.game.seatFolded]);
      if (p.status === 'allin') badgeList.push(['seat-allin', '\u25B2', s.game.seatAllIn]);
      if (p.status === 'out') badgeList.push(['seat-out', '\u2014', s.game.seatOut]);
      const badgeSig = badgeList.map(b => b[0]).join(',');
      if (refs._badgeSig !== badgeSig) {
        refs._badgeSig = badgeSig;
        refs.badges.textContent = '';
        for (const [cls, glyph, label] of badgeList) {
          refs.badges.append(el('span', { class: 'seat-badge ' + cls, text: glyph + ' ' + label }));
        }
      }

      // Acting highlight.
      const acting = snap.currentActor === p.seat && !snap.terminal;
      refs.panel.classList.toggle('is-acting', acting);
      refs.panel.classList.toggle('is-you', isYou);
      refs.panel.classList.toggle('is-folded', p.status === 'folded');
      refs.panel.classList.toggle('is-out', p.status === 'out');

      // Cards: null means hidden (snapshot scrubs other players' hole cards).
      const cardSig = (p.cards ? p.cards.join(',') : p.status === 'out' ? 'none' : 'hidden') + ':' + isYou;
      if (refs._cardSig !== cardSig) {
        refs._cardSig = cardSig;
        refs.cards.textContent = '';
        if (p.cards) {
          for (const c of p.cards) refs.cards.append(this._cardEl(c, { small: true }));
        } else if (p.status !== 'out' && p.status !== 'folded') {
          refs.cards.append(this._cardEl(null, { small: true, label: s.game.hiddenCards }),
            this._cardEl(null, { small: true, label: s.game.hiddenCards }));
        }
      }

      const lastText = p.lastAction ? fmt(s.game.seatLastAction, { name, action: p.lastAction }) : '';
      if (refs.last.textContent !== lastText) refs.last.textContent = lastText;
    }
  }

  _renderTray(view) {
    const g = this.g;
    const s = this.s;
    const legal = view.legal || [];
    const sig = legal.map(a => a.type + ':' + (a.amount != null ? a.amount : '')).join('|')
      + '|turn:' + !!view.isYourTurn;
    const betAction = legal.find(a => a.type === 'bet');
    const raiseAction = legal.find(a => a.type === 'raise');
    const amountAction = raiseAction || betAction;

    // Configure the stepper bounds from the legal bet/raise amounts.
    if (amountAction) {
      const snap = view.snapshot;
      const bb = (snap.config && snap.config.bigBlind) || 1;
      const min = amountAction.amount != null ? amountAction.amount : bb;
      // Fixed limit: typically a single legal amount; allow up to player's stack for flexibility.
      const you = view.seatedYou;
      const max = Math.max(min, ...legal.filter(a => a.type === amountAction.type).map(a => a.amount || min));
      const range = g.stepper.range;
      range.min = String(min);
      range.max = String(max);
      range.step = String(Math.max(1, Math.min(bb, max - min || bb)));
      const fixed = min === max;
      range.disabled = fixed;
      g.stepper.minus.disabled = fixed;
      g.stepper.plus.disabled = fixed;
      if (this.raiseAmount == null || this.raiseAmount < min || this.raiseAmount > max) this.raiseAmount = min;
      range.value = String(this.raiseAmount);
      g.stepper.value.textContent = fmtChips(this.raiseAmount);
    }

    if (sig === g._legalSig && this.actionPending === false) {
      this._refreshAmountLabels();
      return;
    }
    g._legalSig = sig;
    g.tray.textContent = '';
    g._actionBtns = {};

    const mk = (type, label, opts = {}) => {
      const btn = el('button', {
        class: 'btn action-btn action-' + type + (opts.primary ? ' btn-primary' : ''),
        type: 'button',
        onclick: () => this._commitAction(type, opts.action),
      }, label);
      g.tray.append(btn);
      g._actionBtns[type] = btn;
      return btn;
    };

    for (const a of legal) {
      switch (a.type) {
        case 'fold': mk('fold', s.game.fold, { action: a }); break;
        case 'check': mk('check', s.game.check, { action: a }); break;
        case 'call': mk('call', fmt(s.game.call, { amount: fmtChips(a.amount || 0) }), { action: a, primary: true }); break;
        case 'bet': mk('bet', fmt(s.game.bet, { amount: fmtChips(this.raiseAmount != null ? this.raiseAmount : a.amount) }), { action: a, primary: true }); break;
        case 'raise': mk('raise', fmt(s.game.raise, { amount: fmtChips(this.raiseAmount != null ? this.raiseAmount : a.amount) }), { action: a, primary: true }); break;
        case 'allin': mk('allin', fmt(s.game.allin, { amount: fmtChips(a.amount != null ? a.amount : (view.seatedYou ? view.seatedYou.chips : 0)) }), { action: a }); break;
        case 'advance': {
          const phase = view.snapshot.phase;
          const label = phase === 'init' ? s.game.advanceDeal : phase === 'handEnd' ? s.game.advanceNext : s.game.advanceContinue;
          mk('advance', label, { action: a, primary: true });
          break;
        }
      }
    }
    g.stepper.wrap.hidden = !amountAction || !view.isYourTurn;
    const none = legal.length === 0;
    if (none) {
      g.tray.append(el('p', { class: 'muted tray-wait', text: g.banner.textContent || '' }));
    }
    this._refreshAmountLabels();
  }

  /** Keep bet/raise labels in sync with the stepper value. */
  _refreshAmountLabels() {
    const g = this.g;
    if (!g || !g._actionBtns) return;
    const s = this.s;
    const amt = fmtChips(this.raiseAmount != null ? this.raiseAmount : 0);
    if (g._actionBtns.bet) g._actionBtns.bet.textContent = fmt(s.game.bet, { amount: amt });
    if (g._actionBtns.raise) g._actionBtns.raise.textContent = fmt(s.game.raise, { amount: amt });
  }

  _commitAction(type, legalAction) {
    if (this.actionPending) return;
    const g = this.g;
    if (g && g._actionBtns && g._actionBtns[type] && g._actionBtns[type].disabled) return;
    let amount = legalAction && legalAction.amount;
    if ((type === 'bet' || type === 'raise') && this.raiseAmount != null) amount = this.raiseAmount;
    // Guard against double commits BEFORE dispatching: the controller call is
    // synchronous and its updateGame() rebuild clears this flag again. Only a
    // rejected command (no emit follows) must re-enable the tray manually.
    this.actionPending = true;
    if (g && g._actionBtns) for (const b of Object.values(g._actionBtns)) b.disabled = true;
    const res = type === 'advance' ? this._call('advance') : this._call('action', type, amount);
    if (res && res.ok === false) {
      this.actionPending = false;
      if (g && g._actionBtns) for (const b of Object.values(g._actionBtns)) b.disabled = false;
    }
    this.announce(fmt(this.s.a11y.actionTaken, { action: type }));
  }

  /** Engine events -> feed lines, toasts, announcements. */
  showEvents(events) {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      const name = (id) => {
        if (id === this.youId) return this.s.common.you;
        return this.playerNames.get(id) || id || '?';
      };
      let text = null, toast = false, assertive = false;
      const S = this.s.events;
      switch (ev.type) {
        case 'handStart':
          text = fmt(S.handStart, { n: ev.handNumber, dealer: name(ev.dealerId != null ? ev.dealerId : ev.dealer) });
          break;
        case 'post':
          text = fmt(ev.kind === 'sb' ? S.postSb : S.postBb, { name: name(ev.playerId), amount: fmtChips(ev.amount) });
          break;
        case 'deal': text = S.deal; break;
        case 'action': {
          const tpl = S[ev.action] || S.advance;
          text = fmt(tpl, { name: name(ev.playerId), amount: fmtChips(ev.amount || 0) });
          break;
        }
        case 'street': {
          const cards = this.cardsText(ev.cards);
          const tpl = ev.phase === 'flop' ? S.streetFlop : ev.phase === 'turn' ? S.streetTurn : ev.phase === 'river' ? S.streetRiver : S.street;
          text = fmt(tpl, { cards, phase: ev.phase });
          toast = true;
          break;
        }
        case 'showdown': {
          const parts = (ev.hands || []).map(h => {
            if (h.playerId != null) this.playerNames.set(h.playerId, h.name || this.playerNames.get(h.playerId));
            return fmt(S.showdown, { name: h.name || name(h.playerId), hand: h.evalResult ? h.evalResult.name : '' });
          });
          text = parts.join(' ');
          toast = parts.length > 0;
          break;
        }
        case 'award': {
          const parts = [];
          for (const pot of ev.pots || []) {
            for (const w of pot.winners || []) {
              const tpl = w === this.youId ? S.youWin : (pot.winners.length > 1 ? S.awardSplit : S.award);
              parts.push(fmt(tpl, { name: name(w), amount: fmtChips(pot.amount / (pot.winners.length || 1)), hand: pot.handName || '' }));
            }
          }
          text = parts.join(' ');
          toast = true; assertive = (ev.pots || []).some(p => (p.winners || []).includes(this.youId));
          break;
        }
        case 'eliminated': text = fmt(S.eliminated, { name: name(ev.playerId) }); toast = true; break;
        case 'handEnd': text = fmt(S.handEnd, { n: ev.handNumber }); break;
        case 'terminal': {
          const champ = ev.terminal && ev.terminal.championId;
          text = fmt(S.terminal, { name: name(champ) });
          toast = true; assertive = true;
          break;
        }
        case 'chat': this._chatAdd(ev); continue;
      }
      if (text) {
        this._feedPush(text);
        if (toast) this._toast(text, assertive);
      }
    }
  }

  _feedPush(text) {
    if (!text) return;
    this.feed.push(text);
    if (this.feed.length > 100) this.feed.splice(0, this.feed.length - 100);
    const g = this.g;
    if (g && g.feed) {
      g.feed.textContent = '';
      for (const line of this.feed.slice(-FEED_MAX)) g.feed.append(el('li', { text: line }));
    }
  }

  _toast(text, assertive = false) {
    const g = this.g;
    if (g && g.toasts) {
      const t = el('div', { class: 'toast', text });
      g.toasts.append(t);
      while (g.toasts.children.length > 4) g.toasts.firstChild.remove();
      setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 400); }, 4000);
    }
    this.announce(text, assertive);
  }

  /** aria-live announcement. assertive=true interrupts. */
  announce(msg, assertive = false) {
    const region = assertive ? this.liveAssertive : this.livePolite;
    if (!region) return;
    region.textContent = '';
    // Force re-announcement of repeated strings.
    void region.offsetWidth;
    region.textContent = String(msg);
  }

  /* --------------------------------------------------------------- chat */

  _buildChatPanel() {
    const s = this.s.chat;
    const list = el('ul', { class: 'chat-list', role: 'log', 'aria-label': s.title });
    const badge = el('span', { class: 'chat-badge', hidden: true });
    const body = el('div', { class: 'chat-body', hidden: true });
    const toggle = el('button', {
      class: 'btn chat-toggle', type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        this.chat.open = !this.chat.open;
        body.hidden = !this.chat.open;
        toggle.setAttribute('aria-expanded', String(this.chat.open));
        if (this.chat.open) { this.chat.unread = 0; this._chatBadge(badge); }
      },
    }, s.title + ' ', badge);
    const counter = el('span', { class: 'chat-counter', text: fmt(s.counter, { n: 0 }) });
    const input = el('input', {
      class: 'input chat-input', type: 'text', maxlength: String(CHAT_MAX_LEN),
      placeholder: s.placeholder, 'aria-label': s.placeholder,
    });
    const notice = el('p', { class: 'chat-note', text: s.rateNote });
    input.addEventListener('input', () => { counter.textContent = fmt(s.counter, { n: input.value.length }); });
    const form = el('form', { class: 'chat-form' }, input, counter,
      el('button', { class: 'btn btn-primary', type: 'submit' }, s.send));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const now = Date.now();
      this.chat.sentAt = this.chat.sentAt.filter(t => now - t < CHAT_RATE_WINDOW);
      if (this.chat.sentAt.length >= CHAT_RATE) {
        notice.textContent = s.rateLimited;
        notice.classList.add('is-warn');
        return;
      }
      this.chat.sentAt.push(now);
      this._call('hostedChat', text);
      input.value = '';
      counter.textContent = fmt(s.counter, { n: 0 });
      notice.textContent = s.rateNote;
      notice.classList.remove('is-warn');
    });
    body.append(list, notice, form);
    const panel = el('section', { class: 'chat', 'aria-label': s.title }, toggle, body);
    this._chatRefs = { list, badge };
    this._chatRender(list);
    return panel;
  }

  _chatBadge(badge) {
    const n = this.chat.unread;
    badge.hidden = n <= 0;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', fmt(this.s.chat.unread, { n }));
  }

  _chatMerge(messages) {
    for (const m of messages) this._chatAdd(m, true);
    if (this._chatRefs) this._chatRender(this._chatRefs.list);
  }

  _chatAdd(msg, quiet = false) {
    if (!msg) return;
    const key = msg.id || (msg.ts + '|' + (msg.from || msg.playerId || '') + '|' + msg.text);
    if (this.chat.messages.some(m => m._key === key)) return;
    this.chat.messages.push({ ...msg, _key: key });
    if (this.chat.messages.length > 100) this.chat.messages.shift();
    if (!this.chat.open && !quiet) this.chat.unread += 1;
    if (this._chatRefs) {
      this._chatRender(this._chatRefs.list);
      this._chatBadge(this._chatRefs.badge);
    }
  }

  _chatRender(list) {
    if (!list) return;
    list.textContent = '';
    const msgs = this.chat.messages.slice(-50);
    if (!msgs.length) list.append(el('li', { class: 'muted', text: this.s.chat.empty }));
    for (const m of msgs) {
      const who = m.name || this.playerNames.get(m.from || m.playerId) || m.from || m.playerId || '?';
      list.append(el('li', { class: 'chat-msg' },
        el('strong', { class: 'chat-who', text: who + ': ' }),
        el('span', { text: m.text })));
    }
    list.scrollTop = list.scrollHeight;
  }

  /* ------------------------------------------------------------- modals */

  _openModal(titleText, contentNode, opts = {}) {
    const prevFocus = document.activeElement;
    const close = () => this._closeModal(entry);
    const title = el('h2', { class: 'modal-title', text: titleText, id: 'modal-title-' + this.modals.length });
    const closeBtn = el('button', { class: 'btn btn-ghost modal-close', type: 'button', onclick: close }, '\u2715 ' + this.s.common.close);
    const dialog = el('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id,
    }, el('div', { class: 'modal-head' }, title, closeBtn), el('div', { class: 'modal-content' }, contentNode));
    const wrap = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === wrap && opts.dismissable !== false) close(); } }, dialog);
    const entry = { wrap, prevFocus, dialog };
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    this.modals.push(entry);
    document.body.append(wrap);
    const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button, input, select');
    if (first) first.focus({ preventScroll: true });
    return entry;
  }

  _closeModal(entry) {
    const i = this.modals.indexOf(entry);
    if (i < 0) return;
    this.modals.splice(i, 1);
    entry.wrap.remove();
    if (entry.onClose) entry.onClose();
    const prev = entry.prevFocus;
    if (prev && prev.isConnected) prev.focus({ preventScroll: true });
  }

  _closeTopModal() {
    const top = this.modals[this.modals.length - 1];
    if (top) { this._closeModal(top); return true; }
    return false;
  }

  _openPause() {
    if (this.modals.some(m => m.isPause)) return;
    const s = this.s.modals;
    this._call('pauseToggle'); // open => pause; closing (any path) => resume once
    const content = el('div', { class: 'pause-menu' },
      el('button', {
        class: 'btn btn-primary btn-wide', type: 'button', 'data-autofocus': '',
        onclick: () => this._closeTopModal(),
      }, s.resume),
      el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => this._openModal(this.s.settings.heading, this._buildSettingsPanel()),
      }, s.pauseSettings),
      el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => this._openModal(this.s.help.heading, this._screen_help(null, true)),
      }, s.pauseHelp),
      el('button', {
        class: 'btn btn-wide btn-danger', type: 'button',
        onclick: () => this._confirmLeave(() => {
          while (this.modals.length) this._closeTopModal();
          this._call('leaveToTitle');
        }),
      }, s.pauseLeave));
    const entry = this._openModal(s.pauseTitle, content, { dismissable: false });
    entry.isPause = true;
    entry.onClose = () => this._call('pauseToggle');
  }

  _confirmLeave(onConfirm) {
    const s = this.s.modals;
    const entry = this._openModal(s.confirmLeaveTitle, el('div', {},
      el('p', { text: s.confirmLeaveBody }),
      el('div', { class: 'field-row' },
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => { this._closeTopModal(); onConfirm(); } }, s.confirmLeaveConfirm),
        el('button', { class: 'btn', type: 'button', 'data-autofocus': '', onclick: () => this._closeTopModal() }, s.confirmLeaveStay))));
    return entry;
  }

  /* ----------------------------------------------------------- keyboard */

  _onKeydown(e) {
    // Modals: Esc closes the topmost; everything else stays inside the trap.
    if (this.modals.length) {
      if (e.key === 'Escape') { e.preventDefault(); this._closeTopModal(); }
      return;
    }
    if (this.screen !== 'game' || !this.g) return;
    if (isInteractiveTarget(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const btns = (this.g._actionBtns) || {};
    const press = (type) => {
      const b = btns[type];
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    };
    switch (key) {
      case 'f': press('fold'); break;
      case 'c': case 'x': press(btns.check ? 'check' : 'call'); break;
      case 'b': case 'r': press(btns.raise ? 'raise' : 'bet'); break;
      case 'a': press('allin'); break;
      case 'u': if (!this.g.undoBtn.disabled) { e.preventDefault(); this.g.undoBtn.click(); } break;
      case 'h': if (!this.g.hintBtn.disabled) { e.preventDefault(); this.g.hintBtn.click(); } break;
      case 'Escape': e.preventDefault(); this._openPause(); break;
      case 'ArrowLeft': case 'ArrowRight': {
        const all = Array.from(this.g.tray.querySelectorAll('button:not([disabled])'));
        if (!all.length) break;
        e.preventDefault();
        const dir = key === 'ArrowRight' ? 1 : -1;
        const idx = all.indexOf(document.activeElement);
        const next = all[(idx + dir + all.length) % all.length] || all[0];
        next.focus();
        break;
      }
      // Enter/Space confirm is native <button> behavior — nothing to do.
    }
  }

  /* -------------------------------------------- settings and theming */

  /**
   * Apply a settings object to the DOM. Safe to call with partial settings.
   * Shape (mirrored by main.js persistence):
   * { audio:{master,music,effects,ambience,voice,muted},
   *   graphics:{tier}, accessibility:{reducedMotion,highContrast,palette,
   *   textSize,leftHanded,hintMode,haptics}, ui:{shortcutHints} }
   */
  applySettings(settings) {
    if (!settings) return;
    mergeDeep(this.settings, settings);
    const st = this.settings;
    const rootEl = document.documentElement;
    rootEl.dataset.reducedMotion = st.accessibility.reducedMotion ? 'true' : 'false';
    rootEl.dataset.contrast = st.accessibility.highContrast ? 'high' : 'normal';
    rootEl.dataset.textSize = st.accessibility.textSize || 'normal';
    rootEl.dataset.handed = st.accessibility.leftHanded ? 'left' : 'right';
    rootEl.dataset.palette = st.accessibility.palette || 'default';
    if (this.g && this.g.shortcutBar) this.g.shortcutBar.hidden = st.ui.shortcutHints === false;
  }

  /**
   * Apply a content.js theme ({id, name, palette:{...}}). Palette keys are
   * mapped onto CSS custom properties; [data-theme] in the stylesheet is the
   * fallback when a palette omits a value.
   */
  setTheme(themeObj) {
    if (!themeObj) return;
    const rootEl = document.documentElement;
    if (typeof themeObj === 'string') { rootEl.dataset.theme = themeObj; this._themeId = themeObj; return; }
    if (themeObj.id) { rootEl.dataset.theme = themeObj.id; this._themeId = themeObj.id; }
    const palette = themeObj.palette || {};
    const MAP = {
      felt: '--felt', feltDeep: '--felt-deep', table: '--table', rail: '--rail-wood',
      river: '--river', accent: '--accent', brass: '--accent', gold: '--accent',
      surface: '--surface', surfaceRaised: '--surface-2', ink: '--ink', inkDim: '--ink-dim',
      background: '--bg', cardFace: '--card-face', cardInk: '--card-ink',
      text: '--ink', suitRed: '--suit-red', suitBlack: '--suit-black', danger: '--danger', ok: '--ok',
    };
    for (const [key, value] of Object.entries(palette)) {
      if (typeof value !== 'string') continue;
      const cssVar = MAP[key] || ('--theme-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
      rootEl.style.setProperty(cssVar, value);
    }
  }
}

/* -------------------------------------------------- module-level helpers */

function defaultSettings() {
  return {
    audio: { master: 1, music: 0.7, effects: 0.9, ambience: 0.6, voice: 0.8, muted: false },
    graphics: { tier: 'medium' },
    accessibility: {
      reducedMotion: false, highContrast: false, palette: 'default',
      textSize: 'normal', leftHanded: false, hintMode: 'toggle', haptics: true,
    },
    ui: { shortcutHints: true },
  };
}

function mergeDeep(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      mergeDeep(target[k], v);
    } else if (v !== undefined) target[k] = v;
  }
  return target;
}

function selectEl(id, options, onChange, current) {
  const sel = el('select', { class: 'input', id });
  for (const [value, label] of options) {
    sel.append(el('option', { value: String(value), selected: String(value) === String(current) }, label));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function checkboxEl(id, label, checked, onChange) {
  const input = el('input', { type: 'checkbox', id });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'field field-check', for: id }, input, el('span', { text: label }));
}

/** Human-readable goal summary (content.js goal shapes). */
function goalText(g) {
  if (!g || !g.type) return '';
  switch (g.type) {
    case 'winMatch': return 'Win the table (finish 1st)';
    case 'chipsAtLeast': return `Finish with at least ${fmtChips(g.amount)} chips`;
    case 'winHands': return `Win ${g.count} hands`;
    case 'winShowdowns': return `Win ${g.count} showdowns`;
    case 'surviveHands': return `Survive ${g.count} hands`;
    case 'finishTop': return `Finish in the top ${g.place}`;
    default: return g.type;
  }
}

function constraintText(c) {
  if (!c || !c.type) return '';
  switch (c.type) {
    case 'moveLimit': return `at most ${c.moves ?? c.count} actions`;
    case 'speedTarget': return `finish within ${Math.round(((c.maxMs ?? c.ms) || 0) / 60000)} minutes`;
    case 'shortStack': return 'short stack start';
    case 'noFoldPreflop': return 'no folding before the flop';
    default: return c.type;
  }
}
