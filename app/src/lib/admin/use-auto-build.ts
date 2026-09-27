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
// And a third, from Publish: publishing takes over the edit it follows (settle). An owner who
// types and clicks Publish inside the debounce used to get two builds — Publish's own, and the
// auto-build firing after it — both writing the one status line, which flipped back to
// "building…" after the page had gone live.
//
// It hangs off the edit event (CodeMirror onChange), NOT a `files` effect: openExisting loads a
// draft through setFiles (not onChange) and already builds on entry, so tying to onChange means a
// programmatic load never triggers a redundant auto-build — only a real edit does.

'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  shipFilesLive, stageFiles, type BuildView, type DraftFiles,
} from '@/lib/admin/use-microsites';

// ponytail: fixed 800ms idle debounce. If owners find it too eager/laggy, make it adaptive to the
// last build's duration — but a constant is right until there's a complaint.
const AUTO_BUILD_DEBOUNCE_MS = 800;

export interface AutoBuild {
  // schedule —— call on every edit: debounces, then builds a preview (stageFiles → the shared
  // long-poll updates the preview pane). onTick(null) clears the status line while a build runs.
  schedule: () => void;
  // settle —— the build of the latest edit, now: a pending edit builds at once (no debounce), a
  // build in flight is joined. null when nothing is pending or building (the caller's last build
  // stands). Publish promotes what this returns.
  settle: () => Promise<BuildView | null>;
}

// shipSettled —— Publish: settle the edit it follows, then put that build live (or, with nothing
// pending, the last build; with no usable build, build now).
export async function shipSettled(
  slug: string, files: DraftFiles, last: BuildView | null,
  settle: AutoBuild['settle'], onTick: (b: BuildView) => void,
): Promise<void> {
  const settled = await settle();
  await shipFilesLive(slug, files, settled ?? last, onTick);
}

export function useAutoBuild(
  slug: string, files: DraftFiles, onTick: (b: BuildView | null) => void,
): AutoBuild {
  // latest inputs, read at fire time (not capture time) so a coalesced rebuild uses current files.
  const latest = useRef({ slug, files, onTick });
  latest.current = { slug, files, onTick };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<BuildView | null> | null>(null);
  const dirty = useRef(false);

  // buildLatest —— build until no edit arrived during the last build; the last result is the
  // build of the files as they are now.
  const buildLatest = useCallback(async (): Promise<BuildView | null> => {
    let last: BuildView | null = null;
    do {
      dirty.current = false;
      const { slug: s, files: f, onTick: tick } = latest.current;
      if (s.trim() === '') return null; // no slug yet → nothing to build (matches the disabled buttons)
      tick(null);
      // build failures surface through onTick's status line; a thrown request is "no build"
      last = await stageFiles(s.trim(), f, tick).catch(() => null);
    } while (dirty.current);
    return last;
  }, []);

  const run = useCallback((): Promise<BuildView | null> => {
    if (inflight.current) { dirty.current = true; return inflight.current; } // coalesce
    inflight.current = buildLatest().finally(() => { inflight.current = null; });
    return inflight.current;
  }, [buildLatest]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void run(); }, AUTO_BUILD_DEBOUNCE_MS);
  }, [run]);

  const settle = useCallback((): Promise<BuildView | null> => {
    const pending = timer.current !== null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending) return run();
    return inflight.current ?? Promise.resolve(null);
  }, [run]);

  return { schedule, settle };
}
