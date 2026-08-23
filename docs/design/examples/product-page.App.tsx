// product-page.App.tsx —— **这一页存在的理由是证明天花板在哪里。**
//
// 托管页跑的是一次真的 vite 构建，产物由实例自己服务，**没有任何 CSP**。所以页面能放的
// 东西跟一张普通网页完全一样：远端图片、远端视频、远端音频、iframe、远端字体、CSS 动画、
// 自己的布局。媒体全部走 **URL**，一个字节都不进构建产物 —— 换一张图不用重新构建。
//
// 同时它还是一张**活的**页：语料从实例读（`fetchPage` / `fetchWikiLanding`），
// 问答走这张码自己的 agent（`useChatSession` 接手已颁发的 session）。
// 一张既是商品页又能回答问题的页 —— 这是 WordPress 那一侧做不到的那半。

import { useEffect, useRef, useState } from "react";
import { StandMeetProvider, useStandMeet, useChatSession, AnswerText } from "@standmeet/sdk";
import { byoaiOffered, hasVisitorGrant } from "@standmeet/sdk-core";

type Card = { wiki_id: string; title: string; excerpt: string; path: string };
// Landing —— 取回一条语料时拿到的东西。`assets` 是挂在它上面的文件（签名地址，一小时有效）。
type Asset = {
  asset_id: string; kind: string; content_type: string;
  original_filename: string; url: string; size_bytes: number;
};
type Landing = { title: string; excerpt: string; path: string; assets?: readonly Asset[] };
type Page = {
  owner: { handle: string; full_name: string; location: string };
  content: { hero_prose: string; insights: readonly Card[]; projects: readonly Card[] };
};

