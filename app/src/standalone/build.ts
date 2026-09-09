/**
 * The one place that turns a report into a file, and the only place that touches the
 * template.
 *
 * Everything the export needs — the built template and the code that fills it — is
 * behind this single module so the export panel can reach it with one dynamic import.
 * That matters twice over. The template is several hundred kilobytes the hosted app
 * should not load until someone actually exports; and the standalone build replaces this
 * module with a stub, which is what keeps the placeholder tokens out of the one-file
 * report's own JavaScript. A report that carried those tokens would rewrite itself
 * during the next export.
 */
import template from './template.html?raw';
import { buildStandalone, type StandaloneBuild } from '@/engine/standalone';
import type { ReportModel, SessionFile } from '@/engine';

export function buildOneFileReport(
  model: ReportModel,
  session: SessionFile,
  sourceLabel: string,
): StandaloneBuild {
  return buildStandalone(template, model, session, sourceLabel);
}
