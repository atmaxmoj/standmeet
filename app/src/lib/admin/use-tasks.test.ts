// use-tasks.test.ts —— the Tasks panel's display decisions, checked without a backend.

import { describe, expect, it } from 'vitest';

import {
  activeAlerts, durationText, jobDetailView, kindOptions, openJobParam, periodicView, query, type Job,
} from '@/lib/admin/use-tasks';

describe('openJobParam', () => {
  it('opens a positive integer id and nothing else', () => {
    expect(openJobParam('42')).toBe(42);
    expect([null, '', '0', '-3', '1.5', 'abc'].map(openJobParam)).toEqual([null, null, null, null, null, null]);
  });
});

const S = 1e9;

const JOB: Job = {
  id: 7, kind: 'corpus.index', queue: 'default', state: 'retryable', attempt: 2, max_attempts: 5,
  args: { id: 'x' },
  errors: [{ at: '2026-09-26T10:00:00Z', error: 'dial tcp: connection refused', attempt: 1 }],
  created_at: '2026-09-26T09:59:00Z', scheduled_at: '2026-09-26T10:05:00Z',
};

describe('durationText', () => {
  it('uses the largest whole unit, and a dash for none', () => {
    expect(durationText(12 * S)).toBe('12s');
    expect(durationText(185 * S)).toBe('3m');
    expect(durationText(2 * 3600 * S + 5)).toBe('2h');
    expect(durationText(3 * 86400 * S)).toBe('3d');
    expect(durationText(0)).toBe('—');
  });
});

describe('jobDetailView', () => {
  it('shows the next run for a live job and a dash for a terminal one', () => {
    expect(jobDetailView(JOB).nextRun).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(jobDetailView({ ...JOB, state: 'completed' }).nextRun).toBe('—');
    expect(jobDetailView(JOB).errors.map((e) => e.error)).toEqual(['dial tcp: connection refused']);
  });
});

describe('periodicView', () => {
  it('renders history as UTC minute stamps and keeps the raw last-run stamp', () => {
    const v = periodicView({
      name: 'corpus reindex', every_ns: 300 * S, last_run_at: '2026-09-26T10:15:42Z',
      recent: ['2026-09-26T10:15:42Z'],
    });
    expect(v.lastAt).toBe('2026-09-26T10:15:42Z');
    expect(v.every).toBe('5m');
    expect(v.recent[0]?.text).toBe('2026-09-26T10:15 UTC');
    expect(v.nextRun).toBe('—');
  });
});

describe('filters', () => {
  it('keeps a selected kind selectable and drops empty query params', () => {
    expect(kindOptions(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(kindOptions(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(query({ kind: 'corpus.index', state: '' })).toBe('?kind=corpus.index');
    expect(query({ kind: '' })).toBe('');
    expect(activeAlerts(['jobs_discarded', 'bogus'])).toEqual(['jobs_discarded']);
  });
});
