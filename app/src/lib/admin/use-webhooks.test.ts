// use-webhooks.test.ts —— the Webhooks section's display decisions, checked without a backend.

import { describe, expect, it } from 'vitest';

import {
  deliveryRowView, endpointRowView, toggleType, type Delivery, type Endpoint,
} from '@/lib/admin/use-webhooks';

const EP: Endpoint = {
  id: 'e1', url: 'https://example.com/hook', description: '',
  event_types: ['corpus.note.changed', 'webhook.test'], enabled: true, disabled_reason: '',
  failing_since: null, created_at: '2026-09-26T09:00:00Z',
};

describe('endpointRowView', () => {
  it('reads on, failing and off from the row', () => {
    expect(endpointRowView(EP)).toMatchObject({ status: 'on', reason: '', types: 'corpus.note.changed, webhook.test' });
    expect(endpointRowView({ ...EP, failing_since: new Date().toISOString() }).status).toBe('failing');
    const off = endpointRowView({ ...EP, enabled: false, disabled_reason: 'disabled after 5 days', failing_since: '2026-09-20T00:00:00Z' });
    expect(off).toMatchObject({ status: 'off', reason: 'disabled after 5 days' });
  });
});

describe('deliveryRowView', () => {
  it('shows the last attempt error, or nothing', () => {
    const d: Delivery = {
      job_id: 9, state: 'retryable', attempt: 2, event_id: 'ev', created_at: '2026-09-26T10:00:00Z',
      errors: [
        { at: '2026-09-26T10:00:05Z', error: 'webhook endpoint answered 500', attempt: 1 },
        { at: '2026-09-26T10:05:05Z', error: 'webhook endpoint answered 502', attempt: 2 },
      ],
    };
    expect(deliveryRowView(d)).toMatchObject({
      key: '9', state: 'retryable', attempt: 2, lastError: 'webhook endpoint answered 502', jobHref: '/admin/tasks?job=9',
    });
    expect(deliveryRowView({ ...d, errors: [] }).lastError).toBe('');
  });
});

describe('toggleType', () => {
  it('adds and removes a type, keeping a stable order', () => {
    expect(toggleType(['webhook.test'], 'corpus.note.changed', true)).toEqual(['corpus.note.changed', 'webhook.test']);
    expect(toggleType(['corpus.note.changed', 'webhook.test'], 'webhook.test', false)).toEqual(['corpus.note.changed']);
    expect(toggleType(['a'], 'a', true)).toEqual(['a']);
  });
});
