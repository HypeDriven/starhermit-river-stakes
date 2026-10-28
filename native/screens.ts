// The browser build's DOM screens (js/ui.js _screen_* and the modals) as
// starhermit:ui, built every frame over the salon: title, modes, setup (and
// the lesson list), Daily (with the board's standings), Journey, Challenges,
// achievements, profile, How to play, Settings, the table's HUD (hud.ts),
// results, and the pause menu with its Settings, How to play and leave
// confirmation. The runtime's Options replace the old Audio, Graphics,
// Language and the reduced-motion / contrast / text-size rows; the theme,
// colour palette, left-handed tray, hint behaviour and shortcut bar stay the
// game's settings.
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import { requestRebind } from "starhermit:input";
import * as ui from "starhermit:ui";
import { Content, ProgressModel, type Goal } from "./game.ts";
import { N, S, T, chips } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  app, bestHandName, closeModal, commitSetup, fresh, invite, later, leaveToTitle, nextStage, openModal, play,
  profileName, profileSave, resultsLbLine, retry, selectChallenge, selectDaily, selectJourney, setTheme, setupMode, show, signIn,
  themeUnlocked, todaysDaily, type Mode, type Screen,
} from "./main.ts";
import { button, buttonWidth, card, drawHud, flow, kbdRow, keyRows, lastSize, layoutNow, para, textWidth, type Btn, type Layout } from "./hud.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  if (app.screen === "game") drawHud(L);
  else page(L);
  modals(L);
  appToast(L);
  if (app.focusNext) {
    const age = frame().frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ a scrolling screen (css .screen: 72rem wide, centred)
function page(L: Layout): void {
  if (app.screen === "title") { titleScreen(L); return; }
  const pad = 16;
  const w = Math.min(1152, L.lw - 2 * pad);
  const key = `page-${app.screen}`;
  const prev = lastSize.get(key);
  const maxH = L.lh - 2 * pad;
  const scroll = !!prev && prev.height / L.sc > maxH + 1;
  const opening = frame().frame - app.openedFrame <= 6;
  ui.place("page", { anchor: "top-start", x: (L.lw - w) / 2 - (scroll ? 7 : 0), y: pad }, () => {
    const iw = w;
    const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildPage(app.screen, iw - (scroll ? 14 : 0), L), { spacing: 12, width: iw - (scroll ? 14 : 0) })); };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: w + 14, height: maxH }, body, opening ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}
