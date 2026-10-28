// The table's HUD (js/ui.js _buildHud / updateGame and css/style.css .hud)
// as starhermit:ui, built every frame over the salon: the top bar (turn
// banner, Pause; the rail drawers' toggles on narrower windows), the left
// rail (objective, progress, the shortcut bar), the right rail (table status:
// hand and street, pot, current bet, to call, the action feed), the seat
// panels ringed around the table zone (name, dealer / folded / all-in / out
// badges, chips, cards, last action; the acting seat glows), the pot line
// and community cards, the toast line, and the action tray (the hint, the
// raise stepper, the legal actions, Undo and Hint). The old media queries are
// layouts picked by the window's logical size: wide (≥ 1024 px: rails either
// side), compact (rails as drawers), phone (< 640 px: thumb-zone tray), short
// landscape (≤ 520 px tall: the status rail inline at the right).
import { frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import { bindings } from "starhermit:input";
import * as ui from "starhermit:ui";
import type { Legal, Player } from "./game.ts";
import { N, T, chips } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  HUMAN_ID, SUIT_SYMBOLS, TRAY_IDS, actionName, app, bannerText, cardName, cardParts, commit, fresh, hintText, later, objectiveText,
  openModal, phaseName, progressText, toggleHint, tutorialAck, undo,
} from "./main.ts";
import * as audio from "./audio.ts";
import { lightTheme, token } from "./style.ts";

// ------------------------------------------------------------------ layout
export interface Layout { lw: number; lh: number; sc: number; kind: "wide" | "compact" | "phone" | "land" }
export function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const land = lw > lh && lh <= 520 && lw < 1024;
  const kind = land ? "land" : lw >= 1024 ? "wide" : lw >= 640 ? "compact" : "phone";
  return { lw, lh, sc, kind };
}
export const lastSize = new Map<string, ui.Rect>();
export function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
export function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
export interface Btn {
  id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; content?: () => void; width?: number; quiet?: boolean;
}
export const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
export function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.content) opts.content = b.content;
  else if (b.width != null && buttonWidth(b.text, style) > b.width) {
    const inner = b.width - 38;
    const ink = style === "btn-primary" || style === "btn-xl" || style === "btn-act-primary";
    opts.content = () => { ui.style(ink ? "wrap-ink" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) {
    later(() => { if (!b.quiet) audio.play("click"); b.act(); });
  }
}
/** Buttons at their own widths in rows that wrap at `width` (flex-wrap). */
export function flow(label: string, list: Btn[], width: number, gap = 8, justify: "start" | "center" = "start", grow = false): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      // phone tray: each row's buttons share its width (flex: 1 1 30%)
      const extra = grow && row.length ? (width - row.reduce((s, b) => s + bw(b), 0) - gap * (row.length - 1)) / row.length : 0;
      for (const b of row) button({ ...b, width: bw(b) + Math.max(0, extra) });
    }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
/** A box over a logical rectangle drawn by a placed role-none widget. */
export function paint(id: string, x: number, y: number, w: number, h: number, cls: string): void {
  if (w <= 0 || h <= 0) return;
  ui.place(id, { anchor: "top-start", x, y }, () => { ui.style(cls).widget("", { role: "none", size: { width: w, height: h } }); });
}

