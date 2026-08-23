import { useEffect, useState } from "react";
import {
  StandMeetProvider, useStandMeet, useChatSession, AnswerText,
} from "@standmeet/sdk";

type Card = { wiki_id: string; title: string; excerpt: string; path: string };
type Page = {
  owner: { handle: string; full_name: string; location: string };
  content: { hero_prose: string; insights: readonly Card[]; projects: readonly Card[] };
};
type Note = {
  title: string; body: string; excerpt: string; path: string;
  updated_at: string; tags: readonly string[];
};

const CSS = `
:root{--paper:#F3EFE6;--ink:#1B1814;--red:#B5391C;--rule:#D7CEB9;--muted:#6F6558}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:Newsreader,Georgia,serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:78rem;margin:0 auto;padding:clamp(2rem,5vw,5rem) clamp(1.25rem,4vw,3.5rem)}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace;
  font-size:.63rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.masthead{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.name{font-size:clamp(2.4rem,6vw,4rem);line-height:.95;letter-spacing:-.025em;margin:.35rem 0 0}
.rule{height:2px;background:var(--red);margin:1.1rem 0 0;width:100%}
.cols{display:grid;grid-template-columns:1fr;gap:clamp(2rem,5vw,4rem);margin-top:clamp(2rem,5vw,3.5rem)}
@media(min-width:62rem){.cols{grid-template-columns:1.62fr 1fr;align-items:start}}
.prose{font-size:clamp(1.12rem,1.6vw,1.35rem);line-height:1.55;max-width:34em;margin:0 0 2.6rem}
@media(min-width:62rem){.prose{margin-left:-2.2rem}}
.sechead{display:flex;align-items:baseline;gap:.7rem;margin:0 0 .4rem}
.sechead .n{font-variant-numeric:tabular-nums}
ol.index{list-style:none;margin:0 0 2.6rem;padding:0;border-top:1px solid var(--rule)}
li.entry{border-bottom:1px solid var(--rule);opacity:0;transform:translateY(6px);
  animation:rise .5s cubic-bezier(.22,1,.36,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}
button.row{width:100%;display:flex;align-items:baseline;gap:.6rem;background:none;border:0;
  padding:.85rem .1rem;cursor:pointer;text-align:left;color:inherit;font:inherit}
.t{font-size:1.06rem;letter-spacing:-.01em}
.leader{flex:1;border-bottom:1px dotted var(--rule);transform:translateY(-.28rem)}
button.row:hover .leader{border-bottom-color:var(--red)}
button.row:hover .t{color:var(--red)}
.ex{margin:0 0 .9rem;color:var(--muted);font-size:.95rem;line-height:1.5;max-width:44em}
.note{border-left:2px solid var(--red);padding:.2rem 0 .2rem 1.1rem;margin:0 0 2.2rem}
.note h3{margin:.2rem 0 .5rem;font-size:1.5rem;letter-spacing:-.02em}
.note .body{line-height:1.62;margin:0 0 .85rem;max-width:40em}
.out{display:inline-block;color:var(--red);text-decoration:none;border-bottom:1px solid transparent}
.out:hover{border-bottom-color:var(--red)}
.rail{position:sticky;top:2rem}
.ask{border-top:2px solid var(--ink);padding-top:.9rem}
.ask input{width:100%;background:none;border:0;border-bottom:1px solid var(--rule);
  padding:.55rem 0;font:inherit;font-size:1.05rem;color:inherit;outline:none}
.ask input:focus{border-bottom-color:var(--red)}
.ask input::placeholder{color:var(--muted)}
.turn{margin-top:1.5rem}
.q{font-style:italic;color:var(--muted);margin:0 0 .45rem;line-height:1.45}
.a{margin:0;line-height:1.6}
.a::before{content:"—";color:var(--red);margin-right:.45rem}
.tags{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.7rem}
.dead{color:var(--muted);font-size:.95rem;line-height:1.55;max-width:34em}
`;

