// event-actions.ts —— the visitor-side actions webhook-event-types.spec performs through the public
// API (/api/v1/*), the same calls the gate form, the chat's ghost chip and a microsite's store
// widget make. Each asserts its own success, so a spec waiting for the event never waits on a
// write that was refused.

import { expect, type APIRequestContext } from '@playwright/test';

import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

/** A visitor asks for access from the gate (its own source IP, so the per-IP guard is its own). */
export async function submitAccessRequest(
  api: APIRequestContext, email: string, ip: string,
): Promise<void> {
  const res = await api.post(`${BACKEND}/api/v1/access-requests`, {
    headers: { 'X-Forwarded-For': ip },
    data: { name: 'Eve', org: 'Acme', email, message: 'may I talk to you?' },
  });
  expect(res.status(), 'access request accepted').toBeLessThan(300);
}

/** The chat shows a suggested question, and the visitor takes it. */
export async function showAndAcceptGhost(
  api: APIRequestContext, sess: VisitorSession,
): Promise<void> {
  const auth = { Authorization: `Bearer ${sess.session_token}` };
  const shown = await api.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/ghosts/shown`, {
    headers: auth, data: { ghost_text: 'What are you building?', source: 'initial', turn_index: 0 },
  });
  expect(shown.status(), 'ghost shown recorded').toBeLessThan(300);
  const { id } = await shown.json() as { id: string };
  const accepted = await api.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/ghosts/${id}/accept`, { headers: auth },
  );
  expect(accepted.status(), 'ghost accepted').toBeLessThan(300);
}

/** A microsite's page writes one document into its own store. */
export async function insertPageDoc(
  api: APIRequestContext, slug: string, collection: string, doc: Record<string, unknown>,
): Promise<void> {
  const res = await api.post(`${BACKEND}/api/v1/pages/${slug}/store`, { data: { collection, doc } });
  expect(res.status(), 'page document stored').toBeLessThan(300);
}
