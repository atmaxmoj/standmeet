// use-tasks —— /admin/tasks state: the job-queue overview, the job list, one job's detail, the
// periodic schedule, and the event stream (docs/design/event-bus-outbox-webhooks.md, *Admin
// "Tasks" panel*).
//
// Every display decision (which text, which fallback, terminal or not) is made here, not in the
// component: the presentation layer holds no branches, and a decision about the data is testable
// only where the data is (use-tasks.test.ts).

'use client';

import { useEffect } from 'react';
import { z } from 'zod';
import { create } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { logger } from '@/lib/logger';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import { ago, stampMinute, stampUTCMinute } from '@/lib/ui/format-time';

export const JOB_STATES = ['pending', 'running', 'retryable', 'completed', 'discarded', 'cancelled'] as const;
export type JobState = typeof JOB_STATES[number];
const TERMINAL_STATES: readonly string[] = ['completed', 'discarded', 'cancelled'];
export const ALERT_CODES = ['events_backlog', 'events_poisoned', 'jobs_discarded'] as const;
export type AlertCode = typeof ALERT_CODES[number];

// Go marshals an empty slice as null; normalize once at the entrance so every reader can treat
// the field as always present.
function list<T extends z.ZodTypeAny>(item: T) {
  return z.array(item).nullish().transform((v) => v ?? []);
}

// state is a plain string, not an enum: a new backend state must render, not blank the panel.
const JobSchema = z.object({
  id: z.number(),
  kind: z.string(),
  queue: z.string(),
  state: z.string(),
  attempt: z.number(),
  max_attempts: z.number(),
  args: z.unknown(),
  errors: list(z.object({ at: z.string(), error: z.string(), attempt: z.number() })),
  created_at: z.string(),
  scheduled_at: z.string(),
  finalized_at: z.string().nullish(),
});
export type Job = z.infer<typeof JobSchema>;

const OverviewSchema = z.object({
  jobs: z.object({
    counts: z.record(z.string(), z.number()),
    kinds: list(z.string()),
    oldest_pending_age_ns: z.number(),
    table_bytes: z.number(),
  }),
  events: z.object({
    unfanned: z.number(),
    poisoned: z.number(),
    oldest_unfanned_age_ns: z.number(),
    table_bytes: z.number(),
  }),
  alerts: list(z.string()),
});
export type TasksOverview = z.infer<typeof OverviewSchema>;

const PeriodicSchema = z.object({
  name: z.string(),
  every_ns: z.number(),
  last_run_at: z.string().nullish(),
  next_run_at: z.string().nullish(),
  last_result: z.string().nullish(),
  last_error: z.string().nullish(),
  recent: list(z.string()),
});
export type Periodic = z.infer<typeof PeriodicSchema>;

const EventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  seq: z.number(),
  owner_id: z.string().nullish(),
  type: z.string(),
  subject: z.string(),
  data: z.unknown(),
  occurred_at: z.string(),
  fanned_out_at: z.string().nullish(),
  fanout: list(z.object({ subscriber: z.string(), job_id: z.number() })),
  poisoned: z.boolean().nullish(),
  last_error: z.string().nullish(),
});
export type TaskEvent = z.infer<typeof EventSchema>;

const FanoutSchema = z.object({ subscriber: z.string(), job_id: z.number(), state: z.string() });
const EventDetailSchema = z.object({ event: EventSchema, fanout: list(FanoutSchema) });
export type EventDetail = z.infer<typeof EventDetailSchema>;

// ── stores ──────────────────────────────────────────────────

interface FilterState {
  kind: string;
  state: string;
  setKind: (kind: string) => void;
  setState: (state: string) => void;
}

// The kind filter governs the overview AND the list: the counts must describe the rows under them.
export const tasksFilterStore = create<FilterState>((set) => ({
  kind: '',
  state: '',
  setKind: (kind) => {
    set({ kind });
    void overviewStore.getState().refresh();
    void jobsStore.getState().refresh();
  },
  setState: (state) => {
    set({ state });
    void jobsStore.getState().refresh();
  },
}));

// query —— `?a=1&b=2`, dropping empty values (an empty filter means "all", not `kind=`).
export function query(params: Record<string, string>): string {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  return q === '' ? '' : `?${q}`;
}

const overviewStore = createResourceStore<TasksOverview>({
  name: 'tasks-overview',
  fetcher: () => adminAPI.get(
    `/tasks/overview${query({ kind: tasksFilterStore.getState().kind })}`, OverviewSchema,
  ),
});

const jobsStore = createResourceStore<Job[]>({
  name: 'tasks-jobs',
  fetcher: () => {
    const { kind, state } = tasksFilterStore.getState();
    return adminAPI
      .get(`/tasks${query({ kind, state, limit: '100' })}`, z.object({ jobs: list(JobSchema) }))
      .then((r) => r.jobs);
  },
});

