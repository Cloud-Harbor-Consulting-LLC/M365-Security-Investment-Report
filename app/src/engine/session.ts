import type { Snapshot } from '@/model/snapshot';
import { parseSnapshot } from '@/model/snapshot';
import { clearOverrides, type Overrides } from './overrides';

/**
 * A session: the tenant data, plus everything the consultant supplied on top of it.
 *
 * The problem it solves is small and real. Prices live in component state, so a refresh,
 * a crash or a closed tab loses every one of them — during this build alone the same
 * prices were re-entered across several rounds of testing, and a consultant mid-engagement
 * would lose an hour of negotiated rates the same way.
 *
 * A session file is a plain download to the user's own disk. There is no backend to save
 * to and there never will be, so "save" here means "hand you a file", and reopening the
 * report means handing it back. That keeps the tool's central promise intact: the tenant's
 * data never leaves the browser except when the user themselves asks for it, to a location
 * they chose.
 */

export const SESSION_KIND = 'm365-security-investment-session';
export const SESSION_VERSION = 1;

export interface SessionFile {
  kind: typeof SESSION_KIND;
  version: number;
  /** When the file was written, not when the tenant was collected. */
  savedAt: string;
  /** Where the underlying snapshot came from, for the provenance line. */
  sourceLabel: string;
  snapshot: Snapshot;
  overrides: Overrides;
}

export interface SessionContents {
  snapshot: Snapshot;
  overrides: Overrides;
  sourceLabel: string;
  savedAt: string;
}

export type SessionParse =
  | { ok: true; session: SessionContents }
  | { ok: false; reason: string };

export function buildSession(
  snapshot: Snapshot,
  overrides: Overrides,
  sourceLabel: string,
): SessionFile {
  return {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    sourceLabel,
    snapshot,
    overrides,
  };
}

/**
 * Reads a session file back, and refuses anything it cannot vouch for.
 *
 * A session and a raw snapshot are both JSON a user might drag onto the same target, so
 * the two are told apart explicitly rather than by guessing at their shape. The embedded
 * snapshot goes through the same parser a dropped snapshot does — a session file is not
 * a trusted channel just because this tool wrote it.
 */
export function parseSession(raw: unknown): SessionParse {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'That file is not a session: it does not contain a JSON object.' };
  }

  const candidate = raw as Partial<SessionFile>;

  if (candidate.kind !== SESSION_KIND) {
    return {
      ok: false,
      reason:
        'That file is not a session file. Sessions are written by this tool and carry both the tenant snapshot and your prices; a raw snapshot goes on the snapshot drop instead.',
    };
  }

  if (typeof candidate.version !== 'number' || candidate.version > SESSION_VERSION) {
    return {
      ok: false,
      reason: `That session was written by a newer version of this tool (format ${String(candidate.version)}, this build reads ${SESSION_VERSION}). Reopen it there, or reload the snapshot and re-enter the prices.`,
    };
  }

  const parsed = parseSnapshot(candidate.snapshot);
  if (!parsed.ok) {
    return { ok: false, reason: `The snapshot inside that session could not be read. ${parsed.reason}` };
  }

  return {
    ok: true,
    session: {
      snapshot: parsed.snapshot,
      overrides: normaliseOverrides(candidate.overrides),
      sourceLabel: typeof candidate.sourceLabel === 'string' ? candidate.sourceLabel : 'session file',
      savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '',
    },
  };
}

/**
 * Keeps only what an override may contain, on the same terms setOverride enforces.
 *
 * There is no stored "deliberately unpriced" state — clearing a price deletes the entry —
 * so an entry without a usable number is dropped rather than carried through as something
 * the engine would have to interpret. A hand-edited or truncated file therefore degrades
 * to fewer overrides, never to a figure nobody can account for.
 */
function normaliseOverrides(raw: unknown): Overrides {
  if (raw === null || typeof raw !== 'object') return clearOverrides();
  const prices = (raw as Overrides).prices;
  if (prices === null || typeof prices !== 'object') return clearOverrides();

  const clean: Overrides = { prices: {} };
  for (const [partNumber, entry] of Object.entries(prices)) {
    if (entry === null || typeof entry !== 'object') continue;

    const price = (entry as { monthlyPerSeat?: unknown }).monthlyPerSeat;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) continue;

    const share = (entry as { securityValueShare?: unknown }).securityValueShare;
    clean.prices[partNumber] =
      typeof share === 'number' && Number.isFinite(share) && share >= 0 && share <= 1
        ? { monthlyPerSeat: price, securityValueShare: share }
        : { monthlyPerSeat: price };
  }
  return clean;
}

/**
 * A filename that says which tenant and when, so a folder of these stays navigable.
 *
 * Tenant identity is in the name by design: a consultant carrying sessions for several
 * customers needs to tell them apart at a glance, and the file already contains far more
 * identifying material than its own name.
 */
export function sessionFileName(tenantName: string, savedAt = new Date()): string {
  const slug =
    tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tenant';
  const stamp = savedAt.toISOString().slice(0, 10);
  return `${slug}-${stamp}.m365session.json`;
}
