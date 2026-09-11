/**
 * What the export builder resolves to inside the one-file report itself.
 *
 * A standalone report cannot produce another standalone report: the template is not in
 * it, and putting it there would mean every export carried a copy of the previous one,
 * doubling in size each time. Keeping the real builder out of this bundle is also what
 * keeps its placeholder tokens out. A report containing them would corrupt its own
 * JavaScript the moment anything ran a substitution over it.
 *
 * The export panel hides this option in the standalone build, so this is only reached if
 * that ever stops being true. Failing with an explanation beats emitting a broken file.
 */
import type { StandaloneBuild } from '@/engine/standalone';

export function buildOneFileReport(): StandaloneBuild {
  throw new Error(
    'This report is already a single file, so it cannot build another one. Open the hosted app with the session file to produce a fresh export.',
  );
}