// ------------------------------------------------------------------ cards (ui.js _cardEl, css .card)
export interface CardOpts { small?: boolean; phone?: boolean; label?: string }
export function cardSize(o: CardOpts): { w: number; h: number; font: number } {
  const font = o.small ? 15.2 : 17.6;
  const em = o.small ? (o.phone ? 1.6 : 1.9) : o.phone ? 2.1 : 2.5;
  const w = em * font;
  return { w, h: (w * 7) / 5, font };
}
/** One card as a widget (role image named "Ace of Spades"): the face's rank and suit (red suits with a corner diamond), or the back. */
export function card(id: string, c: number | null, o: CardOpts = {}): void {
  const { w, h, font } = cardSize(o);
  const hc = ui.preferences().highContrast;
  const detailed = frame().quality !== "low";
  ui.id(id).widget(c == null ? (o.label ?? T("Card face down")) : cardName(c), {
    role: "image", size: { width: w, height: h },
    draw: (r, st) => {
      const s = st.scale;
      const rad = 0.35 * font * s;
      draw.roundRect(r.x, r.y + 2 * s, r.width, r.height, rad, "#00000066"); // box-shadow 0 2px 4px
      if (c == null) {
        // .card-back: diagonal felt stripes in a card-face border, a ringed centre
        draw.roundRect(r.x, r.y, r.width, r.height, rad, token("card-face"));
        const b = 2 * s;
        const inner = { x: r.x + b, y: r.y + b, width: r.width - 2 * b, height: r.height - 2 * b };
        draw.roundRect(inner.x, inner.y, inner.width, inner.height, Math.max(0, rad - b), token("felt"));
        const step = 8 * s * Math.SQRT2;
        for (let d = -inner.height; d < inner.width; d += step) {
          draw.line(inner.x + d, inner.y + inner.height, inner.x + d + inner.height, inner.y, token("felt-deep"), 4 * s * Math.SQRT1_2 * 1.4, { clip: inner });
        }
        draw.strokeCircle(r.x + r.width / 2, r.y + r.height / 2, (r.width * 0.55) / 2, token("card-face") + "d9", 2 * s);
        if (detailed) draw.strokeRoundRect(r.x, r.y, r.width, r.height, rad, "#00000040", 1);
        return;
      }
      const { rank, suit } = cardParts(c);
      if (detailed) draw.box(r.x, r.y, r.width, r.height, "card-lacquer");
      else draw.roundRect(r.x, r.y, r.width, r.height, rad, token("card-face"));
      draw.strokeRoundRect(r.x, r.y, r.width, r.height, rad, "#00000059", hc ? 2 * s : Math.max(1, s));
      const red = suit === 1 || suit === 2;
      const ink = red ? token("suit-red") : token("suit-black");
      const fs = font * s;
      draw.text(rank, r.x + r.width / 2, r.y + r.height / 2 - fs * 0.95, { size: fs, color: ink, align: "center", weight: "800" });
      draw.text(SUIT_SYMBOLS[suit]!, r.x + r.width / 2, r.y + r.height / 2 + fs * 0.02, { size: fs * 0.85, color: ink, align: "center" });
      if (red) {
        const d = 0.32 * fs * 0.75, cx = r.x + r.width * 0.9 - d, cy = r.y + r.height * 0.08 + d;
        draw.polygon([[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]], ink);
      }
    },
  });
}

// ------------------------------------------------------------------ the frame
const GAP = 8;
export function drawHud(L: Layout): void {
  const h = app.hud, g = app.game;
  if (!h || !g) return;
  const pad = L.kind === "phone" ? 6.4 : 8;
  const topH = 46;
  const trayH = Math.max(60, (lastSize.get("tray-in")?.height ?? 44 * L.sc) / L.sc + (L.kind === "land" ? 14 : 20));
  const top = pad, bottom = L.lh - pad - trayH;
  const midY = top + topH + GAP, midH = Math.max(40, bottom - GAP - midY);
  let zone = { x: pad, y: midY, w: L.lw - 2 * pad, h: midH };
  const left = platform.options.leftHanded;
  if (L.kind === "wide") {
    const lw = left ? 300 : 260, rw = left ? 260 : 300;
    zone = { x: pad + lw + GAP, y: midY, w: L.lw - 2 * pad - lw - rw - 2 * GAP, h: midH };
    rail("rail-left", left ? L.lw - pad - rw : pad, midY, left ? rw : lw, midH, (iw) => leftRail(iw), L);
    rail("rail-right", left ? pad : L.lw - pad - rw, midY, left ? lw : rw, midH, (iw) => rightRail(iw), L);
  } else if (L.kind === "land") {
    const rw = 220;
    zone = { x: pad, y: midY, w: L.lw - 2 * pad - rw - GAP, h: midH };
    rail("rail-right", L.lw - pad - rw, midY, rw, midH, (iw) => rightRail(iw), L);
  }
  tableZone(zone, L);
  topBar(L, pad, topH);
  tray(L, pad, trayH);
  toastLine(L, pad, trayH);
  if (app.drawer && L.kind !== "wide") {
    const w = Math.min(320, 0.85 * L.lw);
    const y = top + topH + GAP + 2, hh = L.lh - y - pad;
    // a scrim outside the drawer closes it
    ui.place("drawer-scrim", { anchor: "top-start", x: 0, y: 0 }, () => {
      const r = ui.widget(T("Close panel"), { role: "button", size: { width: L.lw, height: L.lh } });
      if (r.activated && fresh()) later(() => { app.drawer = null; });
    });
    if (app.drawer === "left") rail("drawer-left", 0, y, w, hh, (iw) => leftRail(iw), L, "rail-drawer");
    else rail("drawer-right", L.lw - w, y, w, hh, (iw) => rightRail(iw), L, "rail-drawer");
  }
}

