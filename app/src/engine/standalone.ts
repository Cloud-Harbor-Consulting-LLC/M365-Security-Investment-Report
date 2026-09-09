/**
 * The whole report as one HTML file, openable from a desktop with no network.
 *
 * This is the artifact a consultant leaves behind. It has to survive three things the
 * hosted app never faces: being opened offline, being opened years later when this
 * project may not exist, and being opened by someone who was not in the meeting.
 *
 * Two commitments follow from that, and both are enforced by tests.
 *
 * It reaches no external origin. Not a CDN, not a font host, not an analytics beacon,
 * not Microsoft. The file is inert: opening it tells nobody that it was opened, which
 * matters because it carries a customer's licensing and security posture and will end
 * up on mail servers and file shares nobody is auditing.
 *
 * It still shows the board figures with JavaScript disabled. Locked-down desktops and
 * mail previewers refuse scripts, and a security report that renders as a blank page in
 * front of a CFO has failed regardless of how good the interactive version is. So the
 * headline figures are written into the document as ordinary HTML, and the interactive
 * report replaces them only once it has actually mounted.
 */

import { money, percent, count, shortDate } from '@/format';
import type { ReportModel } from './index';
import type { SessionFile } from './session';

/** Placeholders the built template carries, replaced when a report is exported. */
export const SESSION_SLOT = '__CHSI_SESSION__';
export const STATIC_SLOT = '__CHSI_STATIC__';
export const TITLE_SLOT = '__CHSI_TITLE__';

/**
 * Escapes text for HTML.
 *
 * Tenant strings land in this document — display names, SKU part numbers, the tenant's
 * own name in the title. The same reasoning as the CSV escaping applies: a tenant is
 * where an attacker can set a display name, and this file gets opened on the
 * consultant's machine and then on the client's.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes JSON for embedding inside a <script> element.
 *
 * The parser ends the script at the literal text `</script`, wherever it appears —
 * inside a JSON string included. A display name containing it would end the data block
 * early and drop the remainder of the document into the page as markup. Escaping `<`
 * as < is invisible to JSON.parse and removes the sequence entirely.
 *
 * U+2028 and U+2029 are escaped for a different reason: they are valid in JSON strings
 * but are line terminators in JavaScript, and they have broken parsers that treat the
 * block as script rather than data.
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The board figures, as plain HTML that needs no JavaScript.
 *
 * Deliberately the Board view and nothing more. This is the fallback a CFO sees on a
 * locked-down machine, not a second implementation of the report — trying to render
 * every tab without scripting would double the surface that has to stay in agreement
 * with the engine, and the interactive file is one keystroke away for anyone who can
 * run it.
 *
 * The numbers come from the same model the dashboard renders, through the same
 * formatters, so "not available" stays "not available" here rather than becoming zero.
 */
