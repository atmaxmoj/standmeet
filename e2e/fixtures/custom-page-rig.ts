// custom-page-rig.ts —— 建一个**真的用 SDK** 的自定义页并上线。
//
// 为什么页面源码要在这里，而不是各 spec 里粘一份：判据是「页面上的 agent 就是这张码的
// agent」，那么这一页必须真的走 SDK 的那条路（`useChatSession` → 接手已颁发的 session →
// `/api/v1/agent/turn`）。一个只印一行字的页面能让每一条断言绿，而它证明的东西是零
// （[[test-covers-capability-not-face]]）。
//
// 页面上的每个可断点都带 data-sm：断的是这一页给出了什么，不是它长什么样。

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// ASK_PAGE —— 语料索引 + 问答栏。三样都真：
//   - `useStandMeet().fetchPage()` 取 owner 的语料（读者看得到什么由后端按角色定）
//   - `useChatSession()` 走 agent turn（接手已颁发的 session）
//   - `byoaiOffered()` 决定给不给「自带 key」那条路
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
  const res = await request[method](`${BACKEND}/api/admin/custom-pages${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

// publishPage —— 建 → 写源码 → 构建到终态 → 上线。构建**必须**到 built：
// 一个没上线的页面 404，而 404 会让后面每一条断言以另一种理由红，
// 那种红读起来跟真缺陷一样（[[red-in-the-wrong-place]]）。
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
    // 180s 是**排队**预算：沙箱一次只建一个，这一族里好几条用例都要真构建。
  }, { timeout: 180_000, message: 'the build never settled' }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await pageAPI(request, csrf, 'post', `/${slug}/live`, { build_id: id });
  expect(live.status, 'promote to live').toBe(200);
}

// setPageByoai —— 这一页允不允许读者自带 key。
export async function setPageByoai(
  request: APIRequestContext, csrf: string, slug: string, allow: boolean,
): Promise<void> {
  const res = await pageAPI(request, csrf, 'put', `/${slug}/byoai`, { allow_byoai: allow });
  expect(res.status, 'set page byoai').toBe(200);
}

// bindCodeToPage —— 把一张码指向某一页；空 slug = 解绑。
export async function bindCodeToPage(
  request: APIRequestContext, csrf: string, codeID: string, slug: string,
): Promise<void> {
  const res = await request.patch(`${BACKEND}/api/admin/codes/${codeID}/custom-page`, {
    headers: { 'X-Csrftoken': csrf }, data: { slug },
  });
  expect(res.status(), 'bind code to page').toBe(200);
  expect((await res.json() as { custom_page_slug: string }).custom_page_slug,
    'the receipt reads the binding back').toBe(slug);
}
