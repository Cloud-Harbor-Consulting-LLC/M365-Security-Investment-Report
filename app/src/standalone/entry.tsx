/**
 * The entry point for the one-file report.
 *
 * A separate entry rather than a flag on the main app, for one reason that matters: it
 * excludes MSAL. The hosted app carries ~250 KB of authentication code that a frozen
 * report can never use, and shipping it inside a file left with a customer would mean
 * handing them sign-in machinery pointed at their own tenant for no purpose. This entry
 * imports the dashboard and the engine and nothing that talks to a network.
 *
 * It is the same Dashboard component the hosted app renders. There is no second
 * implementation of the report to keep in agreement — only a different way of getting
 * the data in, from an embedded <script> block instead of a drop target or Graph.
 */
import { render } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import '@/styles/tokens.css';
import '@/styles/app.css';
import '@/styles/standalone.css';
import '@/styles/print.css';

import { Dashboard } from '@/components/Dashboard';
import {
  analyze,
  buildSession,
  clearOverrides,
  parseSession,
  sessionFileName,
  setOverride,
  type Overrides,
  type ReportModel,
} from '@/engine';
import { downloadJson } from '@/download';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import type { Snapshot } from '@/model/snapshot';

interface Boot {
  snapshot: Snapshot;
  overrides: Overrides;
  sourceLabel: string;
}

/**
 * Reads the report out of the document.
 *
 * The data goes through parseSession exactly as a dropped file would. Being embedded in
 * the same document is not evidence of being well-formed — the file may have been edited,
 * truncated by a mail gateway, or written by an older build of this tool.
 */
function readEmbedded(): { ok: true; boot: Boot } | { ok: false; reason: string } {
  const node = document.getElementById('chsi-session');
  if (!node?.textContent) {
    return { ok: false, reason: 'This file does not contain a report. The data block is missing.' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(node.textContent);
  } catch {
    return {
      ok: false,
      reason:
        'The report data in this file could not be read. It may have been altered in transit. Mail gateways sometimes rewrite attachments.',
    };
  }

  const parsed = parseSession(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  return {
    ok: true,
    boot: {
      snapshot: parsed.session.snapshot,
      overrides: parsed.session.overrides,
      sourceLabel: parsed.session.sourceLabel,
    },
  };
}

function StandaloneApp({ boot }: { boot: Boot }): JSX.Element {
  const [overrides, setOverrides] = useState<Overrides>(boot.overrides);

  // Derived, never stored — the same rule as the hosted app, so a price the reader
  // types here moves spend, waste, realization and the roadmap together.
  const model: ReportModel = useMemo(
    () =>
      analyze({
        snapshot: boot.snapshot,
        config: cloneConfig(),
        catalog,
        priceList: listPriceList,
        featureMap,
        riskModel,
        overrides,
      }),
    [overrides],
  );

  return (
    <Dashboard
      model={model}
      sourceLabel={boot.sourceLabel}
      overrides={overrides}
      standalone
      onPriceChange={(partNumber, price) => setOverrides((o) => setOverride(o, partNumber, price))}
      onResetOverrides={() => setOverrides(clearOverrides())}
      onSaveSession={() => {
        // Worth keeping even here. A reader who re-prices the report can hand the
        // result back, and it reopens in the hosted app with their figures intact.
        const result = downloadJson(
          sessionFileName(model.tenant.DisplayName),
          buildSession(boot.snapshot, overrides, boot.sourceLabel),
        );
        return result.ok ? null : (result.reason ?? 'The browser refused the download.');
      }}
      session={() => buildSession(boot.snapshot, overrides, boot.sourceLabel)}
      onReset={() => {}}
    />
  );
}

const root = document.getElementById('app');
const fallback = document.getElementById('chsi-static');

if (root) {
  const loaded = readEmbedded();
  if (loaded.ok) {
    render(<StandaloneApp boot={loaded.boot} />, root);
    // Only now. The printed summary stays on screen until the interactive report has
    // actually rendered, so a bundle that throws leaves the reader with correct board
    // figures rather than a blank page.
    fallback?.remove();
  } else {
    // The summary in the document is still accurate — it was written at export time and
    // does not depend on this data parsing. So it stays, and the failure is reported
    // above it rather than replacing it.
    const note = document.createElement('p');
    note.className = 's-warn';
    note.setAttribute('role', 'status');
    note.textContent = `The interactive report could not start, so this file is showing its printed summary instead. ${loaded.reason}`;
    fallback?.prepend(note);
  }
}
