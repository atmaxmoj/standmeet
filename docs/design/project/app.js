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
        <div>
          <span className="text-faint">standmeet · </span>
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
        className="font-serif text-ink"
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

function AnswerBody({ answer }) {
  return (
    <div>
      {answer.private && !answer.byoaiBlocked && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">
          private · layered access
        </div>
      )}
      {answer.byoaiBlocked && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">
          public scope only · need a code
        </div>
      )}
      <div className={(answer.private || answer.byoaiBlocked) ? 'pl-5 border-l-2 border-accent/40' : ''}>
        {answer.paras.map((p, i) => (
          <p key={i} className="reading mb-4 last:mb-0" style={{ fontSize: '18px' }}>{p}</p>
        ))}
      </div>
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

function CodedBanner({ code, visitor }) {
  // small label-table for known codes so the banner can name the slice
  const CODE_LABEL = {
    'OAEN-3K2': 'OpenAI eng loop',
    'A16Z-9V1': 'a16z partner intro',
    'STRA-5T8': 'Stripe advisor chat',
  };
  const label = CODE_LABEL[code] || 'invited';
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
        </div>
        <div className="mono text-[10px] tracking-[0.14em] uppercase flex items-baseline gap-4">
          <span className="text-faint normal-case tracking-[0.06em]">sijie reviews transcripts</span>
          <a href="?" className="text-faint hover:text-ink transition-colors">exit session</a>
        </div>
      </div>
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

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar dark={dark} onToggleDark={() => setDark((d) => !d)} />
      {byoai && <ByoaiBanner provider={byoaiProvider} />}
      {!byoai && codeParam && <CodedBanner code={codeParam} visitor={visitorName} />}

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
