/**
 * WCAG contrast, computed from the token file itself.
 *
 * The point of deriving this from `tokens.css` rather than from a hand-kept list is that
 * the check cannot drift from the palette. Change a token and the test recomputes; add a
 * theme and it is covered. No browser and no headless anything, because contrast is arithmetic,
 * and pretending it needs a rendering engine only makes it something that gets skipped.
 *
 * This report gets projected in meeting rooms, where a washed-out projector and a bright
 * room do to everyone what low contrast does to some people all the time.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Relative luminance, per WCAG 2.x. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type Theme = 'light' | 'dark';

/**
 * Pulls the custom properties out of tokens.css for each theme.
 *
 * Light comes from bare `:root`. Dark is light with the dark block's overrides applied on
 * top, which mirrors how the cascade actually resolves it, so a token the dark theme
 * forgets to redefine is tested with the value it will really have rather than being
 * quietly skipped.
 */
export function readTokens(css: string): Record<Theme, Record<string, string>> {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};

  const declarations = (block: string, into: Record<string, string>) => {
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      into[m[1]!] = m[2]!.trim();
    }
  };

  // The bare :root block, up to the first at-rule or attribute-scoped override.
  const rootMatch = /:root\s*\{([\s\S]*?)\}/.exec(css);
  if (rootMatch) declarations(rootMatch[1]!, light);

  Object.assign(dark, light);
  for (const m of css.matchAll(/:root(?::not\([^)]*\))?\[data-theme=["']?dark["']?\]\s*\{([\s\S]*?)\}/g)) {
    declarations(m[1]!, dark);
  }
  for (const m of css.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\s*\}/g)) {
    for (const inner of m[1]!.matchAll(/\{([\s\S]*?)\}/g)) declarations(inner[1]!, dark);
  }

  return { light, dark };
}

/** Resolves a token to a colour, following one level of `var(--x)` indirection. */
export function resolve(tokens: Record<string, string>, name: string): Rgb | null {
  const raw = tokens[name];
  if (!raw) return null;
  const varRef = /^var\((--[\w-]+)\)$/.exec(raw);
  if (varRef) return resolve(tokens, varRef[1]!);
  return parseHex(raw);
}

export interface Pairing {
  /** What the reader is looking at, so a failure names something real. */
  what: string;
  foreground: string;
  background: string;
  /** 4.5 for body text, 3 for large text and for the edges of a control. */
  minimum: number;
}

/**
 * The pairings that actually appear on screen.
 *
 * Written out rather than generated as a cross-product: most combinations of tokens never
 * meet, and asserting on them would produce failures nobody can act on and a habit of
 * ignoring the check.
 */
export const PAIRINGS: Pairing[] = [
  { what: 'body text on the page', foreground: '--ink', background: '--ground', minimum: 4.5 },
  { what: 'body text on a card', foreground: '--ink', background: '--surface', minimum: 4.5 },
  { what: 'secondary text on a card', foreground: '--ink-2', background: '--surface', minimum: 4.5 },
  { what: 'secondary text on the page', foreground: '--ink-2', background: '--ground', minimum: 4.5 },
  // The sub-labels under every tile and table figure. These are small, and they are where
  // "unavailable" is communicated, so they are held to the body-text threshold.
  { what: 'tile sub-labels on a card', foreground: '--ink-3', background: '--surface', minimum: 4.5 },
  { what: 'tile sub-labels on the page', foreground: '--ink-3', background: '--ground', minimum: 4.5 },
  { what: 'muted text on the inset surface', foreground: '--ink-3', background: '--surface-2', minimum: 4.5 },
  { what: 'link and accent text on a card', foreground: '--accent-ink', background: '--surface', minimum: 4.5 },
  { what: 'accent text on its own tint', foreground: '--accent-ink', background: '--accent-soft', minimum: 4.5 },
  { what: 'warning text on the saffron note', foreground: '--saffron-ink', background: '--saffron-soft', minimum: 4.5 },
  { what: 'critical text on its tint', foreground: '--crit', background: '--crit-soft', minimum: 4.5 },
  { what: 'critical text on a card', foreground: '--crit', background: '--surface', minimum: 4.5 },
  { what: 'success text on a card', foreground: '--good', background: '--surface', minimum: 4.5 },
  // Non-text, and the reason --control-border exists apart from --line-strong: WCAG asks
  // 3:1 of the boundary that identifies a control, not of every rule on the page. Holding
  // table rules to that would reprint the whole design; holding an input's border to it is
  // the difference between seeing the field and guessing where it is.
  { what: 'the border of an input or button', foreground: '--control-border', background: '--surface', minimum: 3 },
  { what: 'the border of a control on the page', foreground: '--control-border', background: '--ground', minimum: 3 },
  { what: 'the border of a control on the inset surface', foreground: '--control-border', background: '--surface-2', minimum: 3 },
  // The focus ring is its own token because Cumulus Blue is 2.8:1 on the page background.
  // A focus indicator below 3:1 is one a keyboard user cannot find.
  { what: 'the focus ring against a card', foreground: '--focus', background: '--surface', minimum: 3 },
  { what: 'the focus ring against the page', foreground: '--focus', background: '--ground', minimum: 3 },
  { what: 'the focus ring against the inset surface', foreground: '--focus', background: '--surface-2', minimum: 3 },
  // The main action is a gradient between these two, and its label has to read at both ends.
  { what: "the main action label at the gradient's light end", foreground: '--on-glow', background: '--stratus', minimum: 4.5 },
  { what: "the main action label at the gradient's dark end", foreground: '--on-glow', background: '--cumulus', minimum: 4.5 },
];

