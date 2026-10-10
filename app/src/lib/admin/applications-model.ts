// applications-model —— data shape + timeline derivation + status enum for admin /applications.
//
// **Status describes the submission axis, not whether the recruiter replied.**
// The previous version here was `silent | reviewing | replied | rejected |
// offer` — a vocabulary about the other side's reaction, while the backend
// column stores `pending | submitted | failed | withdrawn`, and the two
// vocabularies don't overlap at all. The frontend matched with `find(x => x
// === s)`, which could never match, so every row fell back to rendering as
// SILENT: a status that was purely fictional (F-E-3).
//
// Today's product only knows the submission axis, and only its first cell:
// `applications.commit` writes one row (created with status 'pending' =
// owner has nodded, the PDF and access code are issued), and **no code ever
// changes it after that** — job-loop step 4 (actually submitting via
// Playwright) doesn't exist yet, so submitted_at stays empty forever.
// Whether the recruiter has replied doesn't even have a write path in the
// product, so there shouldn't be a cell pretending to track it.
//
// So: only committed / submitted / failed / withdrawn can be displayed, and
// an unrecognized value is **shown as-is** — falling back to some known
// status is exactly the step that manufactured the illusion in the previous version.

import type { DraftModel } from '@/lib/admin/draft-model';

// SubmissionState —— the values that database column takes (see
// jobsmodel/application.go). 'pending' is called committed on the UI: the
// owner has already nodded, it just hasn't been submitted yet. Withdrawn is
// not a submission state: it is the owner's decision, an outcome (roadmap 1.3.c).
export type SubmissionState = 'committed' | 'submitted' | 'failed';

export const SUBMISSION_STATES: readonly SubmissionState[] = ['committed', 'submitted', 'failed'];

// STATE_BY_WIRE —— backend literal → UI word. Absence isn't an error state, it's "an unrecognized value", see submissionLabel.
const STATE_BY_WIRE: Record<string, SubmissionState> = {
  pending: 'committed',
  submitted: 'submitted',
  failed: 'failed',
};

// Outcome —— what came of an application, set by the owner (roadmap 1.3). The column's CHECK
// holds exactly these.
export const OUTCOMES = ['none', 'responded', 'interview', 'offer', 'rejected', 'hired', 'withdrawn'] as const;

const OUTCOME_LABEL_KEY: Record<string, string> = {
  none: 'applications.outcomeNone',
  responded: 'applications.outcomeResponded',
  interview: 'applications.outcomeInterview',
  offer: 'applications.outcomeOffer',
  rejected: 'applications.outcomeRejected',
  hired: 'applications.outcomeHired',
  withdrawn: 'applications.outcomeWithdrawn',
};

// outcomeLabelKey —— the adminJobs sub-key for an outcome's word.
export function outcomeLabelKey(wire: string): string {
  return OUTCOME_LABEL_KEY[wire] ?? 'applications.outcomeNone';
}

// openedStamp —— "YYYY-MM-DD HH:MM" of the first open, or '' when nobody has opened it (1.1.c).
export function openedStamp(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 16).replace('T', ' ');
}

// submissionLabel —— returns an unrecognized value as-is. Better for the owner to see an unfamiliar string than for it to be labeled as some specific status.
export function submissionLabel(wire: string): string {
  return STATE_BY_WIRE[wire] ?? wire;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  // committedAt —— the moment the owner nodded (the applications row's created_at). Always real.
  committedAt: string;
  // submittedAt —— the moment actually submitted. Empty string = never recorded (always empty today).
  submittedAt: string;
  // state —— the display submission-status word; may be an unrecognized raw value.
  state: string;
  // outcome —— what came of it (none until the owner records something).
  outcome: string;
  method: string;
  contact: string;
  notes: string;
  // resumeContent —— **the exact version that was sent**. This is what the
  // detail card's snapshot block renders. This used to be `resumeDelta:
  // string` ("a punchline tailored to this job"), and across the entire
  // frontend it was only ever assigned an empty string — a field whose name
  // promised content and carried none, leaving that block with nothing but a title and blank space (F-E-23).
  resumeContent: DraftModel;
}

export interface TimelineEvent {
  t: string;
  // label —— an adminJobs translation sub-key (e.g. 'applications.timelineCommitted'),
  // not display text. The component resolves it with t(); the lib stays locale-agnostic.
  label: string;
  kind: 'accent' | 'muted' | 'faint';
}

// timelineFor —— draws only **real** events: commit (a real date) +
// submission (drawn only when a date exists, otherwise it explicitly states no record exists).
// It doesn't fabricate mailbox-tracker-style fake steps like "opened 6 hours later / recruiter replied the next day".
export function timelineFor(app: Application): TimelineEvent[] {
  return [
    { t: app.committedAt, label: 'applications.timelineCommitted', kind: 'accent' },
    app.submittedAt === ''
      ? { t: '—', label: 'applications.metaNotSubmitted', kind: 'faint' }
      : { t: app.submittedAt, label: 'applications.timelineSubmitted', kind: 'accent' },
  ];
}

// STATE_LABEL_KEY —— submission enum value → adminJobs sub-key for its display word.
// The component resolves these with t(); the enum value itself stays the logic + testid value.
export const STATE_LABEL_KEY: Record<SubmissionState, string> = {
  committed: 'applications.stateCommitted',
  submitted: 'applications.stateSubmitted',
  failed: 'applications.stateFailed',
};

// pillToneFor —— the tone class for a list row's status pill. Pulled out
// into lib/ because the presentation layer must not run if / complex
// ternaries. An unrecognized value gets an empty tone (neutral), never pretending to belong to any category.
export function pillToneFor(wire: string): string {
  return STATE_PILL_TONE[submissionLabel(wire)] ?? '';
}

const STATE_PILL_TONE: Record<string, string> = {
  committed: '',
  submitted: 'is-accent',
  failed: 'is-violet',
};