function buildPage(s: Screen, w: number, L: Layout): void {
  switch (s) {
    case "modes": modesScreen(w); break;
    case "setup": setupScreen(w); break;
    case "daily": dailyScreen(w); break;
    case "journey": journeyScreen(w); break;
    case "challenges": challengesScreen(w); break;
    case "achievements": achievementsScreen(w); break;
    case "profile": profileScreen(w); break;
    case "help": helpPanel(w, false); break;
    case "settings": backBar("title"); para(T("Settings"), w, "h1", "settings-h"); settingsPanel(w); break;
    case "results": resultsScreen(w, L); break;
    default: break;
  }
}
function backBar(target: Screen): void {
  button({ id: "btn-back", text: `‹ ${T("Back")}`, name: T("Back"), style: "btn-ghost", act: () => show(target) });
}
/** A .panel box (content width w − 2 × 19). */
function panel(id: string, w: number, build: (iw: number) => void, cls = "panel"): void {
  ui.column(id, () => build(w - 40), { style: cls, width: w, spacing: 10 });
}
/** Equal-width cards in rows (css repeat(auto-fill, minmax(min(N rem, 100%), 1fr))). */
function grid(id: string, n: number, w: number, min: number, gap: number, cell: (i: number, cw: number) => void): void {
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < n; r++) {
      ui.row(`${id}-r${r}`, () => { for (let i = r * cols; i < Math.min(n, (r + 1) * cols); i++) cell(i, cw); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
function badge(id: string, text: string, kind: "badge" | "badge-ranked" | "badge-ok" | "badge-mastery" = "badge"): void {
  const t = kind === "badge" ? "badge-text" : `${kind}-text`;
  ui.row(id, () => ui.style(t).label(text), { style: kind });
}
/** A check box row (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void, disabled = false): void {
  ui.row(`${id}-row`, () => {
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, disabled, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 21.6 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 3 * s, on ? token("accent") : token("surface-2"));
        draw.strokeRoundRect(bx, by, box, box, 3 * s, on ? token("accent") : token("ink-dim"), 2 * s);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: token("accent-ink"), align: "center", weight: "bold" });
      },
    });
    para(label, w - 56, "text", `${id}-label`);
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 8, height: 44 });
}
/** A labelled select (css .field: the label over the control). */
function selectField(id: string, label: string, index: number, options: string[], w: number, set: (i: number) => void, fixed = false): void {
  ui.column(`${id}-field`, () => {
    para(label, w, "text", `${id}-label`);
    const pick = ui.style(fixed ? { opacity: 0.45 } : {}).id(id).select(label, index, options, { width: Math.min(w, 672) } as ui.WidgetOptions);
    if (pick !== index && !fixed) later(() => set(pick));
  }, { spacing: 5, width: w });
}

// ------------------------------------------------------------------ title (ui.js _screen_title)
function titleScreen(L: Layout): void {
  const signed = platform.signedIn();
  const cardW = Math.min(L.lw - 32, 620);
  const iw = cardW - 2 * 42;
  const logoSize = Math.max(41.6, Math.min(67.2, 0.07 * L.lw));
  ui.place("title", "center", () => {
    ui.column("title-card", () => {
      para(T("Pull up a chair by the river."), iw, "title-kicker", "title-kicker");
      ui.style("title-logo", { text: { size: logoSize } }).id("title-logo").label("River Stakes");
      ui.style("title-tag", { width: iw }).id("title-tag-box").paragraph(T("A riverside card salon. Fixed-limit Hold’em, played for pride alone."), iw);
      button({ id: "btn-play", text: T("Play"), style: "btn-xl", act: () => show("modes", "mode-learn") });
      flow("title-secondary", [
        { id: "btn-daily", text: T("Daily challenge"), act: () => show("daily", "btn-daily-play") },
        { id: "btn-journey", text: T("Journey"), act: () => show("journey", "stage-j01") },
        { id: "btn-profile", text: T("Profile"), act: () => show("profile", "btn-back") },
      ], iw, 8, "center");
      const third: Btn[] = [
        { id: "btn-settings", text: T("Settings"), style: "btn-ghost", act: () => show("settings", "btn-back") },
        { id: "btn-howto", text: T("How to play"), style: "btn-ghost", act: () => show("help", "btn-back") },
      ];
      if (signed && platform.inviteLink()) third.push({ id: "btn-invite", text: S("invite"), style: "btn-ghost", act: invite });
      flow("title-tertiary", third, iw, 8, "center");
      if (!signed) button({ id: "btn-signin", text: S("signIn"), act: signIn });
    }, { style: "title-card", width: cardW, spacing: 16, align: "center" });
  });
}

// ------------------------------------------------------------------ modes and setup
const MODE_ORDER: Mode[] = ["learn", "journey", "daily", "practice", "challenge"];
const MODE_META: Record<Mode, { name: string; rules: string; duration: string; players: string; ranked: boolean }> = {
  learn: { name: N("Learn"), rules: N("Guided lessons that teach one rule at a time and make you perform it."), duration: N("5–10 min"), players: N("1 player + tutor"), ranked: false },
  journey: { name: N("Journey"), rules: N("Authored stages up the river. Goals, par scores and mastery stages."), duration: N("10–20 min"), players: N("2–6 seats vs AI"), ranked: false },
  daily: { name: N("Daily"), rules: N("One shared seed per UTC day. Same cards for everyone."), duration: N("~10 min"), players: N("1 player vs AI"), ranked: true },
  practice: { name: N("Practice"), rules: N("Pick difficulty, seats and assists. Undo allowed. Nothing at stake."), duration: N("5–15 min"), players: N("2–6 seats vs AI"), ranked: false },
  challenge: { name: N("Challenge"), rules: N("Constrained variants: short stacks, hand limits, speed targets."), duration: N("5–15 min"), players: N("2–6 seats vs AI"), ranked: true },
};
function modesScreen(w: number): void {
  backBar("title");
  para(T("Choose your table"), w, "h1", "modes-h");
  para(T("Every mode uses fixed-limit betting: bets and raises are set amounts, so the math stays readable."), Math.min(w, 672), "dim", "modes-intro");
  grid("mode-grid", MODE_ORDER.length, w, 272, 16, (i, cw) => {
    const id = MODE_ORDER[i]!, m = MODE_META[id];
    ui.column(`mode-${id}-card`, () => {
      const iw = cw - 40;
      para(T(m.name), iw, "h3", `mode-${id}-name`);
      para(T(m.rules), iw, "mode-rules", `mode-${id}-rules`);
      ui.row(`mode-${id}-meta`, () => {
        ui.style("mode-meta").label(`⏱ ${T(m.duration)}`);
        ui.style("mode-meta").label(`⚔ ${T(m.players)}`);
        badge(`mode-${id}-badge`, m.ranked ? T("Ranked") : T("Unranked"), m.ranked ? "badge-ranked" : "badge");
      }, { spacing: 10, align: "center" });
      ui.spacer();
      button({ id: `mode-${id}`, text: T("Play"), name: `${T("Play")} ${T(m.name)}`, style: "btn-primary", act: () => setupMode(id), content: () => ui.label(T("Play")) });
    }, { style: "mode-card", width: cw, spacing: 6 });
  });
}
const DIFFS = ["easy", "normal", "hard"];
function setupScreen(w: number): void {
  const o = app.setup;
  if (!o) return;
  const m = MODE_META[o.mode];
  backBar("modes");
  para(T("Set up: {mode}", { mode: T(m.name) }), w, "h1", "setup-h");
  const pw = Math.min(w, 712);
  panel("setup-panel", pw, (iw) => {
    if (o.mode === "learn") {
      para(T("Lessons"), iw, "h2", "lessons-h");
      Content.TUTORIAL.forEach((l, i) => {
        button({ id: `lesson-${i + 1}`, text: `${i + 1}. ${T(l.title)}`, width: iw, act: () => play("learn", { lesson: i }) });
      });
      return;
    }
    const fixed = o.mode !== "practice";
    para(T("Set up: {mode}", { mode: T(m.name) }), iw, "h2", "setup-h2");
    para(T("Fixed-limit Texas Hold’em. Bets are the big blind before the turn, double after. Maximum one bet and three raises per round."), iw, "text", "setup-rules");
    badge("setup-ranked", m.ranked ? T("This result is ranked.") : T("This result is not ranked."), m.ranked ? "badge-ranked" : "badge");
    selectField("setup-difficulty", T("Difficulty"), DIFFS.indexOf(o.difficulty), [T("Gentle"), T("Regular"), T("Sharp")], iw, (i) => { o.difficulty = DIFFS[i]!; }, fixed);
    selectField("setup-seats", T("Seats at the table"), o.players - 2, [2, 3, 4, 5, 6].map((n) => T("{n} seats", { n })), iw, (i) => { o.players = i + 2; }, fixed);
    ui.column("assists", () => {
      para(T("Assists"), iw - 34, "text", "assists-h");
      toggleRow("setup-hints", T("Hints available"), o.hints, iw - 34, (v) => { o.hints = v; });
      toggleRow("setup-undo", T("Undo allowed"), o.undo, iw - 34, (v) => { o.undo = v; });
    }, { style: "field-group", width: iw, spacing: 4 });
    button({ id: "btn-commit", text: T("Take your seat"), style: "btn-xl", act: commitSetup });
  });
}

// ------------------------------------------------------------------ Daily, Journey, Challenges
export function goalText(g: Goal): string {
  switch (g.type) {
    case "winMatch": return T("Win the table (finish 1st)");
    case "chipsAtLeast": return T("Finish with at least {n} chips", { n: chips(g.amount ?? 0) });
    case "winHands": return T("Win {n} hands", { n: g.count ?? 0 });
    case "winShowdowns": return T("Win {n} showdowns", { n: g.count ?? 0 });
    case "surviveHands": return T("Survive {n} hands", { n: g.count ?? 0 });
    case "finishTop": return T("Finish in the top {n}", { n: g.place ?? 0 });
    default: return g.type;
  }
}
function dailyScreen(w: number): void {
  const d = todaysDaily();
  backBar("title");
  para(T("Daily challenge"), w, "h1", "daily-h");
  const pw = Math.min(w, 712);
  panel("daily-card", pw, (iw) => {
    para(T("Table for {date}", { date: d.date }), iw, "daily-date", "daily-date");
    para(T("Seed {seed} — identical cards for every player today.", { seed: d.seed }), iw, "small", "daily-seed");
    para(T("Par: {n} hands", { n: d.par }), iw, "text", "daily-par");
    if (d.goals.length) {
      para(T("Today’s goals"), iw, "h2", "daily-goals-h");
      d.goals.forEach((g, i) => para(`• ${goalText(g)}`, iw, "text", `daily-goal-${i}`));
    }
    badge("daily-ranked", T("One shared deal per day — your best result is recorded on your profile."), "badge-ranked");
    button({ id: "btn-daily-play", text: T("Play today’s table"), style: "btn-xl", act: selectDaily });
  });
  const st = app.standings;
  if (st && st !== "loading" && st.length) {
    panel("standings", pw, (iw) => {
      para(T("River-wide standings"), iw, "h2", "standings-h");
      st.forEach((e, i) => ui.row(`standing-${i}`, () => {
        ui.style("text").label(`${e.rank}. ${e.name || T("Player")}`);
        ui.spacer();
        ui.style("dim").label(String(e.value));
      }, { width: Math.min(iw, 400) }));
    });
  }
}
function journeyScreen(w: number): void {
  const prog = platform.save().progress.journey;
  backBar("title");
  para(T("Journey upriver"), w, "h1", "journey-h");
  para(T("Complete stages to open the next reach of the river. Every fifth stage is a mastery test."), Math.min(w, 672), "dim", "journey-intro");
  const stages = Content.JOURNEY;
  grid("journey-grid", stages.length, w, 152, 12.8, (i, cw) => {
    const st = stages[i]!;
    const stars = prog.stars[st.id] || 0;
    const prevId = stages[i - 1]?.id;
    const unlocked = i === 0 || (prevId != null && (prog.stars[prevId] || 0) > 0) || i <= prog.unlocked;
    const state = stars > 0 ? "completed" : unlocked ? "available" : "locked";
    const stateName = state === "completed" ? T("Completed") : state === "available" ? T("Available") : T("Locked");
    const style = st.mastery ? "journey-mastery" : state === "completed" ? "journey-done" : state === "available" ? "journey-open" : "journey-node";
    const iw = cw - 30;
    button({
      id: `stage-${st.id}`, text: T(st.title), name: `${T(st.title)} — ${stateName}, ${T("{n} stars", { n: stars })}`, style, width: cw,
      disabled: state === "locked", act: () => selectJourney(st.id),
      content: () => ui.column(`stage-${st.id}-face`, () => {
        ui.style("journey-idx").label(String(st.index));
        para(T(st.title), iw, "journey-name", `stage-${st.id}-name`);
        ui.style("journey-stars").label("★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars)));
        if (st.mastery) badge(`stage-${st.id}-mastery`, T("Mastery"), "badge-mastery");
        if (state === "locked") ui.style("journey-lock").label(`⚿ ${T("Locked")}`);
      }, { spacing: 4, width: iw, align: "start" }),
    });
  });
}
function constraintText(c: NonNullable<(typeof Content.CHALLENGES)[number]["constraint"]>): string {
  switch (c.type) {
    case "moveLimit": return T("at most {n} actions", { n: c.moves ?? 0 });
    case "speedTarget": return T("finish within {n} minutes", { n: Math.round((c.maxMs ?? 0) / 60000) });
    case "shortStack": return T("short stack start");
    case "noFoldPreflop": return T("no folding before the flop");
    default: return c.type;
  }
}
function challengesScreen(w: number): void {
  const done = platform.save().progress.challenges || {};
  backBar("modes");
  para(T("Challenges"), w, "h1", "challenges-h");
  para(T("Constrained tables with their own goals and leaderboard entries."), Math.min(w, 672), "dim", "challenges-intro");
  const list = Content.CHALLENGES;
  grid("challenge-grid", list.length, w, 256, 16, (i, cw) => {
    const ch = list[i]!;
    const iw = cw - 40;
    ui.column(`challenge-${i}`, () => {
      para(T(ch.title), iw, "h3", `challenge-${i}-h`);
      para(T(ch.desc), iw, "text", `challenge-${i}-desc`);
      if (ch.constraint) badge(`challenge-${i}-c`, T("Constraint: {text}", { text: constraintText(ch.constraint) }));
      para(T("Par {n}", { n: ch.par }), iw, "dim", `challenge-${i}-par`);
      if (done[ch.id]) badge(`challenge-${i}-ok`, `✓ ${T("Cleared")}`, "badge-ok");
      ui.spacer();
      button({ id: `challenge-${ch.id}`, text: T("Play"), name: `${T("Play")} ${T(ch.title)}`, style: "btn-primary", act: () => selectChallenge(ch.id), content: () => ui.label(T("Play")) });
    }, { style: "list-card", width: cw, spacing: 5 });
  });
}
function dateText(ts: number): string { return new Date(ts).toISOString().slice(0, 10); }
function achievementsScreen(w: number): void {
  const unlocked = platform.save().progress.achievements || {};
  backBar("profile");
  para(T("Achievements"), w, "h1", "ach-h");
  para(T("Milestones from your time at the tables."), Math.min(w, 672), "dim", "ach-intro");
  const list = Content.ACHIEVEMENTS;
  grid("ach-grid", list.length, w, 256, 16, (i, cw) => {
    const a = list[i]!;
    const ts = unlocked[a.key];
    const iw = cw - 40;
    ui.column(`ach-${a.key}`, () => {
      para(`${ts ? "★" : "☆"} ${T(a.name)}`, iw, "h3", `ach-${a.key}-h`);
      para(T(a.desc), iw, "text", `ach-${a.key}-d`);
      para(ts ? T("Unlocked {date}", { date: dateText(ts) }) : T("Not yet unlocked"), iw, "dim", `ach-${a.key}-when`);
    }, { style: ts ? "list-card-on" : "list-card", width: cw, spacing: 5 });
  });
}

// ------------------------------------------------------------------ profile
let nameDraft: string | null = null;
function profileScreen(w: number): void {
  const pw = Math.min(w, 712);
  const save = platform.save();
  backBar("title");
  para(T("Profile"), w, "h1", "profile-h");
  panel("profile-name", pw, (iw) => {
    if (platform.signedIn()) {
      para(profileName(), iw, "strong", "profile-account-name");
      para(T("Your table name comes from your StarHermit account."), iw, "dim", "profile-account-note");
      return;
    }
    para(T("Display name"), iw, "text", "profile-name-label");
    if (nameDraft == null) nameDraft = save.profile.name || "Guest";
    nameDraft = ui.textField("profile-name-field", nameDraft, { maxChars: 24, width: Math.min(iw, 400) });
    const submit = ui.submitted("profile-name-field");
    button({ id: "btn-save-name", text: T("Save name"), style: "btn-primary", act: () => profileSave(nameDraft ?? "") });
    if (submit) later(() => profileSave(nameDraft ?? ""));
  });
  panel("profile-sync", pw, (iw) => {
    para(T("Save status"), iw, "h2", "sync-h");
    const sync = platform.syncState();
    para(sync === "synced" ? T("Synced to your account.") : sync === "saving" ? T("Syncing…") : sync === "error" ? T("Sync failed — it will retry with your next save.") : T("Saved on this device."), iw, "dim", "sync-line");
  });
  const p = save.progress, lt = p.lifetime;
  const rows: [string, string][] = [
    [T("Hands played"), String(lt.hands)], [T("Hands won"), String(lt.handsWon)], [T("Showdowns won"), String(lt.showdownsWon)],
    [T("Chips won"), String(lt.potsWon)], [T("Best hand"), bestHandName() ?? "—"], [T("Journey stages cleared"), String(Object.keys(p.journey.stars).length)],
    [T("Dailies played"), String(lt.dailiesPlayed)], [T("Achievements"), String(Object.keys(p.achievements || {}).length)],
  ];
  panel("profile-stats", pw, (iw) => {
    para(T("Lifetime at the tables"), iw, "h2", "stats-h");
    statsTable("stats", rows, Math.min(iw, 440));
  });
  panel("profile-ach", pw, () => button({ id: "btn-achievements", text: T("Achievements"), act: () => show("achievements", "btn-back") }));
}
function statsTable(id: string, rows: [string, string][], w: number): void {
  ui.column(id, () => rows.forEach(([k, v], i) => ui.row(`${id}-${i}`, () => {
    para(k, w * 0.62, "strong", `${id}-${i}-k`);
    ui.spacer();
    ui.style("text").id(`${id}-${i}-v`).label(v);
  }, { style: "stat-row", width: w, align: "center" })), { spacing: 0, width: w });
}

// ------------------------------------------------------------------ How to play (ui.js _screen_help)
const HAND_EXAMPLES = [
  ["Ah", "Kd", "7c", "5s", "2h"], ["9h", "9d", "Kc", "5s", "2h"], ["9h", "9d", "Kc", "Ks", "2h"], ["9h", "9d", "9c", "Ks", "2h"], ["9h", "8d", "7c", "6s", "5h"],
  ["Ah", "Kh", "7h", "5h", "2h"], ["9h", "9d", "9c", "Ks", "Kh"], ["9h", "9d", "9c", "9s", "2h"], ["9h", "8h", "7h", "6h", "5h"],
];
const HAND_LABELS = [N("High card"), N("One pair"), N("Two pair"), N("Three of a kind"), N("Straight"), N("Flush"), N("Full house"), N("Four of a kind"), N("Straight flush")];
function cardFromText(s: string): number { return "shdc".indexOf(s[1]!) * 13 + "23456789TJQKA".indexOf(s[0]!); }
function helpPanel(w: number, inModal: boolean): void {
  if (!inModal) backBar("title");
  para(T("How to play"), w, "h1", "help-h");
  const cw = Math.min(w, 712);
  panel("rule-blinds", cw, (iw) => { para(T("Blinds"), iw, "h2", "rule-blinds-h"); para(T("Each hand, the two players left of the dealer post forced bets: the small blind and the big blind. This seeds the pot so every hand matters. Heads-up, the dealer posts the small blind and acts first before the flop."), iw, "text", "rule-blinds-p"); });
  panel("rule-betting", cw, (iw) => { para(T("Fixed-limit betting"), iw, "h2", "rule-betting-h"); para(T("Before the turn, bets and raises are exactly one big blind. On the turn and river they are two big blinds. A round allows at most one bet plus three raises. Going all in for less than a full bet is always allowed and does not count against the raise cap."), iw, "text", "rule-betting-p"); });
  panel("rule-rankings", cw, (iw) => {
    para(T("Hand rankings"), iw, "h2", "rule-rank-h");
    para(T("Make the best five-card hand from your two cards and the five community cards. From strongest to weakest:"), iw, "text", "rule-rank-p");
    const cardsW = 5 * 29 + 4 * 4;
    HAND_LABELS.forEach((name, i) => {
      const label = `${i + 1}. ${T(name)}`;
      const inline = textWidth(label, "strong") + 12 + cardsW <= iw;
      const build = (): void => {
        para(label, inline ? Math.max(170, textWidth(label, "strong") + 2) : iw, "strong", `rank-${i}-name`);
        ui.row(`rank-${i}-cards`, () => HAND_EXAMPLES[i]!.forEach((c, k) => card(`rank-${i}-${k}`, cardFromText(c), { small: true })), { spacing: 4 });
      };
      if (inline) ui.row(`rank-${i}`, build, { spacing: 12, align: "center", width: iw });
      else ui.column(`rank-${i}`, build, { spacing: 4, width: iw });
    });
  });
  panel("rule-controls", cw, (iw) => {
    para(T("Controls"), iw, "h2", "rule-controls-h");
    para(T("Every action is a button on screen; the keys below are shortcuts."), iw, "text", "rule-controls-p");
    keyRows().forEach((r, i) => kbdRow(`help-key-${i}`, r.label, r.desc, iw, "text"));
    para(T("Gamepads: the D-pad or left stick moves between buttons and South presses; the shoulder and face buttons take the actions. Rebind keys and pads in the StarHermit Options."), iw, "dim", "rule-pads");
  });
}

// ------------------------------------------------------------------ Settings (ui.js _buildSettingsPanel, less what the runtime owns)
function settingsPanel(w: number): void {
  const o = platform.options;
  const cw = Math.min(w, 712);
  panel("set-runtime", cw, (iw) => {
    para(T("Sound and graphics"), iw, "h2", "set-runtime-h");
    para(T("Volumes, mute, graphics quality, frame rate, language, text size, high contrast and reduced motion are in the StarHermit Options."), iw, "dim", "set-runtime-note");
    flow("set-runtime-btns", [
      { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
      { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
    ], iw, 8);
  });
  panel("set-look", cw, (iw) => {
    para(T("Theme"), iw, "h2", "set-look-h");
    const themes = Content.THEMES;
    const cur = Math.max(0, themes.findIndex((t) => t.id === o.theme));
    selectField("set-theme", T("Theme"), cur, themes.map((t) => T(t.name) + (themeUnlocked(t) ? "" : " 🔒")), iw, (i) => setTheme(themes[i]!.id));
  });
  panel("set-a11y", cw, (iw) => {
    para(T("Accessibility"), iw, "h2", "set-a11y-h");
    const pals = ProgressModel.PALETTES;
    selectField("set-palette", T("Color palette"), Math.max(0, pals.indexOf(o.palette)), [T("Default"), T("Deuteranopia-safe"), T("Tritanopia-safe")], iw,
      (i) => platform.setOption("palette", pals[i] as typeof o.palette));
    toggleRow("set-handed", T("Left-handed action tray"), o.leftHanded, iw, (v) => platform.setOption("leftHanded", v));
    selectField("set-hintmode", T("Hint button behavior"), o.hintMode === "hold" ? 1 : 0, [T("Tap to toggle"), T("Hold to peek")], iw,
      (i) => platform.setOption("hintMode", i === 1 ? "hold" : "toggle"));
    toggleRow("set-shortcuts", T("Shortcuts"), o.shortcutHints, iw, (v) => platform.setOption("shortcutHints", v));
    button({ id: "btn-replay", text: T("Replay tutorial"), act: () => { app.modals = []; play("learn", { lesson: 0 }); } });
    para(T("Start the first lesson again from the beginning."), iw, "dim", "set-replay-note");
  });
}

// ------------------------------------------------------------------ results (ui.js showResults)
function resultsScreen(w: number, L: Layout): void {
  const r = app.results;
  if (!r) return;
  const pw = Math.min(w, 712);
  ui.row("results-wrap", () => panel("results-panel", pw, (iw) => {
    para(r.headline(), iw, "h1", "results-h");
    para(T("Breakdown"), iw, "h2", "results-breakdown-h");
    statsTable("breakdown", r.breakdown.map((row) => [row.label(), row.value()]), Math.min(iw, 440));
    if (r.stars != null || r.goalsPassed != null || r.progressText) {
      para(T("Progress"), iw, "h2", "results-progress-h");
      if (r.stars != null) para(`${"★".repeat(r.stars)}${"☆".repeat(Math.max(0, 3 - r.stars))} ${T("Stars earned: {n}", { n: r.stars })}`, iw, "stars", "results-stars");
      if (r.goalsPassed != null) para(T("{passed} of {total} goals passed", { passed: r.goalsPassed, total: r.goalsTotal ?? "?" }), iw, "text", "results-goals");
      if (r.progressText) para(r.progressText(), iw, "text", "results-progress");
    }
    if (r.achievements.length) {
      para(T("Achievements unlocked"), iw, "h2", "results-ach-h");
      r.achievements.forEach((key, i) => {
        const a = Content.ACHIEVEMENTS.find((x) => x.key === key);
        ui.column(`results-ach-${i}`, () => {
          para(`★ ${a ? T(a.name) : key}`, iw - 40, "strong", `results-ach-${i}-n`);
          if (a) para(T(a.desc), iw - 40, "text", `results-ach-${i}-d`);
        }, { style: "list-card-on", width: iw, spacing: 4 });
      });
    }
    if (r.comparison) para(r.comparison(), iw, "dim", "results-compare");
    const lb = resultsLbLine();
    if (lb) para(lb, iw, "dim", "results-lb");
    para(`${T("Recommended next")}: ${r.recommendation()}`, iw, "text", "results-next");
    const acts: Btn[] = [{ id: "btn-retry", text: T("Retry"), style: "btn-primary", act: retry }];
    if (r.canNext) acts.push({ id: "btn-next", text: T("Next"), style: "btn-primary", act: nextStage });
    acts.push({ id: "btn-title", text: T("Back to title"), act: leaveToTitle });
    flow("results-actions", acts, iw, 8);
  }), { width: w, justify: "center" });
  void L;
}

// ------------------------------------------------------------------ modals (ui.js _openModal / _openPause / _confirmLeave)
function modals(L: Layout): void {
  const m = app.modals[app.modals.length - 1];
  if (!m) return;
  const w = Math.min(576, L.lw - 32);
  const pad = 22;
  const inner = w - 2 * pad;
  const maxH = L.lh - 32;
  const key = `modal-${m}`;
  const prev = lastSize.get(key);
  const headH = 52;
  const scroll = !!prev && prev.height / L.sc + headH + 2 * 19 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const title = m === "pause" ? T("Paused") : m === "settings" ? T("Settings") : m === "help" ? T("How to play") : T("Leave the table?");
  const open = ui.dialog(title, "", true, () => {
    ui.column("modal", () => {
      ui.row("modal-head", () => {
        para(title, inner - buttonWidth(`✕ ${T("Close")}`, "btn-ghost") - 12, "h2", "modal-title");
        ui.spacer();
        button({ id: "btn-close", text: `✕ ${T("Close")}`, name: T("Close"), style: "btn-ghost", act: closeModal });
      }, { width: inner, align: "center" });
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => modalBody(m, iw), { spacing: 8, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: maxH - headH - 2 * 19 }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { style: "modal", width: w, spacing: 12 });
  });
  // Escape or the backdrop: the topmost panel closes (the pause panel only by its buttons and Escape)
  if (!open && fresh()) later(closeModal);
}
function modalBody(m: string, w: number): void {
  switch (m) {
    case "pause":
      button({ id: "btn-resume", text: T("Resume"), style: "btn-primary", width: w, act: closeModal });
      button({ id: "btn-pause-settings", text: T("Settings"), width: w, act: () => openModal("settings") });
      button({ id: "btn-pause-help", text: T("How to play"), width: w, act: () => openModal("help") });
      button({ id: "btn-leave", text: T("Leave table"), style: "btn-danger", width: w, act: () => openModal("confirm-leave") });
      break;
    case "settings": settingsPanel(w); break;
    case "help": helpPanel(w, true); break;
    case "confirm-leave":
      para(T("Your seat and current hand progress will be forfeited."), w, "text", "confirm-leave-p");
      flow("confirm-leave-row", [
        { id: "btn-leave-confirm", text: T("Leave table"), style: "btn-danger", act: () => { app.modals = []; app.game?.session.resume(); leaveToTitle(); } },
        { id: "btn-stay", text: T("Stay"), act: closeModal },
      ], w, 8);
      break;
  }
}

// ------------------------------------------------------------------ the app toast (ui.js notify off the table)
function appToast(L: Layout): void {
  const t = app.appToast;
  if (!t) return;
  const w = Math.min(0.9 * L.lw, 400, textWidth(t.text, "toast-text") + 42);
  ui.place("app-toast", { anchor: "bottom", y: 24 }, () => {
    ui.column("app-toast-box", () => para(t.text, w - 40, "toast-text", "app-toast-text"), { style: "app-toast", width: w, align: "center" });
  });
}
