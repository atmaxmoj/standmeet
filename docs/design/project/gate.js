/* global React, ReactDOM */

const { useState, useRef, useEffect } = React;

const OWNER = {
  handle: 'sijie',
  full:   'sijie wang',
  role:   'building Lucerna',
  one_liner: 'a private retrieval substrate for what i actually think',
};

// Mock valid codes — admin issues these. In real product, this is a backend check.
// Each entry mirrors what the admin VisitorPreviewModal already renders.
const CODE_META = {
  'OAEN3K2': {
    code: 'OAEN-3K2',
    label: 'OpenAI eng loop',
    members: [
      { name: 'David Chen',  last: '12 min ago' },
      { name: 'Sarah Park',  last: '2 hours ago' },
    ],
    scope: ['thinking', 'work', 'career', 'lucerna'],
    excluded: ['fundraising', 'private'],
  },
  'A16Z9V1': {
    code: 'A16Z-9V1',
    label: 'a16z partner intro',
    members: [
      { name: 'Mira Yoshida', last: '2 days ago' },
      { name: 'James Liu',    last: '3 days ago' },
    ],
    scope: ['lucerna', 'thinking', 'product', 'strategy', 'eval'],
    excluded: ['private', 'career'],
  },
  'STRA5T8': {
    code: 'STRA-5T8',
    label: 'Stripe advisor chat',
    members: [{ name: 'Erin Bates', last: '6 days ago' }],
    scope: ['lucerna', 'thinking', 'work'],
    excluded: ['private', 'fundraising'],
  },
};
const VALID_CODES = Object.keys(CODE_META);

// ─────────────────────────────────────────────────────────────────────────────
// chrome