const periodicStore = createResourceStore<Periodic[]>({
  name: 'tasks-periodic',
  fetcher: () => adminAPI
    .get('/tasks/periodic', z.object({ periodic: list(PeriodicSchema) }))
    .then((r) => r.periodic),
});

const eventsStore = createResourceStore<TaskEvent[]>({
  name: 'tasks-events',
  fetcher: () => adminAPI
    .get(`/events${query({ limit: '50' })}`, z.object({ events: list(EventSchema) }))
    .then((r) => r.events),
});

function refreshJobViews(): void {
  void overviewStore.getState().refresh();
  void jobsStore.getState().refresh();
}

const RUN_NOW_SETTLE_MS = 1_500;

interface DetailState {
  job: Job | null;
  // selected —— the row the owner last clicked (the detail may still be loading).
  selected: number | null;
  event: EventDetail | null;
  openJob: (id: number) => Promise<void>;
  pollJob: (id: number) => Promise<void>;
  act: (verb: 'retry' | 'cancel') => Promise<void>;
  openEvent: (id: string) => Promise<void>;
  requeueEvent: () => Promise<void>;
  runPeriodic: (name: string) => Promise<void>;
}

// tasksDetailStore —— the one open job + the one open event. Mutations throw; the component
// wraps them in useAction so a refusal surfaces as a toast.
export const tasksDetailStore = create<DetailState>((set, get) => ({
  job: null,
  selected: null,
  event: null,
  // openJob —— the previous detail goes away AT ONCE: while the new one loads, its Retry/Cancel
  // buttons must not stay on screen, or a quick click acts on the job the owner just left.
  // A late answer for a job that is no longer selected is dropped.
  openJob: async (id) => {
    set({ job: null, selected: id });
    const job = await adminAPI.get(`/tasks/${id}`, JobSchema);
    get().selected === id && set({ job });
  },
  pollJob: async (id) => {
    const job = await adminAPI.get(`/tasks/${id}`, JobSchema);
    // The owner may have opened another job while this poll was in flight.
    get().job?.id === id && set({ job });
    isTerminal(job.state) && refreshJobViews();
  },
  act: async (verb) => {
    const id = get().job?.id;
    if (id === undefined) return;
    set({ job: await adminAPI.post(`/tasks/${id}/${verb}`, {}, JobSchema) });
    refreshJobViews();
  },
  openEvent: async (id) => {
    set({ event: await adminAPI.get(`/events/${id}`, EventDetailSchema) });
  },
  // requeueEvent —— a poisoned event back in line; the relay fans it out at once, so re-read it.
  requeueEvent: async () => {
    const id = get().event?.event.id;
    if (id === undefined) return;
    await adminAPI.post(`/events/${id}/requeue`, {}, z.object({ requeued: z.boolean() }));
    void overviewStore.getState().refresh();
    void eventsStore.getState().refresh();
    await get().openEvent(String(id));
  },
  runPeriodic: async (name) => {
    await adminAPI.post(
      `/tasks/periodic/${encodeURIComponent(name)}/run`, {},
      z.object({ queued: z.boolean(), name: z.string() }),
    );
    // The run is queued, not done: give it a moment before reading its new last-run stamp.
    setTimeout(() => { void periodicStore.getState().refresh(); }, RUN_NOW_SETTLE_MS);
  },
}));

export const JOB_POLL_MS = 2_000;

