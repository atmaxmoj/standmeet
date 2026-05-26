/* global React, ReactDOM, POSTS, postBySlug, visiblePosts */

const { useState, useEffect, useRef, useMemo, useLayoutEffect } = React;

// ─────────────────────────────────────────────────────────────────────────────
// access state — derived from the same URL params the chat page uses
//   ?c=CODE   → unlocked (visitor coded in)
//   ?byoai=1  → byoai
//   (none)    → public
function useAccess() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const code   = params.get('c');
  const visitor = params.get('v');
  const byoai  = params.get('byoai') === '1';
  // very permissive: any code value unlocks private; in reality, the backend
  // would check the code's scope and return per-post permission.
  const level = code ? 'unlocked' : (byoai ? 'public' : 'public');
  return { level, code, visitor, byoai };
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem('standmeet-dark');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('standmeet-dark', dark ? '1' : '0'); } catch (e) {}
  }, [dark]);
  return [dark, setDark];
}

function useRoute() {
  const params0 = new URLSearchParams(window.location.search);
  const [slug, setSlug] = useState(() => params0.get('post'));
  const [tag,  setTag]  = useState(() => params0.get('tag'));
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      setSlug(p.get('post'));
      setTag(p.get('tag'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = (patch) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => {
      if (v == null || v === '') params.delete(k); else params.set(k, v);
    });
    const qs = params.toString();
    window.history.pushState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
    if ('post' in patch) setSlug(patch.post || null);
    if ('tag'  in patch) setTag(patch.tag || null);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  };
  const go      = (newSlug) => update({ post: newSlug || null });
  const goTag   = (newTag)  => update({ tag:  newTag  || null, post: null });
  return [slug, go, tag, goTag];
}

// ─────────────────────────────────────────────────────────────────────────────
// tag aggregation + recommendation helpers

