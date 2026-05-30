/* global React, ReactDOM, OWNER, SECTIONS, SUGGESTED, ANSWERS, routeQuery,
   TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle, useTweaks */

const { useState, useEffect, useRef, useLayoutEffect, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#B5391C",
  "showQuickAsk": true,
  "showInsights": true,
  "showProjects": true,
  "showWhere": true,
  "showContact": true,
  "dark": false
}/*EDITMODE-END*/;

// ─────────────────────────────────────────────────────────────────────────────
// helpers

function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
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

function usePageContent() {
  const [content, setContent] = useState(() => window.loadPageContent());
  useEffect(() => {
    const handler = (e) => {
      if (!e.key || e.key === 'standmeet-page-content') {
        setContent(window.loadPageContent());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// chrome

function TopBar({ dark, onToggleDark }) {
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <span className="text-ink">standmeet</span>
        <span className="text-faint">/</span>
        <span className="text-muted">{OWNER.handle}</span>
        <span className="ml-2 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
          <span className="text-faint text-[10px] tracking-[0.16em]">live</span>
        </span>
      </div>
      <button
        onClick={onToggleDark}
        aria-label="toggle theme"
        className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors"
      >
        {dark ? 'light' : 'dark'}
      </button>
    </header>
  );
}

function Footer({ content }) {
  return (
    <footer className="border-t border-rule mt-28">
      <div className="max-w-[760px] mx-auto px-6 md:px-0 py-9 mono text-[11px] leading-[1.7] text-muted flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-ink">{content.owner.corpus_size.toLocaleString()}</span> entries
          <span className="mx-2 text-faint">·</span>
          updated {content.owner.last_updated}
          <span className="mx-2 text-faint">·</span>
          <span>grounded retrieval, no open-web fallback</span>
        </div>
        <div className="flex items-baseline gap-3">
          <a className="hover:text-ink transition-colors" href="blog.html">writing →</a>
          <span className="text-faint">·</span>
          <a className="hover:text-ink transition-colors" href="admin.html">admin ↗</a>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// shared atoms

function DeckHeader({ kicker, count, action }) {
  return (
    <div className="flex items-baseline gap-3 mb-8 pb-3 border-b border-rule">
      <span className="mono text-faint shrink-0">──</span>
      <span className="mono text-[10.5px] tracking-[0.22em] uppercase text-ink">{kicker}</span>
      {count != null && (
        <span className="mono text-[10px] tracking-[0.14em] text-faint tabular-nums ml-1">
          {String(count).padStart(2, '0')}
        </span>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO — identity strip + serif prose + chat input + inline examples

function AskInput({ value, onChange, onSubmit, disabled, inputRef }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim()) onSubmit(value.trim()); }}
    >
      <div className="flex items-baseline gap-4 py-4 border-t-[1.5px] border-b-[1.5px] border-ink relative">
        <span className="text-accent font-serif shrink-0" style={{ fontSize: '28px', lineHeight: 1 }}>›</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask anything."
          disabled={disabled}
          className="flex-1 bg-transparent text-ink placeholder:text-faint font-serif min-w-0"
          style={{ fontSize: 'clamp(20px, 2.2vw, 26px)', lineHeight: 1.3, fontWeight: 380 }}
          autoComplete="off"
          spellCheck="false"
          autoFocus
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="mono text-[11.5px] tracking-[0.18em] uppercase text-muted hover:text-accent disabled:text-faint transition-colors shrink-0 pt-1"
        >
          ask <span className="text-[14px]">↵</span>
        </button>
      </div>
    </form>
  );
}

function Examples({ items, onPick }) {
  if (!items || !items.length) return null;
  return (
    <div className="mt-6">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-faint mb-3">some examples</div>
      <ul className="space-y-1.5">
        {items.map((q, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className="mono text-faint shrink-0">·</span>
            <button
              onClick={() => onPick(q)}
              className="text-left font-serif italic text-muted hover:text-accent transition-colors"
              style={{ fontSize: '17px', lineHeight: 1.4 }}
            >
              "{q}"
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hero({ content, input, setInput, onAsk, pending, inputRef }) {
  const { full, location } = content.owner;
  return (
    <section className="pt-10 lg:pt-16">
      <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-muted mb-5 flex items-baseline gap-3 flex-wrap">
        <span className="text-ink">{full}</span>
        <span className="text-faint">·</span>
        <span>{location}</span>
      </div>

      <p
        className="font-serif text-ink balance"
        data-vt-name="hero-prose"
        style={{
          fontSize: 'clamp(26px, 3.4vw, 38px)',
          lineHeight: 1.35,
          fontWeight: 380,
          letterSpacing: '-0.012em',
          textWrap: 'pretty',
          maxWidth: '26em',
        }}
      >
        {content.hero.prose}
      </p>

      <div className="mt-10">
        <AskInput
          value={input}
          onChange={setInput}
          onSubmit={onAsk}
          disabled={pending}
          inputRef={inputRef}
        />
        <Examples items={content.hero.examples} onPick={onAsk} />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION — Q/A turns accumulate after the chat input when visitor asks

function Citations({ cites }) {
  if (!cites || !cites.length) return null;
  return (
    <div className="mt-6">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">drawn from</div>
      <ul className="space-y-1">
        {cites.map((c, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className="mono text-[11.5px] text-muted tabular-nums shrink-0">{c.date}</span>
            <span className="font-serif italic text-muted" style={{ fontSize: '14.5px' }}>{c.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolCallBlock({ tool, result }) {
  if (!result) return null;
  const headerCls = "mono text-[10px] tracking-[0.16em] uppercase";
  if (result.kind === 'calendar') {
    return (
      <div className="border border-rule bg-surface/40 mt-3 mb-1 rounded-sm">
        <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-rule/70">
          <span className={headerCls} style={{ color: 'var(--accent)' }}>⌖ tool · {tool}</span>
          <span className={headerCls} style={{ color: 'var(--faint)', letterSpacing: '0.1em' }}>3 slots offered</span>
        </div>
        <div className="px-3 py-2">
          {result.slots.map((s, i) => (
            <div key={i} className="grid grid-cols-[140px_1fr_auto] gap-3 items-baseline py-1.5 border-b border-rule/40 last:border-0">
              <span className="mono text-[11.5px] text-ink">{s.day}</span>
              <span className="mono text-[11.5px] text-muted">{s.time}</span>
              <button className="mono text-[10px] tracking-[0.16em] uppercase text-muted hover:text-accent">book →</button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (result.kind === 'booking') {
    return (
      <div className="border border-accent/50 bg-paper/60 mt-3 mb-1 rounded-sm">
        <div className="flex items-baseline justify-between px-3 py-2">
          <span className={headerCls} style={{ color: 'var(--accent)' }}>✓ booked · {tool}</span>
          <a href="#" className="mono text-[10px] tracking-[0.1em] text-muted hover:text-ink">{result.ics} ↓</a>
        </div>
      </div>
    );
  }
  if (result.kind === 'image') {
    return (
      <figure className="mt-3 mb-1" style={{ maxWidth: '460px' }}>
        <div style={{
          aspectRatio: '4/3',
          background: 'linear-gradient(135deg, color-mix(in oklab, var(--amber) 18%, transparent) 0%, transparent 50%, color-mix(in oklab, var(--ink) 10%, transparent) 100%), repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in oklab, var(--ink) 4%, transparent) 6px 7px), var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: 3,
          position: 'relative',
        }}>
          <span className="mono" style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 9, letterSpacing: '0.06em', color: 'var(--paper)', background: 'color-mix(in oklab, var(--ink) 80%, transparent)', padding: '1px 5px' }}>
            IMG · {result.dims || '—'}
          </span>
        </div>
        {result.caption && <figcaption className="mono text-[10px] text-faint mt-2 tracking-[0.06em]">{result.caption}</figcaption>}
      </figure>
    );
  }
  if (result.kind === 'file') {
    return (
      <div className="mt-3 mb-1 inline-flex items-baseline gap-3 px-3 py-2 border border-rule rounded-sm flex-wrap">
        <span className="mono text-[12px] text-accent">▤</span>
        <span className="mono text-[11.5px] text-ink">{result.label || result.name}</span>
        <span className="mono text-[10px] text-faint">· {result.size_kb ? result.size_kb + ' kb' : result.size}</span>
        {result.access && <span className="mono text-[9.5px] tracking-[0.12em] uppercase text-violet">· {result.access}</span>}
        <a href={result.action ? result.action.href : '#'} className="mono text-[10px] tracking-[0.16em] uppercase text-muted hover:text-accent ml-2">{result.action ? result.action.label : 'download'} ↓</a>
      </div>
    );
  }
  if (result.kind === 'gallery') {
    return (
      <div className="mt-3 mb-1 grid grid-cols-2 sm:grid-cols-3 gap-2" style={{ maxWidth: '520px' }}>
        {result.images.map((im, i) => (
          <div key={i} style={{
            aspectRatio: '1/1',
            background: 'linear-gradient(135deg, color-mix(in oklab, var(--' + (im.hue || 'amber') + ') 18%, transparent), transparent 60%), repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in oklab, var(--ink) 4%, transparent) 6px 7px), var(--surface)',
            border: '1px solid var(--rule)', borderRadius: 3, position: 'relative',
          }}>
            <span className="mono" style={{ position: 'absolute', bottom: 5, left: 6, fontSize: 8, letterSpacing: '0.04em', color: 'var(--paper)', background: 'color-mix(in oklab, var(--ink) 80%, transparent)', padding: '1px 4px' }}>{im.label}</span>
          </div>
        ))}
      </div>
    );
  }
  if (result.kind === 'code') {
    return (
      <pre className="mt-3 mb-1" style={{ background: 'color-mix(in oklab, var(--ink) 6%, var(--paper))', border: '1px solid var(--rule)', borderRadius: 3, padding: '12px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.55, color: 'var(--ink)', overflowX: 'auto' }}>
        {result.lang && <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>{result.lang}</div>}
        {result.code}
      </pre>
    );
  }
  if (result.kind === 'embed') {
    // a linked card to a wiki/output/post entry
    return (
      <a href={result.href || '#'} className="mt-3 mb-1 block border border-rule rounded-sm overflow-hidden hover:border-ink transition-colors" style={{ maxWidth: '440px' }}>
        <div style={{ height: 4, background: 'var(--' + (result.hue || 'amber') + ')' }} />
        <div className="px-4 py-3">
          <div className="mono text-[9.5px] tracking-[0.16em] uppercase text-muted mb-1">{result.source || 'corpus'} · {result.date || ''}</div>
          <div className="font-serif text-ink" style={{ fontSize: 16, lineHeight: 1.25, letterSpacing: '-0.005em' }}>{result.title}</div>
          {result.excerpt && <p className="reading text-muted mt-1.5" style={{ fontSize: 13.5 }}>{result.excerpt}</p>}
          <div className="mono text-[10px] tracking-[0.14em] uppercase text-accent mt-2">open ↗</div>
        </div>
      </a>
    );
  }
  if (result.kind === 'quote') {
    return (
      <blockquote className="mt-3 mb-1 pl-4 border-l-2 border-accent/40" style={{ maxWidth: '40em' }}>
        <p className="font-serif italic text-ink" style={{ fontSize: 17, lineHeight: 1.5 }}>{result.text}</p>
        {result.attribution && <div className="mono text-[10px] tracking-[0.06em] text-faint mt-2">— {result.attribution}</div>}
      </blockquote>
    );
  }
  if (result.kind === 'link') {
    return (
      <a href={result.href || '#'} className="mt-3 mb-1 inline-flex items-baseline gap-2 link mono text-[12.5px] tracking-[0.02em]">
        {result.label || result.href} ↗
      </a>
    );
  }
  return null;
}

function AnswerBody({ answer }) {
  return (
    <div>
      {answer.private && !answer.byoaiBlocked && !answer.byoaiError && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">
          private · layered access
        </div>
      )}
      {answer.byoaiBlocked && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">
          public scope only · need a code
        </div>
      )}
      {answer.byoaiError && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">
          ⚠ byoai · {answer.byoaiError}
        </div>
      )}
      <div className={(answer.private || answer.byoaiBlocked || answer.byoaiError) ? 'pl-5 border-l-2 border-accent/40' : ''}>
        {answer.paras.map((p, i) => (
          <p key={i} className="reading mb-4 last:mb-0" style={{ fontSize: '18px' }}>{p}</p>
        ))}
      </div>
      {/* rich media · supports both `tools` (corpus entries) and `tool_calls` (live tool runs) */}
      {(answer.tools || answer.tool_calls || []).map((tc, i) => (
        <ToolCallBlock key={i} tool={tc.tool} result={tc.result || tc} />
      ))}
      {answer.cta && (
        <div className="mt-5">
          <a href={answer.cta.href} className="link mono text-[12.5px] tracking-[0.02em]">
            {answer.cta.label} ↗
          </a>
        </div>
      )}
      <Citations cites={answer.cites} />
    </div>
  );
}

function Thinking() {
  return (
    <div className="mono text-muted text-[11px] tracking-[0.18em] uppercase mt-3">
      retrieving <span className="dot">·</span><span className="dot">·</span><span className="dot">·</span>
    </div>
  );
}

function Turn({ idx, item }) {
  return (
    <article id={`qa-${idx}`} className="pt-10 pb-10 border-b border-rule">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
        <span className="text-ink">you</span>
        <span className="text-faint normal-case tracking-[0.06em]">· {item.time}</span>
        {item.viaMenu && <span className="text-faint normal-case tracking-[0.06em]">· from menu</span>}
      </div>
      <p
        className="font-serif italic mb-7"
        style={{ fontSize: '22px', lineHeight: 1.3, fontWeight: 380, letterSpacing: '-0.003em', textWrap: 'pretty' }}
      >
        {item.q}
      </p>
      {!item.pending && (
        <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-accent mb-3">
          sijie's ai
        </div>
      )}
      {item.pending ? <Thinking /> : <AnswerBody answer={item.answer} />}
    </article>
  );
}

function ConversationDeck({ conv, onReset }) {
  return (
    <section id="conversation" className="mt-16">
      <DeckHeader
        kicker="conversation"
        count={conv.length}
        action={
          <button
            onClick={onReset}
            className="mono text-[10px] tracking-[0.16em] uppercase text-muted hover:text-accent transition-colors"
          >
            ↺ reset
          </button>
        }
      />
      {conv.map((it, i) => <Turn key={it.id} idx={i} item={it} />)}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK ASK — the 12 most-asked questions, grouped, click to ask

function QuickAskDeck({ askedKeys, onAsk }) {
  let idx = 0;
  return (
    <section className="mt-24">
      <DeckHeader kicker="what people usually ask" count={12} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-3">
        {SECTIONS.map((sec) => (
          <div key={sec.id}>
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted pb-2 mb-1 border-b border-rule">
              {sec.title}
            </div>
            <ul>
              {sec.questions.map((q) => {
                idx += 1;
                const asked = askedKeys.has(q.key);
                return (
                  <li key={q.id}>
                    <button
                      onClick={() => onAsk(q.label, q.key, true)}
                      className="group w-full text-left flex items-baseline gap-2.5 py-1.5 border-b border-rule/40 transition-colors"
                    >
                      <span className="mono text-[9.5px] text-faint tabular-nums shrink-0 w-5 pt-1">
                        {String(idx).padStart(2, '0')}
                      </span>
                      <span
                        className={`font-serif flex-1 transition-colors ${asked ? 'text-muted line-through decoration-faint/60' : 'text-ink group-hover:text-accent'}`}
                        style={{ fontSize: '14.5px', lineHeight: 1.4, fontWeight: 400, letterSpacing: '-0.002em' }}
                      >
                        {q.label}
                      </span>
                      {q.private && !asked && (
                        <span className="mono text-[9px] tracking-[0.14em] uppercase text-accent shrink-0 pt-1">
                          private
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSIGHTS — Section A · thesis + context + expandable body

function InsightsDeck({ insights, expanded, onToggle }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="things I've been thinking about" count={insights.length} />
      <ol className="space-y-7">
        {insights.map((i, idx) => {
          const open = expanded.has(i.id);
          return (
            <li key={i.id} className="grid grid-cols-[28px_1fr] gap-5">
              <span className="mono text-[10px] tracking-[0.14em] text-faint tabular-nums pt-2.5">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <div>
                <button
                  onClick={() => onToggle(i.id)}
                  className="group w-full text-left"
                >
                  <p
                    className="font-serif text-ink group-hover:text-accent transition-colors"
                    style={{ fontSize: '20px', lineHeight: 1.4, fontWeight: 500, letterSpacing: '-0.005em' }}
                  >
                    {i.thesis}
                  </p>
                  <p
                    className="mono text-faint mt-1.5"
                    style={{ fontSize: '11px', letterSpacing: '0.04em' }}
                  >
                    ── {i.context}
                    <span className={`ml-3 transition-colors ${open ? 'text-accent' : 'text-faint group-hover:text-muted'}`}>
                      {open ? '[ close ]' : '[ read more ]'}
                    </span>
                  </p>
                </button>
                {open && (
                  <p
                    className="reading text-muted mt-4 fadein"
                    style={{ fontSize: '16.5px', maxWidth: '38em' }}
                  >
                    {i.body}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTS — Section B · typography only, no screenshots

function ProjectsDeck({ projects }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="what I'm building" count={projects.length} />
      <ul className="space-y-9">
        {projects.map((p) => (
          <li key={p.id}>
            <div className="flex items-baseline gap-3 flex-wrap mb-3">
              <h3
                className="font-serif text-ink"
                style={{ fontSize: '24px', fontWeight: 500, letterSpacing: '-0.012em', lineHeight: 1.1 }}
              >
                {p.name}
              </h3>
              <span className="mono text-faint">──</span>
              <span className="font-serif italic text-muted" style={{ fontSize: '17px', lineHeight: 1.3 }}>
                {p.tagline}
              </span>
            </div>
            <div
              className="reading text-ink space-y-1.5 pl-5 border-l border-rule"
              style={{ fontSize: '16px' }}
            >
              {p.lines.map((line, i) => <p key={i}>{line}</p>)}
              {p.url && (
                <p className="mono text-[12.5px] tracking-[0.04em] pt-1">
                  <a
                    href={`https://${p.url}`}
                    className="text-accent border-b border-accent/40 hover:border-accent transition-colors"
                  >
                    {p.url} ↗
                  </a>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WHERE I AM — Section C · location + employment posture + filter

function WhereDeck({ where }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="where I am" />
      <div className="reading text-ink" style={{ fontSize: '18px' }}>
        <p>{where.location_line}</p>
        <p className="mt-4">{where.status_prose}</p>
        <p className="mt-5 mono text-[10.5px] tracking-[0.2em] uppercase text-muted">
          if you're hiring, it should fit all of these
        </p>
        <ul
          className="space-y-1 mt-2 pl-5 border-l-2 border-accent/40 font-serif text-ink"
          style={{ fontSize: '16.5px' }}
        >
          {where.looking_for.map((f, i) => (
            <li key={i}>· {f}</li>
          ))}
        </ul>
        <p className="font-serif italic text-muted mt-6">{where.closing}</p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACT — Section D

function ContactDeck({ contact, onFocusChat }) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="how to talk to me" />
      <div className="reading text-ink space-y-5" style={{ fontSize: '18px' }}>
        <p>
          {contact.chat_line}
          {' '}
          <button
            onClick={onFocusChat}
            className="mono text-[11px] tracking-[0.16em] uppercase text-accent border-b border-accent/40 hover:border-accent transition-colors ml-1"
          >
            jump to chat ↑
          </button>
        </p>
        <p>
          Or directly:
          {' '}
          <a
            href={`mailto:${contact.email}`}
            className="mono text-accent border-b border-accent/40 hover:border-accent transition-colors"
            style={{ fontSize: '15.5px' }}
          >
            {contact.email}
          </a>
        </p>
        <p className="text-muted">{contact.recruiter_prose}</p>
        <p className="text-muted">{contact.casual_prose}</p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// app

function ByoaiBanner({ provider }) {
  return (
    <div className="mx-6 lg:mx-0 mt-6 max-w-[760px] lg:mx-auto">
      <div className="crosshair-banner relative border border-accent/40 bg-paper/60 px-4 py-3 flex items-baseline justify-between gap-4 flex-wrap">
        <div className="mono text-[10.5px] tracking-[0.16em] uppercase flex items-baseline gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
            <span className="text-accent">byoai mode</span>
          </span>
          <span className="text-faint">·</span>
          <span className="text-muted">model · {provider}</span>
          <span className="text-faint">·</span>
          <span className="text-muted">public scope</span>
        </div>
        <div className="mono text-[10px] tracking-[0.14em] uppercase flex items-baseline gap-4">
          <span className="text-faint normal-case tracking-[0.06em]">private topics return "need a code"</span>
          <a href="gate.html#request" className="text-muted hover:text-accent transition-colors">request a code ↗</a>
          <a href="?" className="text-faint hover:text-ink transition-colors">exit byoai</a>
        </div>
      </div>
    </div>
  );
}

function CapabilityStrip({ tools }) {
  if (!tools || !tools.length) return null;
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 24px', borderBottom: '1px solid var(--rule)', background: 'color-mix(in oklab, var(--surface) 50%, transparent)' }}>
      {tools.map((t) => (
        <span key={t.id} title={t.tip} style={{ color: t.on ? 'var(--ink)' : 'var(--faint)', cursor: 'help' }}>
          {t.on ? '✓' : '○'} {t.id}
        </span>
      ))}
    </div>
  );
}

function CodedBanner({ code, visitor, quota }) {
  // small label-table for known codes so the banner can name the slice
  const CODE_LABEL = {
    'OAEN-3K2': 'OpenAI eng loop',
    'A16Z-9V1': 'a16z partner intro',
    'STRA-5T8': 'Stripe advisor chat',
  };
  const label = CODE_LABEL[code] || 'invited';
  const warn = quota && (quota.used / quota.max) >= 0.8;
  return (
    <div className="mx-6 lg:mx-0 mt-6 max-w-[760px] lg:mx-auto">
      <div className="relative border border-accent/40 bg-paper/60 px-4 py-3 flex items-baseline justify-between gap-4 flex-wrap">
        <div className="mono text-[10.5px] tracking-[0.16em] uppercase flex items-baseline gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
            <span className="text-accent">{label}</span>
          </span>
          <span className="text-faint">·</span>
          <span className="text-muted">code · {code}</span>
          {visitor && (
            <>
              <span className="text-faint">·</span>
              <span className="text-muted">you · <span className="text-ink normal-case tracking-[0.04em]">{visitor}</span></span>
            </>
          )}
          {quota && (
            <>
              <span className="text-faint">·</span>
              <span className={warn ? 'text-accent' : 'text-muted'}>
                {quota.used}/{quota.max} turns{warn ? ' · running low' : ''}
              </span>
            </>
          )}
        </div>
        <div className="mono text-[10px] tracking-[0.14em] uppercase flex items-baseline gap-4">
          <span className="text-faint normal-case tracking-[0.06em]">sijie reviews transcripts</span>
          <a href="?" className="text-faint hover:text-ink transition-colors">exit session</a>
        </div>
      </div>
    </div>
  );
}

function VisitorNamePicker({ code, expected = [], onPick }) {
  const [name, setName] = React.useState('');
  const [going, setGoing] = React.useState(false);
  const start = (n) => {
    if (!n.trim()) return;
    setGoing(true);
    setTimeout(() => onPick(n.trim()), 500);
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'color-mix(in oklab, var(--ink) 40%, transparent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div className="rise" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 3, width: '100%', maxWidth: 580 }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--rule)' }}>
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted">access granted · code {code}</div>
          <div className="font-serif" style={{ fontSize: 22, fontWeight: 400, marginTop: 4 }}>Who's reading?</div>
        </div>
        <div style={{ padding: '20px 28px' }}>
          <p className="reading text-ink" style={{ fontSize: 16, marginBottom: 14 }}>
            One last thing before the chat starts — is this you, or someone new on the panel? Sijie sees this in the transcript later.
          </p>
          {expected.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">expected on this code</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {expected.map((m, i) => (
                  <button key={i} onClick={() => start(m.name)} disabled={going} className="flex items-baseline justify-between px-4 py-3 border border-rule hover:border-ink transition-colors rounded-sm" style={{ background: 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>I'm <span style={{ fontWeight: 500 }}>{m.name}</span></span>
                    <span className="mono text-[10px] tracking-[0.1em] text-faint">last seen {m.last}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">{expected.length > 0 ? 'or — someone new' : 'your name'}</div>
          <form onSubmit={(e) => { e.preventDefault(); start(name); }} className="flex items-baseline gap-3 border border-rule rounded-sm px-4 py-3">
            <span className="text-accent font-serif shrink-0" style={{ fontSize: 20, lineHeight: 1 }}>›</span>
            <input type="text" value={name} onChange={(e)=>setName(e.target.value)} placeholder="your name" autoFocus
              className="flex-1 bg-transparent reading text-ink placeholder:text-faint min-w-0"
              style={{ fontSize: 16 }} />
            <button type="submit" disabled={going || !name.trim()} className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-accent disabled:text-faint">
              start ↵
            </button>
          </form>
          {going && (
            <div className="mono text-[10.5px] tracking-[0.16em] uppercase text-accent mt-4">
              starting chat<span className="dot">·</span><span className="dot">·</span><span className="dot">·</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHATROOM — focused chat layout for invited / BYOAI visitors. No marketing scroll.
// Header (identity + banner) → scrollable transcript → sticky composer at bottom.

function ChatComposer({ input, setInput, onSubmit, pending, suggestedPrompts }) {
  return (
    <div className="sticky bottom-0 z-30 bg-paper/95 backdrop-blur border-t border-rule pt-4 pb-5 -mx-6 lg:-mx-0 px-6 lg:px-0">
      <div className="max-w-[760px] mx-auto">
        {suggestedPrompts && suggestedPrompts.length > 0 && (
          <div className="flex flex-wrap gap-x-1 gap-y-2 mb-3 overflow-x-auto scroll-thin">
            <span className="mono text-[10px] tracking-[0.18em] uppercase text-faint mr-3 shrink-0 pt-0.5">try</span>
            {suggestedPrompts.map((q, i) => (
              <button
                key={i}
                onClick={() => onSubmit(q)}
                disabled={pending}
                className="font-serif italic text-muted hover:text-accent transition-colors text-left disabled:opacity-50 shrink-0"
                style={{ fontSize: '14.5px', lineHeight: 1.4 }}
              >
                "{q}"
                {i < suggestedPrompts.length - 1 && <span className="text-faint not-italic mx-2">/</span>}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); if (!pending && input.trim()) onSubmit(input.trim()); }}
        >
          <div className="flex items-baseline gap-4 py-3 border-t border-b border-ink relative">
            <span className="text-accent font-serif shrink-0" style={{ fontSize: '26px', lineHeight: 1 }}>›</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ask sijie's ai…"
              disabled={pending}
              className="flex-1 bg-transparent text-ink placeholder:text-faint font-serif min-w-0"
              style={{ fontSize: '22px', lineHeight: 1.3, fontWeight: 380 }}
              autoComplete="off"
              spellCheck="false"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="mono text-[11.5px] tracking-[0.18em] uppercase text-muted hover:text-accent disabled:text-faint transition-colors shrink-0 pt-1"
            >
              ask <span className="text-[14px]">↵</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChatWelcome({ content, mode, visitor, codeLabel, byoaiProvider, opener }) {
  return (
    <article className="pt-10 pb-10 border-b border-rule">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-accent mb-3">
        sijie's ai · ready
      </div>
      <div className="reading text-ink" style={{ fontSize: '17px', maxWidth: '54ch' }}>
        {mode === 'coded' && (
          <>
            <p>
              Hi{visitor ? ', ' + visitor.split(' ')[0] : ''}. I'm an AI grounded in {content.owner.full}'s
              curated corpus. You've come in on the{' '}
              <span className="text-accent">{codeLabel}</span> slice, which is what sijie scoped for this
              conversation — work, thinking, fit-related questions, and the bits of his background relevant
              to this loop.
            </p>
            <p className="mt-4">
              Private topics (fundraising, the inside story of why he left a previous role) are out of scope
              on this code — I'll say so plainly when you hit one. Everything else is on the record;
              sijie reads the transcripts afterward.
            </p>
            {!opener && (
              <p className="mt-4">
                Ask anything. Three starters below if you need a way in.
              </p>
            )}
          </>
        )}
        {mode === 'byoai' && (
          <>
            <p>
              Hi. I'm an AI grounded in {content.owner.full}'s curated corpus. You're running on your own
              {' '}<span className="text-accent">{byoaiProvider}</span> key — you pay for inference, he
              pays for retrieval, and I only have access to the public slice of the corpus.
            </p>
            <p className="mt-4">
              Work, projects, public takes — fair game. Private topics return a "need a code" response
              with a path to request one. Ask away.
            </p>
          </>
        )}
      </div>

      {/* owner-preset opener — sijie speaks first, steering the topic */}
      {opener && (
        <div className="mt-8 pt-7 border-t border-rule/60">
          <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
            <span className="text-ink">{content.owner.handle} · opening note</span>
            <span className="text-faint normal-case tracking-[0.06em]">· set for this code</span>
          </div>
          <p className="font-serif italic text-ink" style={{ fontSize: '21px', lineHeight: 1.5, fontWeight: 380, maxWidth: '32em', textWrap: 'pretty' }}>
            {opener}
          </p>
        </div>
      )}
    </article>
  );
}

function BookingOffer({ booking, visitor, owner }) {
  const [state, setState] = React.useState('idle'); // idle | open | booked
  const [picked, setPicked] = React.useState(null);
  const dur = booking.duration || 30;
  const slots = [
    { day: 'Tue · Jun 2', start: '10:30' },
    { day: 'Wed · Jun 3', start: '14:00' },
    { day: 'Thu · Jun 4', start: '09:00' },
  ].map((s) => {
    const [h, m] = s.start.split(':').map(Number);
    const end = new Date(2026, 5, 2, h, m + dur);
    return { ...s, time: s.start + '–' + String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0') + ' PT' };
  });
  if (state === 'booked') {
    return (
      <div className="mt-8 border border-accent/50 rounded-sm bg-paper/60 px-5 py-4 rise">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-2">✓ booked · added to calendar</div>
        <p className="reading text-ink" style={{ fontSize: 16 }}>
          {dur}-min with {owner.handle} · <span className="text-accent">{picked.day} · {picked.time}</span>.
          A calendar invite is on its way{visitor ? ' to ' + visitor.split(' ')[0] : ''}. {owner.handle} sees it on their side too.
        </p>
        <a href="#" className="link mono text-[12px] tracking-[0.04em] mt-3 inline-block">add to my calendar · .ics ↓</a>
      </div>
    );
  }
  return (
    <div className="mt-8 border border-rule rounded-sm bg-surface/40 px-5 py-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">
          ⌖ {owner.handle} opened {dur} min for this code
        </div>
        {state === 'idle' && (
          <button onClick={() => setState('open')} className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-3.5 py-2 hover:bg-accent transition-colors">
            see times →
          </button>
        )}
      </div>
      <p className="reading text-muted mt-2" style={{ fontSize: 14.5, maxWidth: '40em' }}>
        {booking.note || (dur + '-minute conversation')}. Pick a slot and it goes straight onto {owner.handle}'s calendar — no email back-and-forth.
      </p>
      {state === 'open' && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 rise">
          {slots.map((s, i) => (
            <button key={i} onClick={() => { setPicked(s); setState('booked'); }}
              className="text-left border border-rule rounded-sm px-3 py-2.5 hover:border-ink hover:bg-paper transition-colors">
              <div className="mono text-[11px] text-ink tracking-[0.04em]">{s.day}</div>
              <div className="mono text-[10px] text-muted mt-1">{s.time}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatRoom({ content, mode, visitor, codeParam, byoaiProvider, dark, onToggleDark, conv, input, setInput, ask, pending, onReset }) {
  // suggested starter prompts vary by mode
  const codedStarters = [
    'Walk me through your background.',
    'What did you actually own at your last role?',
    "What\u2019s a take you hold that most peers disagree with?",
  ];
  const byoaiStarters = [
    'What are you working on right now?',
    'How do you think about AI replacing engineers?',
    'What is Lucerna actually solving?',
  ];
  const starters = mode === 'byoai' ? byoaiStarters : codedStarters;

  const codeLabel = ({
    'OAEN-3K2': 'OpenAI eng loop',
    'A16Z-9V1': 'a16z partner intro',
    'STRA-5T8': 'Stripe advisor chat',
  })[codeParam] || 'invited';
  const codeOpener = ({
    'OAEN-3K2': 'Hi — you\u2019re here on the OpenAI eng loop, so I\u2019ll assume you want to know whether I\u2019d be a strong staff IC. Ask me anything, but if it helps: I think most of engineering is intention-translation, and I have strong opinions on eval. Where do you want to start?',
    'A16Z-9V1': 'Welcome. Since you\u2019re an investor: the short version is Lucerna is retrieval infrastructure for personal corpora, and the moat is the eval, not the model. I won\u2019t talk numbers here, but I\u2019ll happily go deep on why this is a category. What\u2019s your first question?',
    'STRA-5T8': 'Hey — advisor scoping. I take one or two founders a quarter, retrieval/eval only, equity not cash. Tell me what you\u2019re building and what you\u2019d actually want from me.',
  })[codeParam] || null;
  const codeBooking = ({
    'OAEN-3K2': { enabled: true, duration: 30, note: '30-min staff-IC chat' },
    'A16Z-9V1': { enabled: true, duration: 45, note: '45-min investor call' },
    'STRA-5T8': { enabled: false },
  })[codeParam] || null;

  // hide starters once visitor has asked anything
  const showStarters = conv.length === 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* slim top: brand left, identity + banner full-width right */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-3 border-b border-rule shrink-0 gap-4 sticky top-0 bg-paper/95 backdrop-blur z-20">
        <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3 shrink-0">
          <span className="text-ink">standmeet</span>
          <span className="text-faint">/</span>
          <span className="text-muted">{content.owner.handle}</span>
          <span className="ml-2 inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
            <span className="text-faint text-[10px] tracking-[0.16em]">live</span>
          </span>
        </div>

        <div className="flex items-center gap-5 shrink-0">
          {conv.length > 0 && (
            <button
              onClick={onReset}
              className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-accent transition-colors"
            >
              ↺ reset
            </button>
          )}
          <button
            onClick={onToggleDark}
            className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors"
          >
            {dark ? 'light' : 'dark'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div className="max-w-[760px] w-full mx-auto px-6 lg:px-0 flex-1 flex flex-col">
          <ChatWelcome
            content={content}
            mode={mode}
            visitor={visitor}
            codeLabel={codeLabel}
            byoaiProvider={byoaiProvider}
            opener={mode === 'coded' ? codeOpener : null}
          />

          {/* booking offer — when the code has calendar booking enabled */}
          {mode === 'coded' && codeBooking && codeBooking.enabled && (
            <BookingOffer booking={codeBooking} visitor={visitor} owner={content.owner} />
          )}

          {/* transcript */}
          <div className="flex-1">
            {conv.map((it, i) => <Turn key={it.id} idx={i} item={it} />)}
          </div>

          <ChatComposer
            input={input}
            setInput={setInput}
            onSubmit={(q) => ask(q)}
            pending={pending}
            suggestedPrompts={showStarters ? starters : null}
          />

          <p className="mono text-[10px] leading-[1.7] text-faint mt-3 mb-10">
            <span className="text-muted">how this works</span> · answers come from {content.owner.full}'s curated corpus.
            private topics return a redaction with next-steps rather than a guess.
            {mode === 'coded' && <> sijie reads the transcript afterward.</>}
            {mode === 'byoai' && <> your api key never leaves the browser.</>}
          </p>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [dark, setDark] = useTheme();
  const content = usePageContent();

  // BYOAI mode — detect from URL query string. If active, render the public page
  // as a chat-only experience, with a banner, and refuse private answers.
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const byoai = urlParams.get('byoai') === '1';
  const byoaiProvider = urlParams.get('p') || 'claude';
  const codeParam   = urlParams.get('c');
  const visitorName = urlParams.get('v');

  // Mock per-code quota lookup — wired up via the same CODE_LABEL pool in CodedBanner.
  // In production this comes from the backend on session start.
  const CODE_META = {
    'OAEN-3K2': { quota: { used: 11, max: 50 }, members: [{ name:'David Chen', last:'12 min ago' }, { name:'Sarah Park', last:'2 hours ago' }] },
    'A16Z-9V1': { quota: { used: 24, max: 30 }, members: [{ name:'Mira Yoshida', last:'2 days ago' }, { name:'James Liu', last:'3 days ago' }] },
    'STRA-5T8': { quota: { used: 5,  max: 20 }, members: [{ name:'Erin Bates', last:'6 days ago' }] },
  };
  const codeMeta = codeParam ? CODE_META[codeParam] : null;
  const quota = codeMeta ? codeMeta.quota : null;
  const expected = codeMeta ? codeMeta.members : [];

  // need-to-pick state: coded but no visitor name in URL → show picker once
  const [pickedVisitor, setPickedVisitor] = useState(visitorName);
  const needsPicker = codeParam && !pickedVisitor;
  const onPickVisitor = (n) => {
    setPickedVisitor(n);
    const p = new URLSearchParams(window.location.search);
    p.set('v', n);
    window.history.replaceState({}, '', window.location.pathname + '?' + p.toString());
  };

  useEffect(() => {
    const root = document.documentElement;
    if (t.accent) root.style.setProperty('--accent', t.accent);
  }, [t.accent]);

  const [input, setInput]     = useState('');
  const [conv, setConv]       = useState([]);
  const [pending, setPending] = useState(false);
  const [expandedInsights, setExpandedInsights] = useState(new Set());
  const prevLen = useRef(0);
  const inputRef = useRef(null);

  const ask = (q, knownKey, viaMenu = false) => {
    const id = Date.now();
    setConv((c) => [...c, { id, q, time: nowHM(), viaMenu, key: knownKey || null, pending: true, answer: null }]);
    setInput('');
    setPending(true);
    // tick the shared session quota so all surfaces stay in sync
    if (window.SMSession) window.SMSession.consume(1);
    setTimeout(() => {
      const key = knownKey || routeQuery(q);
      let ans = ANSWERS[key] || ANSWERS._unknown;
      // BYOAI mode: private topics get a gated CTA instead of the normal redaction
      if (byoai && ans && ans.private) {
        ans = {
          paras: [
            "That's outside the public scope of this corpus — sijie marked it as ask-with-an-invite-code only. BYOAI Mode is great for work, projects, public takes; for the private cut you'll need a code.",
          ],
          cites: [],
          byoaiBlocked: true,
          cta: { label: 'request an invite code', href: 'gate.html#request' },
        };
      }
      setConv((c) => c.map((it) => it.id === id
        ? { ...it, pending: false, answer: ans, key }
        : it
      ));
      setPending(false);
    }, 800);
  };

  const toggleInsight = (id) => {
    setExpandedInsights((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const focusChat = () => {
    if (inputRef.current) inputRef.current.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useLayoutEffect(() => {
    if (conv.length > prevLen.current && conv.length > 0) {
      const el = document.getElementById(`qa-${conv.length - 1}`);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 60;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }
    prevLen.current = conv.length;
  }, [conv.length]);

  const askedKeys = new Set(conv.map((c) => c.key).filter(Boolean));

  // dedicated chat layout for invited / BYOAI visitors; otherwise the long-scroll landing
  if (codeParam || byoai) {
    const mode = byoai ? 'byoai' : 'coded';
    return (
      <>
        {needsPicker && <VisitorNamePicker code={codeParam} expected={expected} onPick={onPickVisitor} />}
        {window.SM && window.SM.SessionStrip && <window.SM.SessionStrip />}
        <ChatRoom
          content={content}
          mode={mode}
          visitor={visitorName}
          codeParam={codeParam}
          byoaiProvider={byoaiProvider}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          conv={conv}
          input={input}
          setInput={setInput}
          ask={ask}
          pending={pending}
          onReset={() => setConv([])}
        />
        <TweaksPanel title="tweaks">
          <TweakSection label="appearance" />
          <TweakColor
            label="accent"
            value={t.accent}
            options={['#B5391C', '#2C4A7C', '#5E6E2F', '#1B1814']}
            onChange={(v) => setTweak('accent', v)}
          />
          <TweakToggle label="dark mode" value={dark} onChange={(v) => setDark(v)} />
        </TweaksPanel>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar dark={dark} onToggleDark={() => setDark((d) => !d)} />

      <main className="flex-1">
        <div className="max-w-[760px] mx-auto px-6 lg:px-0">
          <Hero
            content={content}
            input={input}
            setInput={setInput}
            onAsk={ask}
            pending={pending}
            inputRef={inputRef}
          />
          {conv.length > 0 && (
            <ConversationDeck conv={conv} onReset={() => setConv([])} />
          )}
          {t.showQuickAsk && <QuickAskDeck askedKeys={askedKeys} onAsk={ask} />}
          {t.showInsights && <InsightsDeck insights={content.insights} expanded={expandedInsights} onToggle={toggleInsight} />}
          {t.showProjects && <ProjectsDeck projects={content.projects} />}
          {t.showWhere    && <WhereDeck where={content.where} />}
          {t.showContact  && <ContactDeck contact={content.contact} onFocusChat={focusChat} />}
        </div>
      </main>

      <Footer content={content} />

      <TweaksPanel title="tweaks">
        <TweakSection label="appearance" />
        <TweakColor
          label="accent"
          value={t.accent}
          options={['#B5391C', '#2C4A7C', '#5E6E2F', '#1B1814']}
          onChange={(v) => setTweak('accent', v)}
        />
        <TweakToggle label="dark mode" value={dark} onChange={(v) => setDark(v)} />

        <TweakSection label="sections" />
        <TweakToggle label="what people ask" value={t.showQuickAsk} onChange={(v) => setTweak('showQuickAsk', v)} />
        <TweakToggle label="insights"        value={t.showInsights} onChange={(v) => setTweak('showInsights', v)} />
        <TweakToggle label="projects"        value={t.showProjects} onChange={(v) => setTweak('showProjects', v)} />
        <TweakToggle label="where i am"      value={t.showWhere}    onChange={(v) => setTweak('showWhere', v)} />
        <TweakToggle label="contact"         value={t.showContact}  onChange={(v) => setTweak('showContact', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