// useJobPolling —— while the open job is not terminal, re-read it every 2s so a retried job's
// state reaches `completed` on screen without a reload.
function useJobPolling(job: Job | null): void {
  const id = job?.id;
  const live = job !== null && !isTerminal(job.state);
  useEffect(() => {
    if (!live || id === undefined) return undefined;
    const timer = setInterval(() => {
      tasksDetailStore.getState().pollJob(id).catch((e: unknown) => {
        logger.warn('tasks: job poll failed; retrying next tick', e);
      });
    }, JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [id, live]);
}

export interface TasksHook {
  // overview —— null until loaded (a `0` while the request is in flight is a number the data
  // never said).
  overview: TasksOverview | null;
  kinds: string[];
  jobs: { status: ResourceStatus; data: Job[] };
  periodic: { status: ResourceStatus; data: Periodic[] };
  events: { status: ResourceStatus; data: TaskEvent[] };
  error: string | null;
}

// openJobParam —— `?job=<id>` (a link from another page, e.g. the webhook delivery log) → the job
// to open on mount; anything else opens nothing.
export function openJobParam(raw: string | null): number | null {
  const id = Number(raw ?? '');
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function useTasks(openID: number | null = null): TasksHook {
  const overview = useResource(overviewStore);
  const jobs = useResource(jobsStore);
  const periodic = useResource(periodicStore);
  const events = useResource(eventsStore);
  const job = tasksDetailStore((s) => s.job);
  // refresh, not ensureLoaded: the queue is live, and a revisit must not serve the last snapshot.
  useEffect(() => {
    tasksDetailStore.setState({ job: null, selected: null, event: null });
    void overviewStore.getState().refresh();
    void jobsStore.getState().refresh();
    void periodicStore.getState().refresh();
    void eventsStore.getState().refresh();
    if (openID !== null) {
      tasksDetailStore.getState().openJob(openID).catch((e: unknown) => {
        logger.warn('tasks: the linked job could not be opened', e);
      });
    }
  }, [openID]);
  useJobPolling(job);
  return {
    overview: overview.status === 'ready' ? overview.data ?? null : null,
    kinds: overview.data?.jobs.kinds ?? [],
    jobs: { status: jobs.status, data: jobs.data ?? [] },
    periodic: { status: periodic.status, data: periodic.data ?? [] },
    events: { status: events.status, data: events.data ?? [] },
    error: overview.error ?? jobs.error ?? periodic.error ?? events.error,
  };
}

// ── pure view helpers (tested in use-tasks.test.ts) ─────────

const DASH = '—';

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state);
}

// durationText —— nanoseconds → the largest whole unit: `12s` / `3m` / `2h` / `4d`. Zero or
// negative means "none" and reads as a dash, never as `0s`.
export function durationText(ns: number): string {
  if (!(ns > 0)) return DASH;
  const s = Math.floor(ns / 1e9);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function countText(overview: TasksOverview, state: JobState): string {
  return String(overview.jobs.counts[state] ?? 0);
}

// kindOptions —— the kinds the overview knows, plus the selected one (a kind whose jobs all aged
// out must stay selectable, or the select would silently snap back to "all").
export function kindOptions(kinds: readonly string[], selected: string): string[] {
  return [...new Set(selected === '' ? kinds : [...kinds, selected])];
}

// activeAlerts —— only the codes the catalog can translate; an unknown code is not shown raw.
export function activeAlerts(alerts: readonly string[]): AlertCode[] {
  return ALERT_CODES.filter((c) => alerts.includes(c));
}

export interface JobRowView { id: number; kind: string; state: string; attempts: string; created: string }

export function jobRowView(job: Job): JobRowView {
  return {
    id: job.id, kind: job.kind, state: job.state,
    attempts: `${job.attempt}/${job.max_attempts}`,
    created: ago(job.created_at),
  };
}

export interface JobDetailView {
  state: string;
  attempts: string;
  nextRun: string;
  args: string;
  errors: { key: string; attempt: number; at: string; error: string }[];
}

export function jobDetailView(job: Job): JobDetailView {
  return {
    state: job.state,
    attempts: `${job.attempt}/${job.max_attempts}`,
    nextRun: isTerminal(job.state) ? DASH : stampMinute(job.scheduled_at),
    args: JSON.stringify(job.args ?? {}, null, 2),
    errors: job.errors.map((e, i) => ({
      key: `${i}-${e.at}`, attempt: e.attempt, at: stampMinute(e.at), error: e.error,
    })),
  };
}

export interface PeriodicView {
  name: string;
  every: string;
  lastAt: string;
  lastRun: string;
  nextRun: string;
  result: string;
  failed: boolean;
  recent: { iso: string; text: string }[];
}

// periodicView —— last/next run as minute stamps (a digit is always shown, unlike `just now`);
// the history as UTC stamps for a copyable audit trail.
export function periodicView(p: Periodic): PeriodicView {
  const last = p.last_run_at ?? '';
  const next = p.next_run_at ?? '';
  const err = p.last_error ?? '';
  return {
    name: p.name,
    every: durationText(p.every_ns),
    lastAt: last,
    lastRun: last === '' ? DASH : stampMinute(last),
    nextRun: next === '' ? DASH : stampMinute(next),
    result: err === '' ? (p.last_result ?? '') : err,
    failed: err !== '',
    recent: p.recent.map((iso) => ({ iso, text: stampUTCMinute(iso) })),
  };
}

export type EventStatus = 'poisoned' | 'fanned' | 'pending';

export interface EventRowView { id: string; type: string; subject: string; when: string; status: EventStatus }

export function eventRowView(e: TaskEvent): EventRowView {
  return {
    id: String(e.id), type: e.type, subject: e.subject, when: ago(e.occurred_at),
    status: eventStatus(e),
  };
}

function eventStatus(e: TaskEvent): EventStatus {
  if (e.poisoned === true) return 'poisoned';
  return (e.fanned_out_at ?? '') === '' ? 'pending' : 'fanned';
}
