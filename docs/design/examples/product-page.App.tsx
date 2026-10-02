// product-page.App.tsx — **this page exists to prove where the ceiling is.**
//
// A hosted page runs a real vite build, and the instance serves the output itself, with **no CSP at all**. So a page can hold
// exactly what an ordinary web page can: remote images, remote video, remote audio, iframes, remote fonts, CSS animation,
// its own layout. All media goes by **URL**; not one byte enters the build output — swapping an image needs no rebuild.
//
// It is also a **live** page: the corpus is read from the instance (`fetchPage` / `fetchWikiLanding`),
// and questions go to this code's own agent (`useChatSession` takes over the already-issued session).
// A page that is both a product page and answers questions — that is the half the WordPress side cannot do.

import { useEffect, useRef, useState } from "react";
import { StandMeetProvider, useStandMeet, useChatSession, AnswerText } from "@standmeet/sdk";
import { byoaiOffered, hasVisitorGrant } from "@standmeet/sdk-core";

type Card = { wiki_id: string; title: string; excerpt: string; path: string };
// Landing — what you get back when you fetch one corpus entry. `assets` are the files attached to it (signed addresses, valid for one hour).
type Asset = {
  asset_id: string; kind: string; content_type: string;
  original_filename: string; url: string; size_bytes: number;
};
type Landing = { title: string; excerpt: string; path: string; assets?: readonly Asset[] };
type Page = {
  owner: { handle: string; full_name: string; location: string };
  content: { hero_prose: string; insights: readonly Card[]; projects: readonly Card[] };
};

// Remote media. **All URLs** — not one byte of media in the build output.
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
  // The poster's address is **not** here — it is no longer remote media.
  // `assets.upload` pulled it into the instance's own storage; the page takes it from the corpus at runtime (see <Hosted/>).
  // A note on the pitfall we hit: the owner handed over `zh.wikipedia.org/wiki/File:…`, which is a **description page**,
  // not the image; the real file is at `upload.wikimedia.org/…`, and getting it takes one API call.
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

/* ── hero: full-bleed video, title laid over it ──────────────── */
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

/* ── spec table ───────────────────────────────────────────── */
.specs{display:grid;grid-template-columns:1fr;gap:0;margin:clamp(3rem,7vw,6rem) 0 0;
  border-top:2px solid var(--ink)}
@media(min-width:52rem){.specs{grid-template-columns:repeat(4,1fr)}}
.spec{padding:1.4rem 0;border-bottom:1px solid var(--rule)}
@media(min-width:52rem){.spec{border-right:1px solid var(--rule);padding:1.6rem 1.4rem}
  .spec:first-child{padding-left:0}.spec:last-child{border-right:0}}
.spec .k{color:var(--muted)}
.spec .v{font-size:1.6rem;letter-spacing:-.02em;margin-top:.45rem;font-variant-numeric:tabular-nums}

/* ── gallery: uneven sizes ────────────────────────────────── */
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

/* ── columns ──────────────────────────────────────────────── */
.cols{display:grid;grid-template-columns:1fr;gap:clamp(2rem,5vw,4rem);
  margin-top:clamp(3.5rem,8vw,6rem)}
@media(min-width:62rem){.cols{grid-template-columns:1.55fr 1fr;align-items:start}}
h2{font-size:clamp(1.8rem,3.4vw,2.9rem);letter-spacing:-.025em;line-height:1.05;margin:0 0 1rem}
.lede{font-size:1.18rem;line-height:1.6;max-width:36em;color:#3A342C}

/* ── an image pasted in on the fly ────────────────────────── */
.pasted{display:flex;gap:clamp(1.2rem,3vw,2.2rem);align-items:center;
  margin-top:clamp(2.5rem,6vw,4rem);padding-top:clamp(2rem,4vw,2.5rem);
  border-top:1px solid var(--rule);flex-wrap:wrap}
.pasted img{width:clamp(9rem,14vw,13rem);height:auto;display:block;
  box-shadow:0 18px 40px -18px rgba(27,24,20,.55)}

/* ── audio ────────────────────────────────────────────────── */
.audio{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap;
  border-left:2px solid var(--red);padding:1rem 0 1rem 1.2rem;margin-top:2.2rem}
.audio audio{height:2.2rem}

/* ── corpus ───────────────────────────────────────────────── */
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

/* ── Q&A ──────────────────────────────────────────────────── */
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

/* ── map + footer ─────────────────────────────────────────── */
.map{margin-top:clamp(3rem,7vw,5rem);border:1px solid var(--rule)}
.map iframe{display:block;width:100%;height:clamp(16rem,32vw,24rem);border:0}
footer{background:var(--night);color:#9A9081;margin-top:clamp(3rem,7vw,5rem);
  padding:clamp(2.5rem,6vw,4rem) 0}
footer a{color:#DCD3C4}
`;

function Hero({ page }: { page: Page | null }) {
  return (
    <header className="hero">
      {/* Remote mp4. autoplay needs muted + playsInline, or the browser refuses to play it. */}
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
        {/* The separator appears only when **both sides have something**. The previous version always joined "name · location",
            and this instance has no location set — the screen showed `SIJIE WANG ·`, a dot pointing at nothing. */}
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

// Hosted — **this image is one we serve ourselves**.
//
// The previous version hotlinked Wikipedia directly; that worked, but was unnecessary: `assets.upload` takes an address, **the server fetches it itself**,
// and the bytes land in the instance's object storage. From then on the image has nothing to do with the third-party site (if it goes down, changes, or blocks hotlinking, nothing breaks).
//
// So two things must happen at **runtime** and cannot be hard-coded in the source:
//   · The address is a **signed URL that expires in one hour** — pasted into the build output, the page would be all broken images an hour after going live.
//   · The asset hangs on a **corpus entry** (an asset must have a holder), so the path to it is "fetch that note, read its assets".
// In other words: this block is fetched fresh on every view, which is the same thing as withdrawing a corpus entry taking effect at once.
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

// Notes — the corpus. **This section is live**: the entries are real notes in the instance; opening one fetches its excerpt.
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
  // shot — the image the instance serves itself. It comes back with the **first corpus entry**: assets hang on corpus entries,
  // so the path to it is "fetch that note, read its assets". Every view gets a freshly signed address.
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
          {/* Remote iframe — a whole third-party page embedded.
              **No loading="lazy"**: with it, the frame is fetched only when the reader scrolls here (the network log has no
              such request at all), and this page exists to serve as evidence, so nothing on it should appear only after scrolling.
              Note: this block is still blank in the full-page screenshot — Playwright's fullPage stitching does not wait for a cross-origin iframe
              to finish painting; that has nothing to do with lazy. The truth is in `cpcb-93-map.png` (the normal-viewport one). */}
          <iframe src={MEDIA.map} title="where this was built" data-sm="map" />
        </div>
      </div>
      <footer>
        <div className="wrap">
          <div className="mono">© {page ? page.owner.handle : " "} · built on standmeet</div>
          {/* This sentence must track the page. The previous version said "all from remote URLs", but the poster had already moved to
              being served by the instance itself — a stale claim on screen is as much a defect as a broken feature. */}
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