function TopBar({ dark, onToggleDark }) {
  return (
    <header className="flex items-center justify-between px-6 md:px-10 pt-5 pb-5 border-b border-rule">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <span className="text-ink">standmeet</span>
        <span className="text-faint">/</span>
        <span className="text-muted">{OWNER.handle}</span>
        <span className="ml-3 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
          <span className="text-faint text-[10px] tracking-[0.16em]">private</span>
        </span>
      </div>
      <div className="flex items-center gap-6">
        <a href="#request" className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">
          request access
        </a>
        <button
          onClick={onToggleDark}
          aria-label="toggle theme"
          className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors"
        >
          {dark ? 'light' : 'dark'}
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// the seal — a visual anchor that says "gated" without saying it in words

function Seal() {
  return (
    <div className="relative shrink-0">
      <div className="seal">
        <div className="seal-text">
          <span>
            standmeet · {OWNER.handle}<br/>
            <span style={{ letterSpacing: '0.32em' }}>private</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// code entry — 7-char ascii cells (XXXX-NNN format, dash inserted visually)

const CODE_LEN = 7;

function CodeInput({ onValid, onInvalid }) {
  const [cells, setCells] = useState(Array(CODE_LEN).fill(''));
  const [state, setState] = useState('idle'); // idle | checking | error
  const refs = useRef([]);

  const focus = (i) => { if (refs.current[i]) refs.current[i].focus(); };

  const setCell = (i, v) => {
    const cleaned = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) {
      setCells((c) => c.map((x, j) => j === i ? '' : x));
      return;
    }
    // pasted whole code into a single cell — fan it out
    if (cleaned.length > 1) {
      const next = [...cells];
      let p = i;
      for (const ch of cleaned) {
        if (p >= CODE_LEN) break;
        next[p++] = ch;
      }
      setCells(next);
      focus(Math.min(p, CODE_LEN - 1));
      maybeSubmit(next);
      return;
    }
    setCells((cur) => {
      const next = cur.map((x, j) => j === i ? cleaned : x);
      if (i < CODE_LEN - 1) focus(i + 1);
      maybeSubmit(next);
      return next;
    });
  };

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !cells[i] && i > 0) {
      focus(i - 1);
      setCells((cur) => cur.map((x, j) => j === i - 1 ? '' : x));
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      focus(i - 1); e.preventDefault();
    } else if (e.key === 'ArrowRight' && i < CODE_LEN - 1) {
      focus(i + 1); e.preventDefault();
    } else if (e.key === 'Enter') {
      maybeSubmit(cells);
    }
  };

  const maybeSubmit = (next) => {
    if (next.every((c) => c.length === 1)) {
      const code = next.join('');
      setState('checking');
      setTimeout(() => {
        if (VALID_CODES.includes(code)) {
          setState('idle');
          onValid(code);
        } else {
          setState('error');
          onInvalid && onInvalid(code);
          setTimeout(() => {
            setState('idle');
            setCells(Array(CODE_LEN).fill(''));
            focus(0);
          }, 1100);
        }
      }, 600);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${state === 'error' ? 'shake' : ''}`}>
      {Array.from({ length: CODE_LEN }).map((_, i) => (
        <React.Fragment key={i}>
          <input
            ref={(el) => (refs.current[i] = el)}
            type="text"
            inputMode="text"
            maxLength={CODE_LEN}
            value={cells[i]}
            onChange={(e) => setCell(i, e.target.value.slice(-CODE_LEN))}
            onKeyDown={(e) => onKey(i, e)}
            disabled={state === 'checking'}
            className={`codecell ${cells[i] ? 'is-filled' : ''} ${state === 'error' ? 'is-error' : ''}`}
            aria-label={`code character ${i + 1}`}
          />
          {i === 3 && <span className="text-faint mono text-[18px] px-0.5 select-none">–</span>}
        </React.Fragment>
      ))}
      <div className="ml-3 mono text-[10.5px] tracking-[0.16em] uppercase">
        {state === 'checking' && <span className="text-muted">checking…</span>}
        {state === 'error'    && <span className="text-accent">unknown code</span>}
        {state === 'idle'     && <span className="text-faint">7 characters</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BYOAI panel — no-code visitors can chat using their own API key, public scope only

const PROVIDERS = [
  { id: 'claude', label: 'claude',  prefix: 'sk-ant-…', issuer: 'console.anthropic.com' },
  { id: 'openai', label: 'openai',  prefix: 'sk-…',     issuer: 'platform.openai.com' },
];

function MaskedKey({ value }) {
  if (!value) return null;
  const tail = value.slice(-4);
  return (
    <span className="mono text-[11px] tracking-[0.04em] text-muted">
      {Array.from({ length: 12 }).map((_, i) => <span key={i} className="keydot" />)}
      <span className="ml-1 text-ink">{tail}</span>
    </span>
  );
}

function BYOAIPanel({ enabled, blurb, providers, onStart }) {
  const allowed = providers && providers.length ? PROVIDERS.filter((p) => providers.includes(p.id)) : PROVIDERS;
  const [provider, setProvider] = useState(allowed[0]?.id || 'claude');
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [starting, setStarting] = useState(false);

  if (!enabled) return null;
  const valid = apiKey.trim().length > 12;
  const current = allowed.find((p) => p.id === provider) || allowed[0];

  const start = () => {
    if (!valid) return;
    setStarting(true);
    if (remember) {
      try {
        sessionStorage.setItem('byoai-provider', provider);
        sessionStorage.setItem('byoai-key', apiKey);
      } catch (e) {}
    }
    setTimeout(() => {
      onStart && onStart({ provider, apiKey });
    }, 600);
  };

  return (
    <section id="byoai" className="mt-14 pt-12 border-t border-rule">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <div>
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3 flex items-baseline gap-2">
            <span>no code?</span>
            <span className="text-faint">·</span>
            <span className="text-accent">BYOAI</span>
          </div>
          <h2 className="font-serif text-ink" style={{ fontSize: '28px', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
            Bring your own AI<span className="text-accent">.</span>
          </h2>
          <p className="reading text-muted mt-3" style={{ fontSize: '15.5px' }}>
            {blurb}
          </p>

          <ul className="mt-5 mono text-[10.5px] tracking-[0.06em] leading-[1.85] text-muted">
            <li><span className="text-faint">·</span> your key stays in your browser</li>
            <li><span className="text-faint">·</span> sijie pays for retrieval, you pay for inference</li>
            <li><span className="text-faint">·</span> private topics return "ask for a code"</li>
          </ul>
        </div>

        <div className="rise">
          {/* provider */}
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">choose a model</div>
          <div className="flex flex-wrap gap-2 mb-5">
            {allowed.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`provider-pick ${provider === p.id ? 'is-on' : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* key */}
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2 flex items-baseline justify-between">
            <span>{current?.label} api key</span>
            <a
              href={`https://${current?.issuer}`}
              target="_blank"
              rel="noopener"
              className="text-faint hover:text-ink lowercase tracking-[0.06em] text-[10px]"
            >
              get one at {current?.issuer} ↗
            </a>
          </div>
          <div className="flex items-baseline gap-3 border-b border-rule pb-1">
            <input
              type={reveal ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current?.prefix}
              className="flex-1 bg-transparent py-2 reading text-ink placeholder:text-faint"
              style={{ fontSize: '15.5px', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}
              autoComplete="off"
              spellCheck="false"
            />
            <button
              onClick={() => setReveal((r) => !r)}
              className="mono text-[10px] tracking-[0.12em] uppercase text-faint hover:text-ink shrink-0"
            >
              {reveal ? 'hide' : 'reveal'}
            </button>
          </div>

          <label className="mt-3 flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em] text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-accent shrink-0"
            />
            <span>remember in this browser for the session (cleared when you close the tab)</span>
          </label>

          {valid && !starting && (
            <div className="mt-4 mono text-[10px] tracking-[0.06em] text-muted flex items-baseline justify-between gap-3 flex-wrap">
              <span>ready · using <MaskedKey value={apiKey} /></span>
              <button
                onClick={start}
                className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors shrink-0"
              >
                start public chat ↗
              </button>
            </div>
          )}
          {!valid && (
            <div className="mt-4 mono text-[10px] tracking-[0.06em] text-faint">
              paste your key to unlock the public chat. keys typically start with <span className="text-muted">{current?.prefix}</span>
            </div>
          )}
          {starting && (
            <div className="mt-4 mono text-[10px] tracking-[0.16em] uppercase text-accent">
              warming up your model · routing to sijie's public corpus…
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function WhatsBehind() {
  const rows = [
    { kicker: '01', label: 'a chat, not a page',
      body: 'There’s no résumé to scroll. You ask questions, an AI answers in sijie’s voice, grounded only in things he’s actually written.' },
    { kicker: '02', label: 'a scoped slice',
      body: 'Each code unlocks a specific slice of the corpus — e.g. interview slice, investor slice, advisor slice. Private topics stay redacted.' },
    { kicker: '03', label: 'a single conversation, on the record',
      body: 'sijie sees the transcript afterward. Treat it like a meeting with someone who can’t make the time, not like ChatGPT.' },
  ];
  return (
    <ol className="mt-12 space-y-6">
      {rows.map((r) => (
        <li key={r.kicker} className="grid grid-cols-[28px_1fr] gap-5">
          <span className="mono text-[11px] tracking-[0.16em] text-faint tabular-nums pt-1.5">{r.kicker}</span>
          <div>
            <div className="mono text-[10px] tracking-[0.2em] uppercase text-ink mb-1.5">{r.label}</div>
            <p className="reading text-muted" style={{ fontSize: '15.5px' }}>{r.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// request access form — fallback for those without a code

function RequestPanel() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: '', org: '', email: '', why: '' });
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [open]);

  const valid = form.name.trim() && form.email.trim() && form.why.trim().length > 15;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    setSent(true);
  };

  return (
    <section id="request" ref={ref} className="mt-20 pt-14 border-t border-rule">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <div>
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3">no code?</div>
          <h2 className="font-serif text-ink" style={{ fontSize: '28px', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
            Tell {OWNER.handle} who you are<span className="text-accent">.</span>
          </h2>
          <p className="reading text-muted mt-3" style={{ fontSize: '15.5px' }}>
            A short note. If it's useful for you to talk to him — through the AI or in person — he'll
            send you back a code in a day or two. He reads these himself; it's not a form that goes
            into a queue.
          </p>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="mt-5 mono text-[11px] tracking-[0.16em] uppercase text-ink border border-ink px-3.5 py-2 hover:bg-ink hover:text-paper transition-colors"
            >
              write a note ↘
            </button>
          )}
        </div>

        {open && !sent && (
          <form onSubmit={submit} className="rise space-y-5">
            <Field label="your name" required>
              <input
                type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="first + last is fine"
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                style={{ fontSize: '16px' }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-5">
              <Field label="where you work">
                <input
                  type="text" value={form.org}
                  onChange={(e) => setForm({ ...form, org: e.target.value })}
                  placeholder="company / lab / project"
                  className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                  style={{ fontSize: '16px' }}
                />
              </Field>
              <Field label="email" required>
                <input
                  type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="for the code"
                  className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                  style={{ fontSize: '16px' }}
                />
              </Field>
            </div>
            <Field label="why you want to talk to him" required>
              <textarea
                value={form.why}
                onChange={(e) => setForm({ ...form, why: e.target.value })}
                placeholder={'two or three sentences. "interested in your work" is not enough. what specifically?'}
                rows={4}
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint resize-none"
                style={{ fontSize: '16px', lineHeight: 1.55 }}
              />
              <div className="mono text-[10px] tracking-[0.12em] text-faint mt-1.5">
                <span className={form.why.length > 15 ? 'text-muted' : 'text-faint'}>{form.why.length}</span> / ~ 200
              </div>
            </Field>
            <div className="flex items-center justify-between pt-2">
              <span className="mono text-[10px] tracking-[0.12em] text-faint">
                goes straight to sijie · expect 1–3 days
              </span>
              <button
                type="submit"
                disabled={!valid}
                className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors disabled:opacity-30"
              >
                send ↵
              </button>
            </div>
          </form>
        )}

        {sent && (
          <div className="rise">
            <div className="mono text-[10px] tracking-[0.2em] uppercase text-accent mb-3">sent</div>
            <p className="reading text-ink" style={{ fontSize: '17px' }}>
              Thanks, {form.name.split(' ')[0]}. Sijie will read this himself.
              If he sends you a code, it'll arrive at <span className="text-accent">{form.email}</span>
              {' '}with a note about which slice of his corpus he's giving you access to.
            </p>
            <p className="reading text-muted mt-4" style={{ fontSize: '15.5px' }}>
              He doesn't reply to every note. If you don't hear back in a week, that's the reply.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">
        {label}{required && <span className="text-accent ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// granted state — valid code entered → identity picker (chooses existing member
// or types a new name) → routes to /sijie?c=CODE&v=Name

function IdentityPicker({ code, onContinue }) {
  const meta = CODE_META[code] || { code, label: '—', members: [], scope: [], excluded: [] };
  const [mode, setMode] = useState('pick');     // 'pick' | 'new'
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState(null);
  const [going, setGoing] = useState(false);

  const go = (finalName) => {
    setChosen(finalName);
    setGoing(true);
    const params = new URLSearchParams({ c: meta.code, v: finalName });
    setTimeout(() => {
      window.location.href = 'index.html?' + params.toString();
    }, 700);
  };

  return (
    <div className="rise mt-10 border border-rule p-7 rounded-sm bg-surface/60 crosshair">
      <span className="ch-tl" /><span className="ch-br" />

      <div className="flex items-baseline justify-between">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-accent">access granted</div>
        <div className="mono text-[11px] tracking-[0.06em] text-muted">code · {meta.code}</div>
      </div>

      <p className="reading text-ink mt-4" style={{ fontSize: '17px', maxWidth: '34em' }}>
        You've been let in on the <span className="text-accent">{meta.label}</span> slice.
        Before we start — is this you, or someone new on the panel?
      </p>

      {going && (
        <div className="mt-6 mono text-[10.5px] tracking-[0.16em] uppercase text-accent">
          starting chat as <span className="text-ink normal-case tracking-[0.04em]">{chosen}</span>
          <span className="text-faint normal-case tracking-[0.04em] ml-3">routing to the corpus…</span>
        </div>
      )}

      {!going && (
        <>
          {/* expected members */}
          {meta.members.length > 0 && (
            <div className="mt-6">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">
                expected on this code
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {meta.members.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => go(m.name)}
                    className="flex items-baseline justify-between text-left px-4 py-3 border border-rule hover:border-ink hover:bg-paper transition-colors rounded-sm"
                  >
                    <span className="font-serif text-ink" style={{ fontSize: '16px' }}>
                      I'm <span className="font-medium">{m.name}</span>
                    </span>
                    <span className="mono text-[10px] tracking-[0.12em] text-faint">last seen {m.last}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* someone new */}
          <div className="mt-6">
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">
              {meta.members.length > 0 ? 'or — someone new' : 'who are you?'}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (name.trim()) go(name.trim()); }}
              className="flex items-baseline gap-3 border border-rule rounded-sm px-4 py-3 bg-paper"
            >
              <span className="text-accent font-serif shrink-0" style={{ fontSize: '20px', lineHeight: 1 }}>›</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={meta.members.length > 0 ? "your name (so sijie can label the session)" : "your name"}
                className="flex-1 bg-transparent reading text-ink placeholder:text-faint min-w-0"
                style={{ fontSize: '16px' }}
                autoFocus={meta.members.length === 0}
              />
              <button
                type="submit"
                disabled={!name.trim()}
                className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-accent disabled:text-faint shrink-0"
              >
                start ↵
              </button>
            </form>
          </div>

          {/* scope hint */}
          <div className="mt-7 pt-4 border-t border-rule/70 mono text-[10px] tracking-[0.12em] text-faint leading-[1.7]">
            this code gives access to: <span className="text-muted">{meta.scope.join(' · ')}</span>
            {meta.excluded.length > 0 && <><br/>excluded: <span className="text-accent">{meta.excluded.join(' · ')}</span></>}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// theme

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem('standmeet-dark');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    return false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('standmeet-dark', dark ? '1' : '0'); } catch (e) {}
  }, [dark]);
  return [dark, setDark];
}

// ─────────────────────────────────────────────────────────────────────────────
// app

function App() {
  const [dark, setDark] = useTheme();
  const [granted, setGranted] = useState(null);
  const content = window.loadPageContent ? window.loadPageContent() : null;
  const owner = content?.owner || OWNER;
  const byoaiEnabled = owner.byoai_enabled !== false;
  const byoaiBlurb = owner.byoai_public_blurb || "You'll get the public slice of the corpus.";
  const byoaiProviders = owner.byoai_providers || ['claude', 'openai'];

  const startBYOAI = ({ provider, apiKey }) => {
    // hand off to the public page in BYOAI mode
    const params = new URLSearchParams({ byoai: '1', p: provider });
    window.location.href = 'index.html?' + params.toString();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar dark={dark} onToggleDark={() => setDark((d) => !d)} />

      <main className="flex-1">
        <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-14 lg:py-20">

          {/* hero — seal on left, identity + state on right */}
          <section className="grid grid-cols-1 md:grid-cols-[224px_1fr] gap-10 items-start">
            <div className="flex justify-center md:justify-start">
              <Seal />
            </div>

            <div>
              <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-muted mb-3">
                you've reached {OWNER.handle}'s corpus
              </div>
              <h1
                className="font-serif text-ink"
                style={{
                  fontSize: 'clamp(42px, 5.8vw, 64px)',
                  fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1,
                }}
              >
                This isn't open.<span className="text-accent">.</span>
              </h1>
              <p
                className="font-serif italic text-muted mt-4"
                style={{ fontSize: '18.5px', lineHeight: 1.45, fontWeight: 380, maxWidth: '32em' }}
              >
                {OWNER.handle} gives out codes when there's a reason to talk —
                a hiring loop, an investor call, an advisor scoping, a piece of press.
                If you have a code, drop it in.{byoaiEnabled ? ' Otherwise — bring your own AI to chat with my public corpus, or leave a note.' : ' If not, leave a note below; he reads them himself.'}
              </p>

              {/* code entry */}
              <div className="mt-9">
                <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3">
                  have a code?
                </div>
                {!granted && (
                  <CodeInput
                    onValid={(c) => setGranted(c)}
                    onInvalid={() => {}}
                  />
                )}
                {granted && <IdentityPicker code={granted} />}

                {!granted && (
                  <p className="mono text-[10.5px] tracking-[0.12em] text-faint mt-4 leading-[1.7]" style={{ maxWidth: '40em' }}>
                    codes look like <span className="text-muted">OAEN–3K2</span>. they arrive by email
                    from sijie directly · case doesn't matter · paste the whole thing into the first box.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* BYOAI */}
          <BYOAIPanel
            enabled={byoaiEnabled}
            blurb={byoaiBlurb}
            providers={byoaiProviders}
            onStart={startBYOAI}
          />

          {/* what's behind */}
          <WhatsBehind />

          {/* request panel */}
          <RequestPanel />

          {/* footnote */}
          <p className="mono text-[10px] leading-[1.7] text-faint mt-20 max-w-[44em]">
            <span className="text-muted">how this works</span> · standmeet replaces a résumé / linkedin / cold-email reply
            with a scoped, on-the-record conversation. it isn't a chatbot demo. every code is hand-issued and every
            transcript is reviewed by {OWNER.handle}.
          </p>
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-8 mono text-[11px] leading-[1.7] text-muted flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
          <div>
            <span className="text-ink">standmeet</span>
            <span className="text-faint mx-2">·</span>
            <span>private corpus retrieval</span>
            <span className="text-faint mx-2">·</span>
            <span>by hand, not by feed</span>
          </div>
          <div>
            <a className="hover:text-ink transition-colors" href="#">about standmeet</a>
            <span className="text-faint mx-2">·</span>
            <a className="hover:text-ink transition-colors" href="#">policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