/** A rail panel at a logical rectangle; its content scrolls when taller. */
function rail(id: string, x: number, y: number, w: number, h: number, build: (inner: number) => void, L: Layout, cls = "rail"): void {
  ui.place(id, { anchor: "top-start", x, y }, () => {
    ui.column(id, () => {
      const prev = lastSize.get(`${id}-in`);
      const padX = 16, padY = 13;
      const inner = h - 2 * padY;
      const scroll = !!prev && prev.height / L.sc > inner + 1;
      const iw = w - 2 * padX - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(`${id}-in`, ui.column(`${id}-in`, () => build(iw), { spacing: 6, width: iw })); };
      if (scroll) ui.scrollArea(`${id}-scroll`, { width: w - padX - 2, height: inner }, body);
      else body();
    }, { style: cls, width: w, height: h, spacing: 0, padding: { top: 13, bottom: 13, start: 16, end: 16 } });
  });
}
function leftRail(w: number): void {
  para(T("Objective"), w, "h2", "rail-objective-h");
  para(objectiveText(), w, "objective-text", "hud-objective");
  para(T("Progress"), w, "h2", "rail-progress-h");
  para(progressText(), w, "progress-text", "hud-progress");
  if (platform.options.shortcutHints) shortcutBar(w);
}
const KEY_ACTIONS: { action?: string[]; label?: string; desc: string }[] = [
  { action: ["fold"], desc: N("Fold") },
  { action: ["call"], desc: N("Check / call (whichever is legal)") },
  { action: ["raise"], desc: N("Bet / raise") },
  { action: ["allin"], desc: N("All in") },
  { label: N("Enter"), desc: N("Confirm the focused button") },
  { action: ["pause"], desc: N("Pause / close panel") },
  { action: ["undo"], desc: N("Undo (when allowed)") },
  { action: ["hint"], desc: N("Hint") },
  { action: ["prev", "next"], desc: N("Move between action buttons") },
  { action: ["skip"], desc: N("Skip ahead to your next decision") },
];
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join(" / ");
}
/** ui.js _keyRows: the effective keys for the shortcut bar and How to play. */
export function keyRows(): { label: string; desc: string }[] {
  return KEY_ACTIONS.map((k) => ({ label: k.label ? T(k.label) : (k.action ?? []).map(keysFor).filter(Boolean).join(" / "), desc: T(k.desc) })).filter((r) => r.label);
}
function shortcutBar(w: number): void {
  ui.style("rule-sep").widget("", { role: "none", size: { width: w, height: 1 } });
  ui.row("shortcut-head", () => {
    ui.style("shortcut-title").label(T("Shortcuts"));
    ui.spacer();
    button({ id: "btn-hide-shortcuts", text: T("Hide shortcuts"), style: "btn-small", act: () => platform.setOption("shortcutHints", false) });
  }, { width: w, align: "center" });
  keyRows().forEach((r, i) => kbdRow(`sc-${i}`, r.label, r.desc, w, "shortcut-desc"));
}
export function kbdRow(id: string, key: string, desc: string, w: number, cls: string): void {
  const kw = textWidth(key, "kbd-text") + 16;
  ui.row(id, () => {
    ui.row(`${id}-k`, () => ui.style("kbd-text").label(key), { style: "kbd" });
    para(desc, Math.max(40, w - kw - 6), cls, `${id}-d`);
  }, { width: w, spacing: 6, align: "start" });
}
function rightRail(w: number): void {
  const h = app.hud!;
  const snap = h.snap;
  para(T("Table status"), w, "h2", "rail-status-h");
  para(`${T("Hand {n}", { n: snap.handNumber || 0 })} · ${T("Street: {phase}", { phase: phaseName(snap.phase) })}`, w, "status-v", "hud-hand");
  status("hud-pot", T("Pot"), chips(potTotal()), w);
  status("hud-bet", T("Current bet"), chips(snap.currentBet || 0), w);
  status("hud-call", T("To call"), chips(snap.toCall || 0), w);
  para(T("Action"), w, "h2", "rail-feed-h");
  const lines = app.feed.slice(-6);
  ui.column("feed", () => {
    lines.forEach((f, i) => {
      const last = i === lines.length - 1;
      ui.column(`feed-${i}`, () => para(f(), w - 12, last ? "feed-text-last" : "feed-text", `feed-${i}-t`), { style: last ? "feed-item-last" : "feed-item", width: w });
    });
  }, { spacing: 4, width: w });
}
function status(id: string, k: string, v: string, w: number): void {
  ui.row(id, () => { ui.style("status-k").label(k + ":"); ui.style("status-v").id(`${id}-v`).label(v); }, { width: w, spacing: 6 });
}
export function potTotal(): number {
  const snap = app.hud?.snap;
  if (!snap) return 0;
  let total = 0;
  for (const p of snap.players || []) total += p.totalBet || 0;
  return total;
}

