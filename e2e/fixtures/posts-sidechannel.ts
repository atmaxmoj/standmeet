// posts-sidechannel.ts —— the channel readers of posts-no-side-channel.spec.ts (posts-tests.md § B):
// every place post text could leave the instance without a reader asking for it, read the way the
// receiving end sees it — the index's documents, the webhook sink, the owner's mailbox, the bot's
// outbox, the model gateway's request log.

import { execFileSync } from 'node:child_process';

import { expect, type APIRequestContext } from '@playwright/test';

import { DB_CONTAINER } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { lastGatewayRequest, scriptMockParallelToolCalls } from '@/fixtures/mock-llm-script';
import type { PostsOwner } from '@/fixtures/posts';
import { ownerTypes, sentTo, type SentMessage } from '@/fixtures/telegram';

// The stack's Meili container: same compose project as the database (fixtures/instance.ts).
const MEILI_CONTAINER = DB_CONTAINER.replace(/-db-1$/, '-meilisearch-1');
const MEILI_KEY = 'standmeet_dev_meili_key';

function meili(path: string): string {
  return execFileSync('docker', ['exec', MEILI_CONTAINER, 'curl', '-fsS',
    '-H', `Authorization: Bearer ${MEILI_KEY}`, `http://localhost:7700${path}`],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

// meiliText —— every document of every index, as one raw text. Read whole, so the spec does not
// depend on which index (or which field) posts land in.
export function meiliText(): string {
  const indexes = (JSON.parse(meili('/indexes?limit=1000')) as { results: { uid: string }[] }).results;
  return indexes.map((i) => meili(`/indexes/${i.uid}/documents?limit=100000`)).join('\n');
}

// readsTurn —— script one turn that reads each given post by path in parallel; returns the tag.
export async function readsTurn(request: APIRequestContext, ids: string[]): Promise<string> {
  return scriptMockParallelToolCalls(request,
    ids.map((id) => ({ name: 'corpus_read', args: { path: `posts/${id}` } })));
}

// modelSaw —— did the model request of the turn carrying `tag` contain each marker.
export async function modelSaw(
  request: APIRequestContext, tag: string, marks: Record<string, string>,
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const [k, m] of Object.entries(marks)) {
    out[k] = (await lastGatewayRequest(request, tag, m)).contains;
  }
  return out;
}

// notifyByMail —— an email notification rule on `eventType` with a template naming every variable
// a card could plausibly offer for a post (an unknown name stays literal, so none can be missed).
export async function notifyByMail(o: PostsOwner, eventType: string, mark: string): Promise<void> {
  await callTool(o.request, o.apiToken, o.sid, 'notify.create_rule', {
    event_type: eventType, channel: 'email',
    template: `${mark} {event} {subject} {body} {excerpt} {text} {title} {summary}`,
  });
}

// imVisitorAsks —— a person in Telegram chat `chat` opens a session with `code` (the bridge's
// `/start CODE`), then asks `question`; returns every message the bot sent that chat.
export async function imVisitorAsks(
  request: APIRequestContext, chat: number, code: string, question: string,
): Promise<SentMessage[]> {
  // The bridge picks the bot up once connected; keep sending until it answers the code.
  await expect.poll(async () => {
    if ((await sentTo(request, chat)).length === 0) await ownerTypes(request, chat, `/start ${code}`);
    return (await sentTo(request, chat)).length;
  }, { timeout: 120_000, intervals: [5_000], message: 'the bot never answered the code' })
    .toBeGreaterThan(0);
  const before = (await sentTo(request, chat)).length;
  await ownerTypes(request, chat, question);
  await expect.poll(async () => (await sentTo(request, chat)).length,
    { timeout: 90_000, message: 'the bot never answered the question' }).toBeGreaterThan(before);
  return sentTo(request, chat);
}

// liveTokenIn —— the /live/<token> of a notification mail body.
export function liveTokenIn(text: string): string {
  return /\/live\/([A-Za-z0-9._-]+)/.exec(text)?.[1] ?? '';
}

// reportIDIn —— the report id a summarize turn's stream carries (escaped or plain JSON).
export function reportIDIn(sse: string): string {
  return (/\\"report_id\\":\\"([0-9a-f-]{36})\\"/.exec(sse)
    ?? /"report_id":"([0-9a-f-]{36})"/.exec(sse))?.[1] ?? '';
}

// POSTS_PAGE —— a microsite whose whole content is the SDK timeline.
export const POSTS_PAGE = `
import { Posts, StandMeetProvider } from '@standmeet/sdk';

export default function App() {
  return (
    <StandMeetProvider baseURL="">
      <main data-testid="microsite">
        <h1>Updates</h1>
        <Posts />
      </main>
    </StandMeetProvider>
  );
}
`.trim();