/** `top` laid over `bottom` with `alpha` of it showing, as the browser composites it. */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) };
}

/**
 * The colours text really sits on once the glow and the glass are drawn.
 *
 * The page is lit by two glows, each at its own -alpha where it is brightest, and a card is
 * --surface at --glass-alpha over that. Testing only the opaque tokens would pass a card
 * whose text fades into the light behind it, so every pairing on the page or on a card is
 * also tested where each glow is strongest. Inset surfaces and overlays stay opaque.
 */
export function litBackgrounds(tokens: Record<string, string>): Array<{ under: string; ground: Rgb; card: Rgb }> {
  const ground = resolve(tokens, '--ground');
  const surface = resolve(tokens, '--surface');
  const glassAlpha = Number.parseFloat(tokens['--glass-alpha'] ?? '');
  if (!ground || !surface || !(glassAlpha > 0)) return [];
  return (['--glow', '--glow-2'] as const).flatMap((name) => {
    const glow = resolve(tokens, name);
    const glowAlpha = Number.parseFloat(tokens[`${name}-alpha`] ?? '');
    if (!glow || !(glowAlpha > 0)) return [];
    const lit = over(glow, glowAlpha, ground);
    return [{ under: name, ground: lit, card: over(surface, glassAlpha, lit) }];
  });
}

export interface ContrastResult extends Pairing {
  theme: Theme;
  ratio: number;
  passes: boolean;
}

export function auditContrast(css: string): ContrastResult[] {
  const themes = readTokens(css);
  const out: ContrastResult[] = [];

  for (const theme of ['light', 'dark'] as Theme[]) {
    const tokens = themes[theme];
    for (const p of PAIRINGS) {
      const fg = resolve(tokens, p.foreground);
      const bg = resolve(tokens, p.background);
      if (!fg || !bg) {
        // A missing token is a failure, not a skip. Silently passing over one is how a
        // renamed variable turns a checked pairing into an unchecked one.
        out.push({ ...p, theme, ratio: 0, passes: false });
        continue;
      }
      const ratio = contrast(fg, bg);
      out.push({ ...p, theme, ratio, passes: ratio >= p.minimum });

      for (const lit of litBackgrounds(tokens)) {
        const under = p.background === '--ground' ? lit.ground : p.background === '--surface' ? lit.card : null;
        if (!under) continue;
        const litRatio = contrast(fg, under);
        out.push({
          ...p,
          what: `${p.what}, where ${lit.under} is brightest`,
          background: `${p.background} lit by ${lit.under}`,
          theme,
          ratio: litRatio,
          passes: litRatio >= p.minimum,
        });
      }
    }
  }

  return out;
}