// ------------------------------------------------------------------ the top bar
function topBar(L: Layout, pad: number, h: number): void {
  const banner = bannerText();
  const you = !!app.hud?.isYourTurn;
  const bannerBox = (maxW: number): void => {
    if (!banner) return;
    const small = L.kind === "phone" ? "-sm" : "";
    const cls = (you ? "banner-text-you" : "banner-text") + small;
    const tw = textWidth(banner, cls);
    const w = Math.min(maxW, tw + (L.kind === "phone" ? 20 : 40));
    ui.column("banner", () => para(banner, w - (small ? 18 : 38), cls, "hud-banner"), { style: (you ? "banner-you" : "banner") + small, width: w, align: "center" });
  };
  ui.place("hud-top", { anchor: "top-start", x: pad, y: pad }, () => {
    ui.row("hud-top-row", () => {
      const hudBtn = L.kind === "phone" ? "btn-hud-sm" : "btn-hud";
      const pauseW = buttonWidth(T("Pause"), hudBtn) + 18;
      if (L.kind === "wide") {
        bannerBox(L.lw - 2 * pad - pauseW - 16);
        ui.spacer();
      } else {
        const objW = buttonWidth(T("Objective"), hudBtn);
        const infoW = L.kind === "land" ? 0 : buttonWidth(T("Table info"), hudBtn);
        drawerButton("btn-drawer-left", T("Objective"), "left", hudBtn);
        const room = L.lw - 2 * pad - pauseW - objW - infoW - 3 * GAP - 4;
        ui.row("banner-wrap", () => bannerBox(room), { width: room, justify: "center" });
        if (L.kind !== "land") drawerButton("btn-drawer-right", T("Table info"), "right", hudBtn);
      }
      button({
        id: "btn-pause", text: T("Pause"), style: hudBtn, width: pauseW, act: () => openModal("pause"),
        content: () => ui.row("pause-face", () => {
          ui.widget("", { role: "none", size: { width: 10, height: 14 }, draw: (r, st) => {
            const s = st.scale;
            draw.rect(r.x + 1 * s, r.y + 1 * s, 3 * s, r.height - 2 * s, token("ink"));
            draw.rect(r.x + 6 * s, r.y + 1 * s, 3 * s, r.height - 2 * s, token("ink"));
          } });
          ui.label(T("Pause"));
        }, { spacing: 6, align: "center" }),
      });
    }, { width: L.lw - 2 * pad, height: h, spacing: GAP, align: "center" });
  });
}
function drawerButton(id: string, text: string, side: "left" | "right", style: string): void {
  button({ id, text, style, act: () => { app.drawer = app.drawer === side ? null : side; } });
}