function Index({ label, n, cards, onOpen }: {
  label: string; n: number; cards: readonly Card[]; onOpen: (c: Card) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section>
      <div className="sechead">
        <span className="mono">{label}</span>
        <span className="mono n">{String(n).padStart(2, "0")}</span>
      </div>
      <ol className="index">
        {cards.map((c, i) => (
          <li key={c.wiki_id} className="entry" style={{ animationDelay: `${i * 55}ms` }}>
            <button type="button" className="row" onClick={() => onOpen(c)}>
              <span className="t">{c.title}</span>
              <span className="leader" />
              <span className="mono">read</span>
            </button>
            <p className="ex">{c.excerpt}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Reader({ note }: { note: Note | null }) {
  if (!note) return null;
  return (
    <article className="note">
      <div className="mono">from the corpus · {note.updated_at.slice(0, 10)}</div>
      <h3>{note.title}</h3>
      {/* 只渲摘要，全文给到实例自己的阅读器。
          原因不是偷懒：`AnswerText` 认的是**行内**标记，笔记正文是完整 markdown ——
          直接印会把 `#` 标题、`>` 引用、`[链接](…)` 原样摆给读者，那不是"没样式"，
          那是把源码当正文。而 SDK 里没有块级渲染器（见 F-P-1）。
          在缺的东西补上之前，页面**明说自己只给引子**，比假装能读全文诚实。 */}
      <AnswerText text={note.excerpt} paragraphClassName="body" />
      <a className="mono out" href={`/wiki/${note.path}`}>read it in full ↗</a>
      <div className="tags">
        {note.tags.map((t) => <span key={t} className="mono">#{t}</span>)}
      </div>
    </article>
  );
}

function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const [draft, setDraft] = useState("");
  // 按 role 走，不按下标配对：消息形状是 {id, role, text}，
  // 第一版我照常见约定写了 .content，于是问和答都渲成空串。
  const turns: { q: string; a: string }[] = [];
  for (const m of chat.messages) {
    if (m.role === "visitor") turns.push({ q: m.text, a: "" });
    else if (turns.length > 0) turns[turns.length - 1]!.a = m.text;
  }
  return (
    <div className="rail">
      <div className="mono">ask · answered from the corpus</div>
      <div className="ask">
        <input
          value={draft}
          placeholder={chat.streaming ? "thinking…" : "ask anything"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || draft.trim() === "" || chat.streaming) return;
            const t = draft;
            setDraft("");
            void chat.send(t);
          }}
        />
      </div>
      {turns.map((t, i) => (
        <div className="turn" key={i}>
          <p className="q">{t.q}</p>
          <div className="a"><AnswerText text={t.a} /></div>
        </div>
      ))}
      {chat.error ? <p className="turn dead">{chat.error}</p> : null}
    </div>
  );
}

function Room() {
  const sm = useStandMeet();
  const [page, setPage] = useState<Page | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => { void sm.fetchPage().then(setPage as never).catch(() => setPage(null)); }, [sm]);
  if (!page) return <div className="wrap mono">loading the room…</div>;
  const { insights, projects } = page.content;
  const open = (c: Card) => {
    void sm.fetchWikiLanding(c.path).then(setNote as never).catch(() => setNote(null));
  };
  const empty = insights.length === 0 && projects.length === 0;
  return (
    <div className="wrap">
      <header>
        <div className="masthead">
          <div>
            <span className="mono">a reading room</span>
            <h1 className="name">{page.owner.full_name}</h1>
          </div>
          <span className="mono">{page.owner.location}</span>
        </div>
        <div className="rule" />
      </header>
      <div className="cols">
        <main>
          <p className="prose">{page.content.hero_prose}</p>
          <Reader note={note} />
          <Index label="insights" n={insights.length} cards={insights} onOpen={open} />
          <Index label="projects" n={projects.length} cards={projects} onOpen={open} />
          {empty ? (
            <p className="dead">
              Nothing is pinned yet. Pin a published wiki entry to insights or projects
              and it becomes an entry in this index — title, excerpt, and the note itself
              when a reader opens it.
            </p>
          ) : null}
        </main>
        <aside><Ask /></aside>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StandMeetProvider baseURL="">
      <style>{CSS}</style>
      <Room />
    </StandMeetProvider>
  );
}
