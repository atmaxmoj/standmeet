// throbber-label —— tool_started → human-readable progress copy.
//
// Design: the backend registers a progress_label ("searching corpus" /
// "booking meeting" / ...) for each tool — that's the throbber's
// **default** copy. The corpus-reading family (corpus_read /
// corpus_search) adds **which document it's reading** (path / query) on
// top of that, plus a rotating verb, so a long turn's wait feels
// informative (owner: "show what it's actually reading — verb +
// document"). Other tools (calendar / skill / ext) use the backend label
// directly, keeping the already-good per-tool copy they came with.

const READ_VERBS = ['reading', 'pulling up', 'opening', 'checking', 'digging into'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

type Formatter = (args: Record<string, unknown>, idx: number) => string;

// Enhanced formatters that add the document, only for the corpus-reading
// family; a hit here overrides the backend label.
const FORMATTERS: Record<string, Formatter> = {
  corpus_read: (a, i) => {
    const p = readStr(a['path']);
    return p ? `${READ_VERBS[i % READ_VERBS.length]!} ${p}` : 'reading an entry';
  },
  corpus_search: (a) => {
    const q = readStr(a['query']);
    return q ? `searching “${q}”` : 'searching the corpus';
  },
};

// throbberLabel —— name + args + backend progressLabel (+ an index for
// verb rotation). The corpus-reading family gets the document-enhanced
// copy; otherwise falls back to the backend label; failing that, a
// generic fallback.
export function throbberLabel(
  name: string, args: unknown, progressLabel: string | undefined, idx: number,
): string {
  const fmt = FORMATTERS[name];
  if (fmt) {
    return fmt(isRecord(args) ? args : {}, idx);
  }
  if (progressLabel !== undefined && progressLabel !== '') {
    return progressLabel;
  }
  return `running ${name}`;
}