// ------------------------------------------------------------------ the table zone: seats, pot, community
/** css .seat-pos-N: the viewer at the bottom, the next seat on the viewer's left (clockwise). */
function seatPos(pos: number, count: number, L: Layout): [number, number] {
  if (L.kind === "land") {
    const P: Record<number, [number, number]> = { 0: [84, 70], 1: [16, 70], 2: [16, 28], 3: [38, 14], 4: [62, 14], 5: [84, 28] };
    if (count === 2 && pos === 1) return [16, 50];
    if (count === 3) return pos === 1 ? [16, 50] : pos === 2 ? [50, 14] : P[pos]!;
    if (count === 4) return pos === 1 ? [16, 70] : pos === 2 ? [50, 14] : pos === 3 ? [84, 28] : P[pos]!;
    return P[pos]!;
  }
  const P: Record<number, [number, number]> = { 0: [50, 88], 1: [10, 66], 2: [10, 24], 3: [50, 10], 4: [90, 24], 5: [90, 66] };
  if (count === 2 && pos === 1) return [50, 10];
  if (count === 3) return pos === 1 ? [22, 12] : pos === 2 ? [78, 12] : P[pos]!;
  if (count === 4) return pos === 1 ? [9, 46] : pos === 2 ? [50, 10] : pos === 3 ? [91, 46] : P[pos]!;
  return P[pos]!;
}
function tableZone(z: { x: number; y: number; w: number; h: number }, L: Layout): void {
  const h = app.hud!;
  const snap = h.snap;
  const phone = L.kind === "phone";
  // pot line + community cards, centred in the zone
  const comm = snap.community || [];
  const cs = cardSize({ phone });
  const commW = Math.max(cs.w, comm.length * cs.w + Math.max(0, comm.length - 1) * 6.4);
  const potText = chips(potTotal());
  const potW = textWidth(potText, "pot-text") + textWidth("●", "pot-chip") + 8 + 38;
  const centreH = 30 + 10 + cs.h * 1.0 + 4;
  ui.place("table-centre", { anchor: "top-start", x: z.x + z.w / 2 - Math.max(commW, potW) / 2, y: z.y + z.h / 2 - centreH / 2 }, () => {
    ui.column("centre", () => {
      ui.row("pot-line", () => { ui.style("pot-chip").label("●"); ui.style("pot-text").id("pot-amount").label(potText); }, { style: "pot-line", spacing: 8, align: "center" });
      ui.row("community", () => comm.forEach((c, i) => card(`comm-${i}`, c, { phone })), { spacing: 6.4, height: cs.h, align: "center" });
    }, { spacing: 10, width: Math.max(commW, potW), align: "center" });
  });
  // seats, rotated so the viewer sits at the bottom (pos 0)
  const players = snap.players || [];
  const youSeat = players.find((p) => p.id === HUMAN_ID)?.seat ?? 0;
  const n = players.length;
  const ordered = players.slice().sort((a, b) => (((a.seat - youSeat) % n) + n) % n - ((((b.seat - youSeat) % n) + n) % n));
  ordered.forEach((p, pos) => {
    const [px, py] = seatPos(pos, n, L);
    seatPanel(p, z.x + (z.w * px) / 100, z.y + (z.h * py) / 100, L);
  });
}
function seatPanel(p: Player, cx: number, cy: number, L: Layout): void {
  const snap = app.hud!.snap;
  const compact = L.kind === "phone" || L.kind === "land";
  const isYou = p.id === HUMAN_ID;
  const name = isYou ? T("You") : p.name;
  const badges: [string, string, string][] = [];
  if (p.seat === snap.dealer) badges.push(["seat-dealer", "seat-dealer-text", `D ${T("Dealer")}`]);
  if (p.status === "folded") badges.push(["seat-badge", "seat-badge-text", `✕ ${T("Folded")}`]);
  if (p.status === "allin") badges.push(["seat-allin", "seat-allin-text", `▲ ${T("All in")}`]);
  if (p.status === "out") badges.push(["seat-badge", "seat-badge-text", `— ${T("Out")}`]);
  const acting = snap.currentActor === p.seat && !snap.terminal;
  const cls = acting ? "seat-acting" : isYou ? "seat-you" : "seat";
  const showCards = !!p.cards || (p.status !== "out" && p.status !== "folded");
  const cs = cardSize({ small: true, phone: L.kind === "phone" });
  const lastText = p.lastAction && !compact ? T("{name}: {action}", { name, action: actionName(p.lastAction) }) : "";
  const nameW = textWidth(name, "seat-name") + badges.reduce((s, b) => s + textWidth(b[2], b[1]) + 18, 0) + badges.length * 6;
  const minW = L.kind === "phone" ? 83 : L.kind === "land" ? 88 : 112, maxW = L.kind === "land" ? 136 : L.kind === "phone" ? 150 : 176;
  const innerW = Math.min(maxW - 22, Math.max(minW - 22, nameW, 2 * cs.w + 3, lastText ? Math.min(maxW - 22, textWidth(lastText, "seat-last")) : 0));
  const w = innerW + (compact ? 16 : 22);
  const prev = lastSize.get(`seat-${p.id}`);
  const hh = prev ? prev.height / L.sc : 100;
  const opacity = p.status === "out" ? 0.4 : p.status === "folded" ? 0.6 : 1;
  ui.place(`seat-${p.id}-at`, { anchor: "top-start", x: cx - w / 2, y: cy - hh / 2 }, () => {
    const r = ui.style(cls, { opacity }).column(`seat-${p.id}`, () => {
      ui.row(`seat-${p.id}-row`, () => {
        ui.style("seat-name").label(name);
        for (const [box, text, label] of badges) ui.row(`seat-${p.id}-${box}`, () => ui.style(text).label(label), { style: box });
      }, { spacing: 6, align: "center", justify: "center", width: innerW });
      ui.style("seat-chips").id(`seat-${p.id}-chips`).label(chips(p.chips));
      ui.row(`seat-${p.id}-cards`, () => {
        if (p.cards) p.cards.forEach((c, i) => card(`seat-${p.id}-c${i}`, c, { small: true, phone: L.kind === "phone" }));
        else if (showCards) for (let i = 0; i < 2; i++) card(`seat-${p.id}-c${i}`, null, { small: true, phone: L.kind === "phone", label: T("Face-down cards") });
      }, { spacing: 3.2, height: cs.h + 2, align: "center", justify: "center", width: innerW });
      if (lastText) para(lastText, innerW, "seat-last", `seat-${p.id}-last`);
    }, { width: w, spacing: 2.4, align: "center", padding: compact ? { top: 3, bottom: 3, start: 8, end: 8 } : { top: 6, bottom: 6, start: 11, end: 11 } });
    lastSize.set(`seat-${p.id}`, r);
  });
}