// 远端素材。**全是 URL** —— 构建产物里没有一个字节的媒体。
const MEDIA = {
  video: "https://mdn.github.io/shared-assets/videos/flower.mp4",
  poster: "https://picsum.photos/id/1043/1600/900",
  audio: "https://mdn.github.io/shared-assets/audio/t-rex-roar.mp3",
  shots: [
    { src: "https://picsum.photos/id/1015/900/1200", alt: "reader, paginated" },
    { src: "https://picsum.photos/id/1025/900/900", alt: "vocabulary sidebar" },
    { src: "https://picsum.photos/id/1039/1400/900", alt: "spaced repetition" },
    { src: "https://picsum.photos/id/1062/900/1200", alt: "audiobook karaoke" },
  ],
  portrait: "https://picsum.photos/id/1005/400/400",
  // 这里**没有**那张海报的地址 —— 它已经不是远端素材了。
  // 它经 `assets.upload` 被拉进实例自己的存储，页面运行时从语料上取（见 <Hosted/>）。
  // 顺便记下那次踩的坑：owner 递过来的是 `zh.wikipedia.org/wiki/File:…`，那是**说明页**
  // 不是图；真文件在 `upload.wikimedia.org/…`，要问一次 API 才拿得到。
  map:
    "https://www.openstreetmap.org/export/embed.html" +
    "?bbox=2.2241%2C48.8156%2C2.4699%2C48.9022&layer=mapnik",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..800;1,6..72,300..700&family=JetBrains+Mono:wght@400;500&display=swap');

:root{
  --paper:#F3EFE6; --ink:#1B1814; --red:#B5391C; --rule:#D7CEB9; --muted:#6F6558;
  --night:#141210;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:Newsreader,Georgia,serif;-webkit-font-smoothing:antialiased}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace;
  font-size:.63rem;letter-spacing:.2em;text-transform:uppercase}
.wrap{max-width:82rem;margin:0 auto;padding:0 clamp(1.25rem,4vw,3.5rem)}

/* ── hero：整幅视频，标题压在上面 ─────────────────────────── */
.hero{position:relative;min-height:min(86vh,52rem);overflow:hidden;background:var(--night)}
.hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5}
.hero .veil{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(20,18,16,.25) 0%,rgba(20,18,16,.85) 78%)}
.hero .inner{position:relative;display:flex;flex-direction:column;justify-content:flex-end;
  min-height:min(86vh,52rem);padding-bottom:clamp(2.5rem,6vw,5rem);color:#F6F2EA}
.eyebrow{display:flex;gap:.9rem;align-items:center;color:#C9BFAC}
.dot{width:6px;height:6px;border-radius:50%;background:var(--red);
  animation:pulse 2.4s cubic-bezier(.22,1,.36,1) infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}
h1.title{font-size:clamp(3rem,9vw,7.5rem);line-height:.86;letter-spacing:-.035em;
  margin:1.2rem 0 0;font-weight:600;max-width:14ch}
h1.title em{font-style:italic;color:#E8A38F}
.sub{font-size:clamp(1.05rem,1.7vw,1.35rem);line-height:1.5;max-width:38ch;
  margin:1.4rem 0 0;color:#DCD3C4}
.cta{display:flex;gap:1rem;flex-wrap:wrap;margin-top:2.2rem;align-items:center}
a.buy{display:inline-block;background:var(--red);color:#fff;text-decoration:none;
  padding:.85rem 1.6rem;border-radius:2px;transition:transform .4s cubic-bezier(.22,1,.36,1)}
a.buy:hover{transform:translateY(-2px)}
a.ghost{color:#F6F2EA;text-decoration:none;border-bottom:1px solid rgba(246,242,234,.35);
  padding-bottom:.2rem}
a.ghost:hover{border-bottom-color:var(--red)}
.price{font-size:1.5rem}
.price s{color:#9A9081;font-size:1rem;margin-right:.5rem}

/* ── ticker ───────────────────────────────────────────────── */
.ticker{background:var(--ink);color:#C9BFAC;overflow:hidden;white-space:nowrap;padding:.6rem 0}
.ticker span{display:inline-block;animation:slide 34s linear infinite;padding-left:100%}
@keyframes slide{to{transform:translateX(-100%)}}

/* ── 规格表 ───────────────────────────────────────────────── */
.specs{display:grid;grid-template-columns:1fr;gap:0;margin:clamp(3rem,7vw,6rem) 0 0;
  border-top:2px solid var(--ink)}
@media(min-width:52rem){.specs{grid-template-columns:repeat(4,1fr)}}
.spec{padding:1.4rem 0;border-bottom:1px solid var(--rule)}
@media(min-width:52rem){.spec{border-right:1px solid var(--rule);padding:1.6rem 1.4rem}
  .spec:first-child{padding-left:0}.spec:last-child{border-right:0}}
.spec .k{color:var(--muted)}
.spec .v{font-size:1.6rem;letter-spacing:-.02em;margin-top:.45rem;font-variant-numeric:tabular-nums}

/* ── 图廊：不等大 ─────────────────────────────────────────── */
.gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:clamp(.6rem,1.5vw,1.2rem);
  margin-top:clamp(3rem,7vw,5.5rem)}
@media(min-width:52rem){.gallery{grid-template-columns:repeat(6,1fr);
  grid-auto-rows:clamp(9rem,13vw,13rem)}}
figure{margin:0;position:relative;overflow:hidden;background:var(--rule)}
figure img{width:100%;height:100%;object-fit:cover;display:block;
  transition:transform .8s cubic-bezier(.22,1,.36,1)}
figure:hover img{transform:scale(1.04)}
figure figcaption{position:absolute;left:0;bottom:0;padding:.5rem .7rem;color:#F6F2EA;
  background:linear-gradient(0deg,rgba(20,18,16,.8),transparent);width:100%}
@media(min-width:52rem){
  .g0{grid-column:span 2;grid-row:span 2}
  .g1{grid-column:span 4;grid-row:span 2}
  .g2{grid-column:span 3}
  .g3{grid-column:span 3}
}

/* ── 分栏 ─────────────────────────────────────────────────── */
.cols{display:grid;grid-template-columns:1fr;gap:clamp(2rem,5vw,4rem);
  margin-top:clamp(3.5rem,8vw,6rem)}
@media(min-width:62rem){.cols{grid-template-columns:1.55fr 1fr;align-items:start}}
h2{font-size:clamp(1.8rem,3.4vw,2.9rem);letter-spacing:-.025em;line-height:1.05;margin:0 0 1rem}
.lede{font-size:1.18rem;line-height:1.6;max-width:36em;color:#3A342C}

/* ── 随手贴进来的一张图 ───────────────────────────────────── */
.pasted{display:flex;gap:clamp(1.2rem,3vw,2.2rem);align-items:center;
  margin-top:clamp(2.5rem,6vw,4rem);padding-top:clamp(2rem,4vw,2.5rem);
  border-top:1px solid var(--rule);flex-wrap:wrap}
.pasted img{width:clamp(9rem,14vw,13rem);height:auto;display:block;
  box-shadow:0 18px 40px -18px rgba(27,24,20,.55)}

/* ── 音频 ─────────────────────────────────────────────────── */
.audio{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap;
  border-left:2px solid var(--red);padding:1rem 0 1rem 1.2rem;margin-top:2.2rem}
.audio audio{height:2.2rem}

/* ── 语料 ─────────────────────────────────────────────────── */
ol.notes{list-style:none;margin:1.2rem 0 0;padding:0;border-top:1px solid var(--rule)}
li.note{border-bottom:1px solid var(--rule);opacity:0;transform:translateY(8px);
  animation:rise .55s cubic-bezier(.22,1,.36,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}
button.row{width:100%;display:flex;align-items:baseline;gap:.6rem;background:none;border:0;
  padding:.85rem .1rem;cursor:pointer;text-align:left;color:inherit;font:inherit}
.leader{flex:1;border-bottom:1px dotted var(--rule);transform:translateY(-.28rem)}
button.row:hover .leader{border-bottom-color:var(--red)}
button.row:hover .t{color:var(--red)}
.ex{margin:0 0 .9rem;color:var(--muted);font-size:.95rem;line-height:1.5;max-width:44em}
.open{border-left:2px solid var(--red);padding:.2rem 0 .2rem 1.1rem;margin:1.4rem 0 0}

/* ── 问答 ─────────────────────────────────────────────────── */
.rail{position:sticky;top:2rem}
.ask{border-top:2px solid var(--ink);padding-top:.9rem;margin-top:.5rem}
.ask input{width:100%;background:none;border:0;border-bottom:1px solid var(--rule);
  padding:.6rem 0;font:inherit;font-size:1.05rem;color:inherit;outline:none}
.ask input:focus{border-bottom-color:var(--red)}
.turn{margin-top:1.5rem}
.q{font-style:italic;color:var(--muted);margin:0 0 .45rem;line-height:1.45}
.a{line-height:1.62}
.a::before{content:"—";color:var(--red);margin-right:.45rem}
.seller{display:flex;gap:.9rem;align-items:center;margin-top:2rem}
.seller img{width:44px;height:44px;border-radius:50%;object-fit:cover}

/* ── 地图 + 页脚 ──────────────────────────────────────────── */
.map{margin-top:clamp(3rem,7vw,5rem);border:1px solid var(--rule)}
.map iframe{display:block;width:100%;height:clamp(16rem,32vw,24rem);border:0}
footer{background:var(--night);color:#9A9081;margin-top:clamp(3rem,7vw,5rem);
  padding:clamp(2.5rem,6vw,4rem) 0}
footer a{color:#DCD3C4}
`;

function Hero({ page }: { page: Page | null }) {
  return (
    <header className="hero">
      {/* 远端 mp4。autoplay 要 muted + playsInline，否则浏览器不给放。 */}
      <video src={MEDIA.video} poster={MEDIA.poster} autoPlay muted loop playsInline
             data-sm="hero-video" />
      <div className="veil" />
      <div className="wrap inner">
        <div className="eyebrow mono"><span className="dot" />in stock · ships today</div>
        <h1 className="title">Read it, <em>keep</em> it.</h1>
        <p className="sub">
          A reading-first language app: paginated reader, per-page vocabulary, one-click
          Anki export, and a local audiobook with word-level karaoke.
        </p>
        <div className="cta">
          <span className="price"><s>$79</s> $49</span>
          <a className="buy mono" href="#buy">add to cart</a>
          <a className="ghost mono" href="#notes">read the thinking ↓</a>
        </div>
        {/* 分隔符只在**两边都有东西**时才出现。上一版无条件拼「名字 · 地点」，
            而这个实例没填地点 —— 屏幕上就是 `SIJIE WANG ·`，一个指向空处的点。 */}
        <p className="mono" style={{ marginTop: "2rem", color: "#9A9081" }} data-sm="byline">
          {page ? [page.owner.full_name, page.owner.location].filter(Boolean).join(" · ") : " "}
        </p>
      </div>
    </header>
  );
}

const SPECS = [
  { k: "formats", v: "EPUB · PDF" },
  { k: "languages", v: "14" },
  { k: "offline", v: "everything" },
  { k: "export", v: "Anki" },
];

function Specs() {
  return (
    <div className="specs">
      {SPECS.map((s) => (
        <div className="spec" key={s.k}>
          <div className="k mono">{s.k}</div>
          <div className="v">{s.v}</div>
        </div>
      ))}
    </div>
  );
}

function Gallery() {
  return (
    <div className="gallery" data-sm="gallery">
      {MEDIA.shots.map((s, i) => (
        <figure className={`g${i}`} key={s.src}>
          <img src={s.src} alt={s.alt} loading="lazy" data-sm="shot" />
          <figcaption className="mono">{s.alt}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// Hosted —— **这一张是我们自己在服务的**。
//
// 上一版直接热链维基百科；那能用，但没必要：`assets.upload` 收一个地址、**服务端自己去取**、
// 字节落进实例的对象存储，从此这张图跟第三方站点再无关系（它挂了、改了、防了盗链，都不影响）。
//
// 两件事因此必须在**运行时**做，不能写死在源码里：
//   · 地址是**签名 URL，一小时过期** —— 粘进构建产物的话，页面上线一小时后就是一片碎图。
//   · 素材挂在**语料条目**上（asset 必须有 holder），所以取它的路径是「取那条笔记，读它的 assets」。
// 也就是说：这一块每次打开都是新拿的，跟撤下语料立刻生效是同一件事。
function Hosted({ note }: { note: Landing | null }) {
  const shot = (note?.assets ?? []).find((a) => a.content_type.startsWith("image/"));
  if (!shot) return null;
  return (
    <section className="pasted">
      <img src={shot.url} alt={shot.original_filename} data-sm="hosted" />
      <div>
        <div className="mono" style={{ color: "var(--muted)" }}>served by this instance</div>
        <p style={{ margin: ".5rem 0 0", maxWidth: "32em", lineHeight: 1.55 }}>
          This one is not hotlinked. It was pulled in once and now lives in the owner&rsquo;s own
          storage — the address is signed and short-lived, so the page fetches it fresh every
          time rather than baking it into the build.
        </p>
        <div className="mono" style={{ marginTop: ".6rem", color: "var(--muted)" }}>
          {shot.original_filename} · {Math.round(shot.size_bytes / 1024)} KB
        </div>
      </div>
    </section>
  );
}

function Sound() {
  return (
    <div className="audio">
      <div>
        <div className="mono" style={{ color: "var(--muted)" }}>listen · generated audiobook</div>
        <p style={{ margin: ".35rem 0 0", maxWidth: "26em" }}>
          Word-level timing, so the page highlights as it reads.
        </p>
      </div>
      <audio src={MEDIA.audio} controls preload="metadata" data-sm="audio" />
    </div>
  );
}

// Notes —— 语料。**这一段是活的**：条目是实例里真的笔记，点开取回正文摘要。
function Notes({ cards, onOpen, open }: {
  cards: readonly Card[]; onOpen: (c: Card) => void;
  open: { title: string; excerpt: string; path: string } | null;
}) {
  if (cards.length === 0) {
    return (
      <p className="ex" id="notes">
        Nothing is pinned yet — pin a published note and it becomes an entry here.
      </p>
    );
  }
  return (
    <section id="notes">
      <h2>Why it works this way</h2>
      <p className="lede">Not marketing copy — the notes the product was argued out of.</p>
      {open ? (
        <article className="open">
          <div className="mono" style={{ color: "var(--muted)" }}>from the corpus</div>
          <h3 style={{ margin: ".3rem 0 .5rem", fontSize: "1.4rem" }}>{open.title}</h3>
          <AnswerText text={open.excerpt} paragraphClassName="ex" />
          <a className="mono" style={{ color: "var(--red)" }} href={`/wiki/${open.path}`}>
            read it in full ↗
          </a>
        </article>
      ) : null}
      <ol className="notes">
        {cards.map((c, i) => (
          <li className="note" key={c.wiki_id} style={{ animationDelay: `${i * 60}ms` }}>
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

function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const [draft, setDraft] = useState("");
  const turns: { q: string; a: string }[] = [];
  for (const m of chat.messages) {
    if (m.role === "visitor") turns.push({ q: m.text, a: "" });
    else if (turns.length > 0) turns[turns.length - 1]!.a = m.text;
  }
  return (
    <aside className="rail">
      <div className="mono" style={{ color: "var(--muted)" }} data-sm="ask-scope">
        {hasVisitorGrant() ? "ask · you are here on a code" : "ask · answered from the corpus"}
      </div>
      <div className="ask">
        <input
          data-sm="ask"
          value={draft}
          placeholder={chat.streaming ? "thinking…" : "ask about it"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || draft.trim() === "" || chat.streaming) return;
            const t = draft; setDraft(""); void chat.send(t);
          }}
        />
      </div>
      {turns.map((t, i) => (
        <div className="turn" key={i}>
          <p className="q">{t.q}</p>
          <div className="a"><AnswerText text={t.a} /></div>
        </div>
      ))}
      {chat.error ? <p className="turn ex" data-sm="error">{chat.error}</p> : null}
      {byoaiOffered()
        ? <a className="mono" data-sm="byok" href="/gate"
             style={{ color: "var(--red)", display: "block", marginTop: "1.2rem" }}>
            bring your own key ↗
          </a>
        : null}
      <div className="seller">
        <img src={MEDIA.portrait} alt="" data-sm="portrait" />
        <div className="mono" style={{ color: "var(--muted)" }}>
          answered in the maker&rsquo;s voice
        </div>
      </div>
    </aside>
  );
}

function Body() {
  const sm = useStandMeet();
  const [page, setPage] = useState<Page | null>(null);
  const [open, setOpen] = useState<Landing | null>(null);
  // shot —— 实例自己在服务的那张图。跟着**第一条语料**取回来：素材挂在语料上，
  // 所以拿它的路径就是「取那条笔记，读它的 assets」。每次打开都是新签的地址。
  const [shot, setShot] = useState<Landing | null>(null);
  const seen = useRef(false);
  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    void sm.fetchPage().then(setPage as never).catch(() => setPage(null));
  }, [sm]);
  const cards = page ? [...page.content.insights, ...page.content.projects] : [];
  const first = cards[0]?.path;
  useEffect(() => {
    if (!first) return;
    void sm.fetchWikiLanding(first).then(setShot as never).catch(() => setShot(null));
  }, [sm, first]);
  const onOpen = (c: Card) => {
    void sm.fetchWikiLanding(c.path).then(setOpen as never).catch(() => setOpen(null));
  };
  return (
    <>
      <Hero page={page} />
      <div className="ticker mono">
        <span>
          free updates forever · offline first · no account required · your books stay yours ·
          14 languages · one-click Anki export · word-level karaoke ·
        </span>
      </div>
      <div className="wrap">
        <Specs />
        <Gallery />
        <Hosted note={shot} />
        <div className="cols">
          <main>
            <Sound />
            <Notes cards={cards} onOpen={onOpen} open={open} />
          </main>
          <Ask />
        </div>
        <div className="map">
          {/* 远端 iframe —— 第三方页面整块嵌进来。
              **不加 loading="lazy"**：加了它只在读者滚到这里才去取（网络日志里根本没有
              那次请求），而这一页存在的意义就是当证据，不该有一块要靠滚动才出现的东西。
              注：整页截图里这块仍然是空的 —— Playwright 的 fullPage 拼接不等跨源 iframe
              画完，跟 lazy 无关。真相在 `cpcb-93-map.png`（正常视口那张）。 */}
          <iframe src={MEDIA.map} title="where this was built" data-sm="map" />
        </div>
      </div>
      <footer>
        <div className="wrap">
          <div className="mono">© {page ? page.owner.handle : " "} · built on standmeet</div>
          {/* 这句话必须跟着页面走。上一版写「全部来自远端 URL」，而海报已经改成
              实例自己在服务了 —— 屏幕上一句过期的断言，跟一个坏掉的功能一样是缺陷。 */}
          <p style={{ marginTop: ".8rem", maxWidth: "44em" }}>
            Two ways in, both by URL and neither in the build: the gallery, video, audio and map
            come straight from <em>remote hosts</em>; the poster was pulled into this
            instance&rsquo;s own storage once and is <em>served from here</em>, on a signed
            address resolved fresh on every view.
          </p>
        </div>
      </footer>
    </>
  );
}

export default function App() {
  return (
    <StandMeetProvider baseURL="">
      <style>{CSS}</style>
      <Body />
    </StandMeetProvider>
  );
}
