// The look of the screens, rails, seats, tray and panels: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings, selects, sliders, text fields) take. The five content themes'
// token sets ([data-theme] blocks, then the theme palette's inline
// overrides, as ui.js setTheme layered them), the colour-vision palettes
// ([data-palette]; the theme's inline values win, as they did) and the
// runtime's high contrast ([data-contrast="high"]) are applied here as tokens.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Theme } from "./game.ts";

type Tokens = Record<string, string>;
const ROOT: Tokens = {
  bg: "#0f1f18", felt: "#1d5c40", "felt-deep": "#123a29", table: "#5d3f2a", river: "#2f6f8f", accent: "#c9a227", "accent-ink": "#241a04",
  surface: "#101e18e0", "surface-2": "#1c2e26eb", ink: "#f3ecd9", "ink-dim": "#b9b09a", line: "#c9a22759", danger: "#d05b4b", ok: "#58b06c",
  warn: "#d8a13c", "card-face": "#f7f2e6", "card-ink": "#1d1a14", "suit-red": "#b5343a", "suit-black": "#22201c", "danger-ink": "#ffd9d2",
};
/** css/style.css [data-theme="…"] blocks for the content themes. */
const THEME_TOKENS: Record<string, Tokens> = {
  firstlight: { bg: "#f4e9d8", felt: "#7fae8e", "felt-deep": "#5d8a6e", table: "#8a6a4f", river: "#9fc6d8", accent: "#d98e4a", surface: "#fffbf2eb", "surface-2": "#faf1e2f5", ink: "#2e2620", "ink-dim": "#6b5f4d", line: "#5a462859" },
  emberdusk: { bg: "#241d26", felt: "#3f5d52", "felt-deep": "#2a4038", table: "#4a3428", river: "#31465e", accent: "#e07b39", surface: "#261c28e6", "surface-2": "#362838f0", ink: "#f2e6d8", "ink-dim": "#b3a191", line: "#e07b3959" },
  "noir-tide": { bg: "#101216", felt: "#1d2b2a", "felt-deep": "#121d1c", table: "#191919", river: "#16202c", accent: "#c0c4cc", surface: "#101317eb", "surface-2": "#1c2127f2", ink: "#e8e8ea", "ink-dim": "#9a978e", line: "#c0c4cc4d", "suit-red": "#c65a50" },
  willowbank: { bg: "#e8f0df", felt: "#5d8a5a", "felt-deep": "#456b43", table: "#7a5c3d", river: "#7fb3a3", accent: "#b5892d", surface: "#fcfff6eb", "surface-2": "#f4faecf5", ink: "#22301e", "ink-dim": "#5a6b52", line: "#465f3759" },
  regatta: { bg: "#e9eef4", felt: "#2e5f7a", "felt-deep": "#1f4559", table: "#6b4f35", river: "#4d8fb5", accent: "#c94f3d", surface: "#fafcffeb", "surface-2": "#f0f5faf5", ink: "#1c2733", "ink-dim": "#55677a", line: "#28466459" },
};
/** ui.js setTheme MAP: the theme palette's keys as tokens (inline, so they win over the palette and contrast blocks). */
const PALETTE_MAP: Record<string, string> = { background: "bg", felt: "felt", table: "table", accent: "accent", text: "ink", river: "river" };
const COLOR_VISION: Record<string, Tokens> = {
  deuteranopia: { "suit-red": "#d55e00", ok: "#e5ae10", accent: "#e5ae10" },
  tritanopia: { "suit-red": "#c33c54", river: "#b06a3b", ok: "#4fa3a5" },
};
const CONTRAST: Tokens = { surface: "#0b100d", "surface-2": "#121a15", ink: "#ffffff", "ink-dim": "#e2ddcf", line: "#e6c455", accent: "#ffd75e" };

let current: Tokens = { ...ROOT };
let key = "";
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "system-ui" });
  ui.setTheme({ fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 10 });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$line", radius: 4 } } },
    tooltip: { background: "$surface-2", text: { color: "$ink" }, radius: 6, padding: 6 },
    // .modal-backdrop: rgba(4, 8, 6, 0.6) behind the pause and confirm panels.
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#04080699" } } },
  });
  key = "";
}

/** The theme's tokens (ui.js setTheme), the colour-vision palette and high contrast; cheap when unchanged. */
export function applyTokens(theme: Theme, palette: string, highContrast: boolean): void {
  const k = `${theme.id}:${palette}:${highContrast}`;
  if (k === key) return;
  key = k;
  const inline: Tokens = {};
  for (const [pk, v] of Object.entries(theme.palette || {})) if (PALETTE_MAP[pk] && typeof v === "string") inline[PALETTE_MAP[pk]!] = v;
  current = { ...ROOT, ...(THEME_TOKENS[theme.id] ?? {}), ...(COLOR_VISION[palette] ?? {}), ...(highContrast ? CONTRAST : {}), ...inline };
  ui.setTokens(current);
  ui.setTheme({
    text: current.ink!, muted: current["ink-dim"]!, panel: current["surface-2"]!, control: current["surface-2"]!, hovered: current.surface!,
    pressed: current.surface!, field: current["surface-2"]!, accent: current.accent!, focus: current.accent!, outline: current.line!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
/** Whether the theme's surfaces are light (Firstlight, Willowbank, Regatta). */
export function lightTheme(): boolean {
  const c = token("ink");
  const n = parseInt(c.slice(1, 7), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) < 3 * 128;
}