export function staticBoardHtml(model: ReportModel, sourceLabel: string): string {
  const { spend, realization, tenant } = model;
  const cur = spend.currency;
  const r = realization.composite.available ? realization.composite : realization.seat;

  const tile = (label: string, value: string, sub: string, unavailable = false): string => `
        <div class="s-tile${unavailable ? ' s-tile--na' : ''}">
          <div class="s-tile-label">${escapeHtml(label)}</div>
          <div class="s-tile-value">${escapeHtml(value)}</div>
          <div class="s-tile-sub">${escapeHtml(sub)}</div>
        </div>`;

  const tiles = spend.anyPriced
    ? [
        tile('Annual commitment', money(spend.annualCommitment, cur), `${count(spend.seatsPurchased)} purchased seats`),
        tile('Spend in use', money(spend.annualSpendConsumed, cur), `${count(spend.seatsConsumed)} assigned seats`),
        tile('Idle seat spend', money(spend.unassignedSeatCost, cur), `${count(spend.seatsUnassigned)} unassigned seats`),
        tile(r.label, percent(r.ratio), r.detail),
      ]
    : [
        tile('Annual commitment', 'Not available', `${count(spend.seatsPurchased)} purchased seats`, true),
        tile('Spend in use', 'Not available', `${count(spend.seatsConsumed)} assigned seats`, true),
        tile('Idle seat spend', 'Not available', `${count(spend.seatsUnassigned)} unassigned seats`, true),
        tile(r.label, percent(r.ratio), r.detail),
      ];

  const lede = spend.anyPriced
    ? `This tenant carries <strong>${escapeHtml(money(spend.annualCommitment, cur))}</strong> a year in Microsoft 365 licence commitment. <strong>${escapeHtml(money(spend.unassignedSeatCost, cur))}</strong> of that pays for seats nobody is using.`
    : `None of this tenant&rsquo;s ${spend.skuCountTotal} subscribed SKUs could be priced, so no spend figure can be produced yet.`;

  const unpriced =
    spend.skuCountUnpriced > 0
      ? `
      <p class="s-warn"><strong>${spend.skuCountUnpriced} SKU${spend.skuCountUnpriced === 1 ? '' : 's'} contribute seats but no cost.</strong>
      Their seats are counted but their price is unknown, so the totals above are a floor rather than a complete picture.</p>`
      : '';

  return `
    <section class="s-board">
      <header class="s-head">
        <h1>${escapeHtml(tenant.DisplayName)}</h1>
        <p class="s-meta">Microsoft 365 Security Investment Report &middot; collected ${escapeHtml(shortDate(model.generatedAt))} &middot; ${escapeHtml(sourceLabel)}</p>
      </header>

      <p class="s-lede">${lede}</p>

      <div class="s-tiles">${tiles.join('')}
      </div>
      ${unpriced}

      <p class="s-note"><strong>This is the printed summary.</strong> The full report in this file &mdash; wasted spend,
      entitled versus deployed capability, the roadmap, and the evidence behind every figure &mdash; is interactive and
      needs JavaScript. If you are reading this sentence, your browser has scripting disabled for local files.
      The figures above are complete and correct as they stand.</p>

      <p class="s-note">Figures are a floor, not a valuation. Microsoft Graph does not expose contract pricing,
      so any price not entered by hand comes from public list rates. Nothing in this file was sent anywhere:
      it reaches no network, and it contains no tracking of any kind.</p>
    </section>`;
}

/** A filename that says which tenant and when. */
export function standaloneFileName(tenantName: string, generatedAt = new Date()): string {
  const slug =
    tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tenant';
  const stamp = generatedAt.toISOString().slice(0, 10);
  return `m365-security-investment-${slug}-${stamp}.html`;
}

export interface StandaloneBuild {
  html: string;
  fileName: string;
}

/**
 * Fills the built template with this tenant's report.
 *
 * The template is produced by the standalone Vite build with every script, stylesheet
 * and font already inlined, so this step adds data and the no-JS render and nothing
 * else. Keeping assembly and data separate is what lets the "no external origin" test
 * assert against the real built artifact rather than against a hand-written string.
 */
export function buildStandalone(
  template: string,
  model: ReportModel,
  session: SessionFile,
  sourceLabel: string,
): StandaloneBuild {
  for (const slot of [SESSION_SLOT, STATIC_SLOT, TITLE_SLOT]) {
    if (!template.includes(slot)) {
      throw new Error(
        `The standalone template is missing its ${slot} placeholder. Rebuild it with "npm run build:standalone".`,
      );
    }
  }

  const title = `M365 Security Investment Report — ${model.tenant.DisplayName}`;

  // Order matters only in that the session goes in last: it is the one substitution
  // whose replacement text is tenant-controlled, so nothing after it could be fooled
  // into treating that text as a placeholder.
  const html = template
    .split(TITLE_SLOT)
    .join(escapeHtml(title))
    .split(STATIC_SLOT)
    .join(staticBoardHtml(model, sourceLabel))
    .split(SESSION_SLOT)
    .join(escapeJsonForScript(session));

  return { html, fileName: standaloneFileName(model.tenant.DisplayName, new Date(model.generatedAt)) };
}

/**
 * Every origin the document would reach, so a test can assert there are none.
 *
 * Matches on the markup rather than on intent: any absolute URL in an attribute, a
 * stylesheet url(), or an import. The point is to catch a dependency nobody meant to
 * add — a font that crept back into the CSS, an icon sprite, a source map comment
 * pointing at a server.
 */
export function externalOrigins(html: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b(?:src|href|action|data|poster|formaction)\s*=\s*["']?(https?:|\/\/)[^"'\s>]+/gi,
    /url\(\s*["']?(https?:|\/\/)[^)"']+/gi,
    /@import\s+["'](https?:|\/\/)[^"']+/gi,
    /sourceMappingURL=(https?:|\/\/)\S+/gi,
  ];
  for (const rx of patterns) {
    for (const m of html.matchAll(rx)) found.add(m[0].slice(0, 120));
  }
  return [...found];
}