// ------------------------------------------------------------------ the action tray (ui.js _renderTray)
const HINT_ID = "btn-hint";
function trayButtons(): Btn[] {
  const h = app.hud!, snap = h.snap;
  const you = snap.players.find((p) => p.id === HUMAN_ID);
  const out: Btn[] = [];
  const amountAction = h.legal.find((a) => a.type === "raise") || h.legal.find((a) => a.type === "bet");
  const amt = chips(app.raiseAmount != null ? app.raiseAmount : (amountAction?.amount ?? 0));
  const mk = (a: Legal, text: string, style: string): void => { out.push({ id: `act-${a.type}`, text, style, act: () => commit(a), quiet: true }); };
  for (const a of h.legal) {
    switch (a.type) {
      case "fold": mk(a, T("Fold"), "btn-fold"); break;
      case "check": mk(a, T("Check"), "btn-act"); break;
      case "call": mk(a, T("Call {amount}", { amount: chips(a.amount || 0) }), "btn-act-primary"); break;
      case "bet": mk(a, T("Bet {amount}", { amount: amt }), "btn-act-primary"); break;
      case "raise": mk(a, T("Raise to {amount}", { amount: amt }), "btn-act-primary"); break;
      case "allin": mk(a, T("All in ({amount})", { amount: chips(a.amount != null ? a.amount : (you ? you.chips : 0)) }), "btn-allin"); break;
      case "advance": {
        const label = snap.phase === "init" ? T("Deal") : snap.phase === "handEnd" ? T("Next hand") : T("Continue");
        mk(a, label, "btn-act-primary");
        break;
      }
    }
  }
  return out;
}
function tray(L: Layout, pad: number, h: number): void {
  const hud = app.hud!, g = app.game!;
  const phone = L.kind === "phone";
  const w = L.lw - 2 * pad;
  const inner = w - 2 * 14;
  const amountAction = hud.legal.find((a) => a.type === "raise") || hud.legal.find((a) => a.type === "bet");
  if (amountAction) {
    // fixed limit: the legal amount is the only one (the stepper shows it, disabled)
    const min = amountAction.amount ?? hud.snap.config.bigBlind;
    const max = Math.max(min, ...hud.legal.filter((a) => a.type === amountAction.type).map((a) => a.amount || min));
    if (app.raiseAmount == null || app.raiseAmount < min || app.raiseAmount > max) app.raiseAmount = min;
  }
  const acts = trayButtons();
  TRAY_IDS.length = 0;
  for (const b of acts) TRAY_IDS.push(b.id);
  const hintOn = app.hintVisible && !!hintText();
  ui.place("tray", { anchor: "top-start", x: pad, y: L.lh - pad - h }, () => {
    const r = ui.column("tray-in", () => {
      if (hintOn) {
        ui.row("hint-row", () => {
          const ackW = g.mode === "learn" ? buttonWidth(T("Got it"), "btn-small") : 0;
          ui.column("hint-box", () => para(hintText()!, inner - ackW - 40, "hint-text", "hint-text"), { style: "hint", width: inner - (ackW ? ackW + 8 : 0) });
          if (ackW) button({ id: "btn-gotit", text: T("Got it"), style: "btn-small", act: () => { tutorialAck(); app.hintVisible = false; } });
        }, { width: inner, spacing: 8, align: "center" });
      }
      const assists: Btn[] = [{ id: "btn-undo", text: T("Undo"), style: "btn-ghost", act: undo, disabled: !hud.canUndo }];
      const stepper = !!amountAction && hud.isYourTurn;
      const sliderW = Math.max(56, Math.min(140, inner - (textWidth(T("Raise amount"), "raise-label") + 44 + 44 + 50 + 5 * GAP + 13)));
      const stepW = stepper ? stepperWidth(sliderW) : 0;
      const assistW = buttonWidth(T("Undo"), "btn-ghost") + buttonWidth(T("Hint"), "btn-ghost") + GAP;
      const actsW = acts.reduce((s, b) => s + buttonWidth(b.text, b.style!), 0) + GAP * Math.max(0, acts.length - 1);
      const waitText = acts.length ? "" : bannerText();
      const waitW = waitText ? textWidth(waitText, "dim") : 0;
      const oneRow = !phone && stepW + actsW + waitW + assistW + 3 * GAP + (stepper ? 12 : 0) <= inner;
      const order = (parts: (() => void)[]): void => { for (const p of platform.options.leftHanded ? parts.reverse() : parts) p(); };
      if (oneRow) {
        ui.row("tray-row", () => order([
          () => { if (stepper) stepperRow(sliderW, true); },
          () => { if (acts.length) ui.row("tray-acts", () => acts.forEach((b) => button(b)), { spacing: GAP, align: "center" }); else if (waitText) para(waitText, waitW + 2, "dim", "tray-wait"); },
          () => assistRow(assists),
        ]), { width: inner, spacing: GAP, justify: "center", align: "center" });
      } else {
        if (stepper) ui.row("stepper-wrap", () => stepperRow(sliderW, false), { width: inner, justify: "center" });
        const fitsRow = !phone && actsW + waitW + assistW + 2 * GAP <= inner;
        if (fitsRow) {
          ui.row("tray-row", () => order([
            () => { if (acts.length) ui.row("tray-acts", () => acts.forEach((b) => button(b)), { spacing: GAP, align: "center" }); else if (waitText) para(waitText, waitW + 2, "dim", "tray-wait"); },
            () => assistRow(assists),
          ]), { width: inner, spacing: GAP, justify: "center", align: "center" });
        } else {
          order([
            () => { if (acts.length) flow("tray-acts", acts, inner, GAP, "center", phone); else if (waitText) ui.row("wait-wrap", () => para(waitText, inner, "dim", "tray-wait"), { width: inner, justify: "center" }); },
            () => ui.row("assist-wrap", () => assistRow(assists), { width: inner, justify: "center" }),
          ]);
        }
      }
    }, { style: phone ? "tray-phone" : "tray", width: w, spacing: 8, align: "center", padding: L.kind === "land" ? { top: 6, bottom: 6, start: 14, end: 14 } : { top: 10, bottom: 10, start: 14, end: 14 } });
    lastSize.set("tray-in", { ...r, height: r.height - (L.kind === "land" ? 12 : 20) * L.sc });
  });
}
function assistRow(assists: Btn[]): void {
  ui.row("tray-assists", () => {
    for (const b of assists) button(b);
    hintButton();
  }, { spacing: GAP, align: "center" });
}
/** The Hint button: a press toggles the hint; in "hold to peek" mode it shows while held (ui.js _buildHintButton). */
function hintButton(): void {
  const g = app.game!;
  const enabled = g.hintsEnabled || !!app.hint;
  const label = T("Hint");
  const w = buttonWidth(label, "btn-ghost");
  const r = ui.style("btn-ghost").id(HINT_ID).widget(label, {
    role: "button", disabled: !enabled, size: { width: w, height: 44 },
    draw: (rect, st) => draw.text(label, rect.x + rect.width / 2, rect.y + rect.height / 2 - 10 * st.scale, { size: 16 * st.scale, color: token("ink"), align: "center", weight: "600" }),
  });
  if (!enabled) return;
  if (platform.options.hintMode === "hold") {
    if (r.pressed !== app.hintVisible) later(() => { if (r.pressed) { app.hintVisible = false; toggleHint(); } else app.hintVisible = false; });
  } else if (r.activated && fresh()) later(() => { audio.play("click"); toggleHint(); });
}
function stepperWidth(sliderW: number): number { return textWidth(T("Raise amount"), "raise-label") + 44 + sliderW + 44 + 50 + 5 * GAP + 13; }
function stepperRow(sliderW: number, sep: boolean): void {
  const amount = chips(app.raiseAmount ?? 0);
  ui.row("raise-stepper", () => {
    ui.style("raise-label").label(T("Raise amount"));
    button({ id: "btn-step-minus", text: "−", name: T("Lower the bet"), style: "btn-step", act: () => undefined, disabled: true });
    ui.widget(T("Raise amount"), {
      role: "slider", disabled: true, value: app.raiseAmount ?? 0, min: app.raiseAmount ?? 0, max: app.raiseAmount ?? 0, size: { width: sliderW, height: 44 },
      draw: (r, st) => {
        const s = st.scale, cy = r.y + r.height / 2;
        draw.roundRect(r.x, cy - 3 * s, r.width, 6 * s, 3 * s, lightTheme() ? "#00000033" : "#ffffff33");
        draw.circle(r.x + 8 * s, cy, 8 * s, token("ink-dim"));
      },
    });
    button({ id: "btn-step-plus", text: "+", name: T("Raise the bet"), style: "btn-step", act: () => undefined, disabled: true });
    ui.row("raise-value-box", () => ui.style("raise-value").id("raise-value").label(amount), { width: 50, justify: "end" });
    if (sep) ui.style("tray-sep").widget("", { role: "none", size: { width: 1, height: 44 } });
  }, { spacing: GAP, align: "center" });
}

// ------------------------------------------------------------------ the toast line (css .toast-stack)
function toastLine(L: Layout, pad: number, trayH: number): void {
  const t = app.toast;
  if (!t || app.modals.length) return;
  const text = t.text();
  const maxW = Math.min(0.9 * L.lw, 46 * 8.6);
  const w = Math.min(maxW, textWidth(text, "toast-text") + 40);
  const bottom = L.kind === "land" ? 70 : Math.max(104, trayH + pad + 6);
  ui.place("toast", { anchor: "top-start", x: L.lw / 2 - w / 2, y: L.lh - bottom - 40 }, () => {
    ui.column("toast-box", () => para(text, w - 38, "toast-text", "toast-text"), { style: "toast", width: w, align: "center" });
  });
}
