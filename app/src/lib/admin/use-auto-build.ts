// use-auto-build —— the microsite editor rebuilds the preview on its own as the owner edits, so the
// render on the right follows live without a "build preview" click. The owner's words: it shouldn't
// be click-to-build — edit, and see if it changed.
//
// Two properties builds force on us:
//   · builds are slow (a real vite build, tens of seconds) → DEBOUNCE: only build after the owner
//     pauses, not on every keystroke.
//   · the builder is one-at-a-time → COALESCE: never stack. If an edit lands while a build is in
//     flight, remember it and rebuild once when that build settles — with the latest files, not the
//     ones that were current when the edit happened.
//
// It hangs off the edit event (CodeMirror onChange), NOT a `files` effect: openExisting loads a
// draft through setFiles (not onChange) and already builds on entry, so tying to onChange means a
// programmatic load never triggers a redundant auto-build — only a real edit does.

'use client';

import { useCallback, useEffect, useRef } from 'react';

import { stageFiles, type BuildView, type DraftFiles } from '@/lib/admin/use-microsites';

// ponytail: fixed 800ms idle debounce. If owners find it too eager/laggy, make it adaptive to the
// last build's duration — but a constant is right until there's a complaint.
const AUTO_BUILD_DEBOUNCE_MS = 800;

// useAutoBuild —— returns schedule(): call it on every edit. It debounces, then builds a preview
// (stageFiles → the shared long-poll updates the preview pane). onTick(null) clears the status line
// while a fresh build runs.
export function useAutoBuild(
  slug: string, files: DraftFiles, onTick: (b: BuildView | null) => void,
): () => void {
  // latest inputs, read at fire time (not capture time) so a coalesced rebuild uses current files.
  const latest = useRef({ slug, files, onTick });
  latest.current = { slug, files, onTick };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const building = useRef(false);
  const dirty = useRef(false);

  const run = useCallback(() => {
    const { slug: s, files: f, onTick: tick } = latest.current;
    if (s.trim() === '') return; // no slug yet → nothing to build (matches the disabled buttons)
    if (building.current) { dirty.current = true; return; } // coalesce onto the in-flight build
    building.current = true;
    tick(null);
    void stageFiles(s.trim(), f, tick)
      .catch(() => undefined) // build failures surface through onTick's status line, not here
      .finally(() => {
        building.current = false;
        if (dirty.current) { dirty.current = false; run(); } // an edit arrived mid-build → rebuild
      });
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, AUTO_BUILD_DEBOUNCE_MS);
  }, [run]);
}
