// microsite-rig.ts —— build a custom page that **really uses the SDK** and put
// it live.
//
// Why the page source lives here rather than being pasted into each spec: the
// criterion is "the agent on the page is this code's agent", so this page must
// really take the SDK's path (`useChatSession` → take over an issued session →
// `/api/v1/agent/turn`). A page that just prints one line makes every assertion
// green while proving nothing ([[test-covers-capability-not-face]]).
//
// Every assertable point on the page carries data-sm: the assertion is about what
// the page produces, not what it looks like.

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// ASK_PAGE —— corpus index + an ask box. All three are real:
//   - `useStandMeet().fetchPage()` fetches the owner's corpus (what the reader
//     sees is decided by the backend per role)
//   - `useChatSession()` takes the agent-turn path (taking over an issued session)
//   - `byoaiOffered()` decides whether to offer the "bring your own key" path
const ASK_PAGE = `
import { useEffect, useState } from "react";
import { StandMeetProvider, useStandMeet, useChatSession } from "@standmeet/sdk";
import { byoaiOffered, hasVisitorGrant } from "@standmeet/sdk-core";

function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const [draft, setDraft] = useState("");
  const answer = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return (
    <div>
      <input
        data-sm="ask"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || draft.trim() === "") return;
          const t = draft; setDraft(""); void chat.send(t);
        }}
      />
      <div data-sm="answer">{answer ? answer.text : ""}</div>
      <div data-sm="error">{chat.error ?? ""}</div>
      <div data-sm="grant">{hasVisitorGrant() ? "on a code" : "no code"}</div>
      {byoaiOffered() ? <a data-sm="byok" href="/gate">bring your own key</a> : null}
    </div>
  );
}

// Hosted —— **实例自己在服务的那份素材**。地址是签名的、一小时过期，所以只能在
// 运行时取；素材挂在语料条目上，取它的路径就是「取那条笔记，读它的 assets」。
function Hosted() {
  const sm = useStandMeet();
  const path = new URL(window.location.href).searchParams.get("shot");
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    if (!path) return;
    void sm.fetchWikiLanding(path)
      .then((n) => setAsset((n?.assets ?? []).find((a) => a.content_type.startsWith("image/")) ?? null))
      .catch(() => setAsset(null));
  }, [sm, path]);
  if (!asset) return <div data-sm="hosted-state">none</div>;
  return (
    <div>
      <div data-sm="hosted-state">ready</div>
      <img data-sm="hosted" src={asset.url} alt={asset.original_filename} />
      <div data-sm="hosted-name">{asset.original_filename}</div>
    </div>
  );
}

// Reader —— 打开语料里的一条。**这一页只能给出读者自己读得到的东西**：
// 取不到就明说取不到，不留一个说不清是"还没到"还是"不给你看"的空白。
function Reader() {
  const sm = useStandMeet();
  const path = new URL(window.location.href).searchParams.get("read");
  const [state, setState] = useState("idle");
  const [note, setNote] = useState(null);
  useEffect(() => {
    if (!path) return;
    setState("loading");
    void sm.fetchWikiLanding(path)
      .then((n) => { setNote(n); setState(n ? "open" : "denied"); })
      .catch(() => { setNote(null); setState("denied"); });
  }, [sm, path]);
  return (
    <section>
      <div data-sm="note-state">{state}</div>
      <div data-sm="note">{note ? note.title : ""}</div>
    </section>
  );
}

function Room() {
  const sm = useStandMeet();
  const [page, setPage] = useState(null);
  useEffect(() => { void sm.fetchPage().then(setPage).catch(() => setPage(null)); }, [sm]);
  const cards = page
    ? [...page.content.insights, ...page.content.projects]
    : [];
  return (
    <main>
      <h1 data-sm="marker">PAGE_IS_A_RENDERING</h1>
      <ol data-sm="corpus">
        {cards.map((c) => <li key={c.wiki_id} data-sm-title={c.title}>{c.title}</li>)}
      </ol>
      <Reader />
      <Hosted />
      <Ask />
    </main>
  );
}

export default function App() {
  return <StandMeetProvider baseURL=""><Room /></StandMeetProvider>;
}
`.trim();

async function pageAPI(
  request: APIRequestContext, csrf: string,
  method: 'get' | 'post' | 'put' | 'delete', path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin/microsites${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

// publishPage —— create → write source → build to a terminal state → go live.
// The build **must** reach built: a page that isn't live 404s, and a 404 turns
// every later assertion red for a different reason, a red that reads just like a
// real defect ([[red-in-the-wrong-place]]).
export async function publishPage(
  request: APIRequestContext, csrf: string, slug: string, source = ASK_PAGE,
): Promise<void> {
  await pageAPI(request, csrf, 'post', '/', { slug, title: slug });
  await pageAPI(request, csrf, 'put', `/${slug}/files`, { path: 'App.tsx', content: source });
  const started = await pageAPI(request, csrf, 'post', `/${slug}/build`);
  expect(started.status, 'start build').toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await pageAPI(request, csrf, 'get', `/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
    // 180s is a **queueing** budget: the sandbox builds one at a time, and
    // several cases in this family each need a real build.
  }, { timeout: 180_000, message: 'the build never settled' }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await pageAPI(request, csrf, 'post', `/${slug}/live`, { build_id: id });
  expect(live.status, 'promote to live').toBe(200);
}

// setPageByoai —— whether this page lets readers bring their own key.
export async function setPageByoai(
  request: APIRequestContext, csrf: string, slug: string, allow: boolean,
): Promise<void> {
  const res = await pageAPI(request, csrf, 'put', `/${slug}/byoai`, { allow_byoai: allow });
  expect(res.status, 'set page byoai').toBe(200);
}

// bindCodeToPage —— point a code at a page; an empty slug = unbind.
export async function bindCodeToPage(
  request: APIRequestContext, csrf: string, codeID: string, slug: string,
): Promise<void> {
  const res = await request.patch(`${BACKEND}/api/admin/codes/${codeID}/microsite`, {
    headers: { 'X-Csrftoken': csrf }, data: { slug },
  });
  expect(res.status(), 'bind code to page').toBe(200);
  expect((await res.json() as { microsite_slug: string }).microsite_slug,
    'the receipt reads the binding back').toBe(slug);
}