function tagStats(posts) {
  const counts = new Map();
  for (const p of posts) {
    for (const t of (p.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// recommend posts by tag overlap (Jaccard-ish). Excludes the current post.
function recommendByTags(post, pool, max = 3) {
  if (!post || !pool) return [];
  const self = new Set(post.tags || []);
  return pool
    .filter((p) => p.slug !== post.slug)
    .map((p) => {
      const other = new Set(p.tags || []);
      const inter = [...self].filter((t) => other.has(t)).length;
      const union = new Set([...self, ...other]).size || 1;
      return { p, score: inter / union, overlap: inter };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.score - a.score || (a.p.iso < b.p.iso ? 1 : -1))
    .slice(0, max)
    .map((x) => x.p);
}

function TagChipRow({ tags, active, onPick, posts }) {
  const counts = new Map(tagStats(posts));
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <button
        onClick={() => onPick(null)}
        className={`chip ${!active ? 'is-active-tag' : ''}`}
        style={!active ? { background:'var(--ink)', color:'var(--paper)', borderColor:'var(--ink)' } : {}}
      >
        all <span className="ml-1 opacity-60 tabular-nums">{posts.length}</span>
      </button>
      {tags.map((t) => {
        const on = active === t;
        const isPrivate = t === 'private';
        return (
          <button
            key={t}
            onClick={() => onPick(on ? null : t)}
            className={`chip ${isPrivate ? 'is-private' : ''}`}
            style={on ? {
              background: isPrivate ? 'var(--accent)' : 'var(--ink)',
              color: 'var(--paper)',
              borderColor: isPrivate ? 'var(--accent)' : 'var(--ink)',
            } : {}}
          >
            {t} <span className="ml-1 opacity-60 tabular-nums">{counts.get(t) || 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// chrome

function TopBar({ dark, onToggleDark, access, content }) {
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <a href="index.html" className="text-ink">standmeet</a>
        <span className="text-faint">/</span>
        <a href="index.html" className="text-muted">{content.owner.handle}</a>
        <span className="text-faint mx-1">·</span>
        <span className="text-accent">writing</span>
        {access.level === 'unlocked' && (
          <span className="ml-3 inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
            <span className="text-faint text-[10px] tracking-[0.16em]">unlocked · {access.code}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-6">
        <a href="index.html" className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">chat</a>
        <a href={`mailto:${content.contact.email}`} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">contact</a>
        <button onClick={onToggleDark} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">
          {dark ? 'light' : 'dark'}
        </button>
      </div>
    </header>
  );
}

function Footer({ content }) {
  return (
    <footer className="border-t border-rule mt-24">
      <div className="max-w-[920px] mx-auto px-6 lg:px-0 py-9 mono text-[11px] leading-[1.7] text-muted flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-ink">{POSTS.filter((p)=>p.visibility==='public').length}</span> public essays
          <span className="mx-2 text-faint">·</span>
          drawn from <span className="text-ink">{content.owner.corpus_size.toLocaleString()}</span> corpus entries
          <span className="mx-2 text-faint">·</span>
          updated {content.owner.last_updated}
        </div>
        <div>
          subscribe via <a href="index.html" className="link">the chat</a> or <a href={`mailto:${content.contact.email}`} className="link">email</a>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// cover — typographic, generated from post.cover spec

function Cover({ cover, locked }) {
  const bg = `cv-bg-${cover.hue || 'amber'}`;
  return (
    <div className={`cover ${bg} ${locked ? 'cv-locked' : ''}`}>
      <div className="cv-rule" />
      <span className="cv-head">{cover.headline}</span>
      <span className="cv-sub">{cover.sub}</span>
      <span className="cv-tag">essay · standmeet</span>
      <span className="cv-no">{cover.no || '—'}</span>
      {locked && (
        <div className="lock-overlay">
          <span className="mono text-[11px] tracking-[0.2em] uppercase text-accent">private · code-gated</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX page — reverse-chronological list

function PostCardLead({ post, locked, onOpen }) {
  return (
    <article className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-12 mb-20 cursor-pointer group" onClick={() => !locked && onOpen(post.slug)}>
      <div>
        <Cover cover={{ ...post.cover, no: 'no. 01 · ' + post.date }} locked={locked} />
      </div>
      <div className="flex flex-col">
        <div className="smallcaps mb-3 flex items-baseline gap-3 flex-wrap">
          <span className="text-ink">latest</span>
          <span className="text-faint">·</span>
          <span>{post.date}</span>
          <span className="text-faint">·</span>
          <span>{post.read_minutes} min read</span>
          {locked && <span className="text-accent">· private</span>}
        </div>
        <h2
          className="font-serif text-ink group-hover:text-accent transition-colors"
          style={{ fontSize:'clamp(34px, 4vw, 46px)', lineHeight:1.08, letterSpacing:'-0.018em', fontWeight:400, textWrap:'pretty' }}
        >
          {post.title}
        </h2>
        <p
          className="reading text-muted mt-5"
          style={{ fontSize:'18px', lineHeight:1.55 }}
        >
          {locked ? post.locked_body : post.excerpt}
        </p>
        <div className="mt-6 flex flex-wrap items-baseline gap-1.5">
          {post.tags.map((t) => <span key={t} className={`chip ${t === 'private' ? 'is-private' : ''}`}>{t}</span>)}
          <span className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-accent ml-auto pt-1">
            {locked ? 'unlock with code →' : 'read →'}
          </span>
        </div>
      </div>
    </article>
  );
}

function PostRow({ post, locked, onOpen, idx }) {
  return (
    <article
      onClick={() => !locked && onOpen(post.slug)}
      className={`group grid grid-cols-[60px_1fr_auto] gap-6 lg:gap-10 py-7 border-t border-rule cursor-pointer items-baseline ${locked ? 'opacity-80' : ''}`}
    >
      <div className="smallcaps tabular-nums pt-2">
        no. {String(idx).padStart(2, '0')}
      </div>
      <div>
        <div className="smallcaps mb-2 flex items-baseline gap-3 flex-wrap">
          <span>{post.date}</span>
          <span className="text-faint">·</span>
          <span>{post.read_minutes} min</span>
          {locked && <><span className="text-faint">·</span><span className="text-accent">private</span></>}
        </div>
        <h3
          className="font-serif text-ink group-hover:text-accent transition-colors"
          style={{ fontSize:'24px', lineHeight:1.2, letterSpacing:'-0.005em', fontWeight:400 }}
        >
          {post.title}
        </h3>
        <p className="reading text-muted mt-2" style={{ fontSize:'16.5px', lineHeight:1.5, maxWidth:'46em' }}>
          {locked ? post.locked_body : post.excerpt}
        </p>
        <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
          {post.tags.map((t) => <span key={t} className={`chip ${t === 'private' ? 'is-private' : ''}`}>{t}</span>)}
        </div>
      </div>
      <div className="mono text-[11px] tracking-[0.16em] uppercase text-muted group-hover:text-accent transition-colors pt-2 shrink-0">
        {locked ? 'gated →' : 'read →'}
      </div>
    </article>
  );
}

function IndexView({ access, onOpen, content, activeTag, onPickTag }) {
  const posts = visiblePosts('unlocked'); // always include private, but lock if no code
  const allTags = tagStats(posts).map(([t]) => t);
  const filtered = activeTag ? posts.filter((p) => p.tags && p.tags.includes(activeTag)) : posts;
  const [lead, ...rest] = filtered;
  const isLocked = (p) => p.visibility === 'private' && access.level !== 'unlocked';

  return (
    <div className="max-w-[1080px] mx-auto px-6 lg:px-0">

      {/* eyebrow */}
      <section className="pt-12 lg:pt-16 pb-8 border-b border-rule">
        <div className="smallcaps mb-5">{content.owner.full} · essays</div>
        <h1 className="font-serif text-ink" style={{ fontSize:'clamp(48px, 7vw, 80px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:0.98 }}>
          Writing<span className="text-accent">.</span>
        </h1>
        <p
          className="font-serif italic text-muted mt-5"
          style={{ fontSize:'21px', lineHeight:1.45, fontWeight:380, maxWidth:'34em', textWrap:'pretty' }}
        >
          The corpus, surfaced. Each essay is the expanded version of something I’ve been thinking through —
          you can ask the AI about any of these directly. Private essays sit here too; they need a code.
        </p>

        {/* tag filter row */}
        <div className="mt-8">
          <div className="smallcaps mb-3 flex items-baseline justify-between flex-wrap gap-2">
            <span>browse by tag</span>
            {activeTag && (
              <button onClick={() => onPickTag(null)} className="text-faint hover:text-ink lowercase tracking-[0.06em] text-[10px]">
                × clear · showing {filtered.length} of {posts.length}
              </button>
            )}
          </div>
          <TagChipRow tags={allTags} active={activeTag} onPick={onPickTag} posts={posts} />
        </div>
      </section>

      {filtered.length === 0 && (
        <section className="py-20 text-center">
          <p className="reading text-muted" style={{ fontSize:'18px' }}>
            Nothing tagged <span className="mono text-accent">{activeTag}</span> yet.
          </p>
          <button onClick={() => onPickTag(null)} className="mono text-[11px] tracking-[0.16em] uppercase text-muted hover:text-ink mt-4">
            ← show all essays
          </button>
        </section>
      )}

      {filtered.length > 0 && !activeTag && (
        <>
          {/* lead */}
          <section className="pt-12">
            <div className="smallcaps mb-7">most recent</div>
            <PostCardLead post={lead} locked={isLocked(lead)} onOpen={onOpen} />
          </section>

          {/* archive */}
          <section className="mt-4">
            <div className="smallcaps mb-2">archive</div>
            <div>
              {rest.map((p, i) => (
                <PostRow key={p.slug} post={p} locked={isLocked(p)} onOpen={onOpen} idx={i + 2} />
              ))}
            </div>
          </section>
        </>
      )}

      {filtered.length > 0 && activeTag && (
        <section className="pt-10">
          <div className="smallcaps mb-2 flex items-baseline gap-3">
            <span>filtered by</span>
            <span className="text-accent">#{activeTag}</span>
            <span className="text-faint">·</span>
            <span className="tabular-nums">{filtered.length} essay{filtered.length === 1 ? '' : 's'}</span>
          </div>
          <div>
            {filtered.map((p, i) => (
              <PostRow key={p.slug} post={p} locked={isLocked(p)} onOpen={onOpen} idx={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* recommended next reads — surfaces when no filter is active and at least one post */}
      {!activeTag && filtered.length > 1 && (
        <RecommendedRail posts={posts} access={access} onOpen={onOpen} onPickTag={onPickTag} />
      )}

      {/* ask-the-corpus invite */}
      <section className="mt-24 pt-10 border-t border-rule">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-10 items-baseline">
          <div>
            <div className="smallcaps mb-2">or skip the reading</div>
            <h3 className="font-serif text-ink" style={{ fontSize:'30px', lineHeight:1.15, letterSpacing:'-0.012em', fontWeight:400 }}>
              Ask {content.owner.handle}’s AI directly<span className="text-accent">.</span>
            </h3>
            <p className="reading text-muted mt-3" style={{ fontSize:'17px' }}>
              Everything you’d read here, said back to you in his voice. The chat covers
              ground he hasn’t written up yet, and answers from the corpus rather than the archive.
            </p>
          </div>
          <div className="md:pl-10">
            <a
              href="index.html"
              className="mono text-[11px] tracking-[0.16em] uppercase text-ink border border-ink px-4 py-3 inline-block hover:bg-ink hover:text-paper transition-colors"
            >
              open the chat →
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function RecommendedRail({ posts, access, onOpen, onPickTag }) {
  // pick the top tag the visitor hasn't read, then 2 essays from it
  const stats = tagStats(posts).filter(([t]) => t !== 'private');
  if (stats.length === 0) return null;
  const [topTag] = stats[0];
  const inTopTag = posts.filter((p) => p.tags.includes(topTag)).slice(0, 2);
  const otherTags = stats.slice(1, 6).map(([t]) => t);
  return (
    <section className="mt-24 pt-10 border-t border-rule">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10 items-baseline">
        <div>
          <div className="smallcaps mb-2">where to start</div>
          <h3 className="font-serif text-ink" style={{ fontSize:'26px', lineHeight:1.15, letterSpacing:'-0.012em', fontWeight:400 }}>
            If you only read two<span className="text-accent">.</span>
          </h3>
          <p className="reading text-muted mt-3" style={{ fontSize:'15.5px' }}>
            These are the two essays most people I respect have asked me about. Both sit under{' '}
            <button onClick={() => onPickTag(topTag)} className="link mono text-[13px]">#{topTag}</button>{' '}
            — the thread that runs through most of what I write.
          </p>
          <div className="mt-4 smallcaps mb-2">or jump to a tag</div>
          <div className="flex flex-wrap gap-1.5">
            {otherTags.map((t) => (
              <button key={t} onClick={() => onPickTag(t)} className="chip hover:border-ink transition-colors">#{t}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {inTopTag.map((p) => (
            <button
              key={p.slug}
              onClick={() => onOpen(p.slug)}
              className="text-left group border-t border-rule pt-4 hover:border-ink transition-colors"
            >
              <div className="smallcaps mb-1">{p.date} · {p.read_minutes} min</div>
              <div className="font-serif text-ink group-hover:text-accent transition-colors" style={{ fontSize:'20px', lineHeight:1.25, letterSpacing:'-0.005em', fontWeight:400 }}>
                {p.title}
              </div>
              <p className="reading text-muted mt-2" style={{ fontSize:'15px' }}>{p.excerpt}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.tags.map((t) => <span key={t} className={`chip ${t === 'private' ? 'is-private' : ''}`}>{t}</span>)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLE view

function CrossRefs({ slugs, onOpen, currentPost, allPosts, onPickTag }) {
  const refs = (slugs || []).map((s) => postBySlug(s)).filter(Boolean);
  // augment with tag-overlap recs to fill to 4
  const seen = new Set([currentPost.slug, ...refs.map((r) => r.slug)]);
  const tagRecs = recommendByTags(currentPost, allPosts.filter((p) => !seen.has(p.slug)), 4 - refs.length);
  const all = [...refs.map((r) => ({ p: r, reason: 'cross-ref' })), ...tagRecs.map((p) => ({ p, reason: 'by tag' }))];
  if (all.length === 0) return null;
  return (
    <aside className="mt-20 pt-10 border-t border-rule">
      <div className="smallcaps mb-5 flex items-baseline justify-between flex-wrap gap-2">
        <span>read next</span>
        <span className="text-faint">picked from the same thread + tag overlap</span>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {all.map(({ p, reason }) => (
          <li key={p.slug}>
            <button onClick={() => onOpen(p.slug)} className="group text-left w-full">
              <div className="smallcaps mb-1 flex items-baseline gap-2">
                <span>{p.date} · {p.read_minutes} min</span>
                <span className="text-faint">·</span>
                <span className={reason === 'cross-ref' ? 'text-accent' : 'text-muted'}>{reason}</span>
              </div>
              <div className="font-serif text-ink group-hover:text-accent transition-colors" style={{ fontSize:'20px', lineHeight:1.25, letterSpacing:'-0.005em', fontWeight:400 }}>
                {p.title}
              </div>
              <p className="reading text-muted mt-2" style={{ fontSize:'15.5px' }}>{p.excerpt}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span
                    key={t}
                    onClick={(e) => { e.stopPropagation(); onPickTag(t); }}
                    className={`chip ${t === 'private' ? 'is-private' : ''} cursor-pointer hover:border-ink transition-colors`}
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function AskAboutThis({ post, onAsk, content }) {
  const [val, setVal] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!val.trim()) return;
    onAsk(val.trim());
  };
  const starters = [
    `What’s the practical takeaway from "${post.title.toLowerCase()}"?`,
    `How does this relate to ${content.owner.handle}’s current work?`,
  ];
  return (
    <div className="ask-bar mt-10 pt-3 pb-4">
      <div className="max-w-[760px] mx-auto px-6 lg:px-0">
        <div className="smallcaps mb-3 flex items-baseline gap-3 flex-wrap">
          <span className="text-ink">ask sijie’s ai about this essay</span>
          <span className="text-faint">·</span>
          <span>context: "{post.title.toLowerCase()}"</span>
        </div>
        <form onSubmit={submit}>
          <div className="flex items-baseline gap-4 py-3 border-t border-b border-ink">
            <span className="text-accent font-serif shrink-0" style={{ fontSize:'24px', lineHeight:1 }}>›</span>
            <input
              type="text" value={val} onChange={(e)=>setVal(e.target.value)}
              placeholder="follow-up question…"
              className="flex-1 bg-transparent font-serif italic min-w-0"
              style={{ fontSize:'20px', lineHeight:1.3, fontWeight:380 }}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!val.trim()}
              className="mono text-[11px] tracking-[0.18em] uppercase text-muted hover:text-accent disabled:text-faint transition-colors shrink-0"
            >
              ask ↵
            </button>
          </div>
        </form>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-1 gap-y-1.5">
          <span className="mono text-[10px] tracking-[0.18em] uppercase text-faint mr-3 pt-0.5">try</span>
          {starters.map((s, i) => (
            <button key={i} onClick={() => onAsk(s)} className="font-serif italic text-muted hover:text-accent transition-colors text-left" style={{ fontSize:'15px' }}>
              "{s}"
              {i < starters.length - 1 && <span className="text-faint not-italic mx-1.5">/</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LockedView({ post, onBack }) {
  return (
    <div className="max-w-[760px] mx-auto px-6 lg:px-0 py-20 text-center">
      <div className="smallcaps mb-3">private essay</div>
      <h1 className="font-serif text-ink" style={{ fontSize:'clamp(36px, 5vw, 56px)', fontWeight:380, letterSpacing:'-0.018em', lineHeight:1.05 }}>
        {post.title}<span className="text-accent">.</span>
      </h1>
      <p className="reading text-muted mt-6" style={{ fontSize:'18px', maxWidth:'34em', margin:'24px auto 0' }}>
        {post.locked_body}
      </p>
      <div className="mt-8 flex flex-wrap items-baseline justify-center gap-4">
        <a href="gate.html#request" className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors">
          request an invite code ↗
        </a>
        <button onClick={onBack} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink">
          ← back to writing
        </button>
      </div>
    </div>
  );
}

function ArticleView({ slug, access, content, onOpen, onBack, onAsk, onPickTag }) {
  const post = postBySlug(slug);
  if (!post) return <div className="max-w-[760px] mx-auto px-6 py-20 mono text-muted">post not found.</div>;

  const locked = post.visibility === 'private' && access.level !== 'unlocked';
  const allPosts = visiblePosts('unlocked');

  if (locked) return <LockedView post={post} onBack={onBack} />;
  const SessionStrip = window.SM && window.SM.SessionStrip;

  return (
    <div>
      {/* breadcrumb */}
      <div className="max-w-[920px] mx-auto px-6 lg:px-0 pt-10">
        <button onClick={onBack} className="smallcaps hover:text-ink transition-colors">
          ← back to writing
        </button>
      </div>

      {/* cover */}
      <div className="max-w-[920px] mx-auto px-6 lg:px-0 mt-6 mb-12">
        <Cover cover={{ ...post.cover, no: post.date + ' · essay' }} />
      </div>

      {/* tag chips on article header — clickable, return to index filtered */}
      <header className="max-w-[760px] mx-auto px-6 lg:px-0 mb-10">
        <div className="smallcaps mb-4 flex items-baseline gap-3 flex-wrap">
          <span>{post.date}</span>
          <span className="text-faint">·</span>
          <span>{post.read_minutes} min read</span>
          <span className="text-faint">·</span>
          <span>by <span className="text-ink">{content.owner.full}</span></span>
          {post.tags.map((t) => (
            <button
              key={t}
              onClick={() => onPickTag(t)}
              className={`chip ${t === 'private' ? 'is-private' : ''} ml-1 hover:border-ink transition-colors`}
            >
              #{t}
            </button>
          ))}
        </div>
        <h1
          className="font-serif text-ink"
          style={{ fontSize:'clamp(40px, 5.6vw, 64px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:1.04, textWrap:'pretty' }}
        >
          {post.title}
        </h1>
        <p
          className="font-serif italic text-muted mt-6"
          style={{ fontSize:'22px', lineHeight:1.45, fontWeight:380, maxWidth:'34em', textWrap:'pretty' }}
        >
          {post.excerpt}
        </p>
      </header>

      {/* body */}
      <article className="max-w-[680px] mx-auto px-6 lg:px-0 article-body reading text-ink">
        {post.body && post.body.map((blk, i) => {
          if (blk.kind === 'h')    return <h2 key={i}>{blk.text}</h2>;
          if (blk.kind === 'pull') return <blockquote key={i}>{blk.text}</blockquote>;
          return <p key={i}>{blk.text}</p>;
        })}
      </article>

      {/* cross refs + tag-overlap recommendations */}
      <div className="max-w-[760px] mx-auto px-6 lg:px-0">
        <CrossRefs
          slugs={post.cross_refs}
          onOpen={onOpen}
          currentPost={post}
          allPosts={allPosts}
          onPickTag={onPickTag}
        />
      </div>

      {/* ask-bar */}
      <AskAboutThis post={post} onAsk={onAsk} content={content} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// app

function App() {
  const [dark, setDark] = useTheme();
  const [slug, go, activeTag, goTag] = useRoute();
  const access         = useAccess();
  const content        = window.loadPageContent ? window.loadPageContent() : {
    owner: { handle:'sijie', full:'sijie wang', corpus_size: 1247, last_updated: '3 days ago' },
    contact: { email: 'hello@standmeet.example' },
  };

  const openPost = (newSlug) => go(newSlug);
  const back     = () => go(null);
  const askAboutPost = (q) => {
    const params = new URLSearchParams(window.location.search);
    params.set('q', q);
    params.set('from', slug);
    params.delete('post');
    window.location.href = 'index.html?' + params.toString();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar dark={dark} onToggleDark={() => setDark((d) => !d)} access={access} content={content} />
      {window.SM && window.SM.SessionStrip && <window.SM.SessionStrip />}
      <main className="flex-1">
        {slug
          ? <ArticleView slug={slug} access={access} content={content} onOpen={openPost} onBack={back} onAsk={askAboutPost} onPickTag={goTag} />
          : <IndexView access={access} onOpen={openPost} content={content} activeTag={activeTag} onPickTag={goTag} />
        }
      </main>
      <Footer content={content} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
