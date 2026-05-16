/* global React, ReactDOM */

const { useState, useRef, useEffect, useMemo } = React;

// ─────────────────────────────────────────────────────────────────────────────
// mock auth state — localStorage only, demo purposes

const AUTH_KEY = 'standmeet-auth';
const INSTANCE_KEY = 'standmeet-instance';

function loadInstance() {
  try { return JSON.parse(localStorage.getItem(INSTANCE_KEY) || 'null'); } catch (e) { return null; }
}
function saveInstance(i) {
  try { localStorage.setItem(INSTANCE_KEY, JSON.stringify(i)); } catch (e) {}
}
function saveSession(s) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); } catch (e) {}
}
function clearSession() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
}

// generate a short instance fingerprint to make self-host feel real
function makeInstanceHash() {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// shared chrome

function DeployStrip({ instance }) {
  return (
    <div className="border-b border-rule px-6 lg:px-10 py-2.5 flex items-center justify-between mono text-[10.5px] tracking-[0.12em]">
      <div className="flex items-baseline gap-3 uppercase">
        <span className="text-ink">standmeet</span>
        <span className="text-faint">/</span>
        <span className="text-muted">self-hosted</span>
        <span className="ml-3 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
          <span className="text-faint text-[10px]">v1.4.0</span>
        </span>
      </div>
      <div className="flex items-baseline gap-4 text-faint">
        <span>deployed at</span>
        <span className="text-muted">{instance?.host || 'localhost:3000'}</span>
        <span>·</span>
        <span>instance</span>
        <span className="text-muted">{instance?.hash || '—'}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN IN — existing instance, owner already claimed

function SignIn({ instance, onSignedIn, onSwitchMode }) {
  const [email, setEmail] = useState(instance?.owner_email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('email + password required'); return; }
    setBusy(true);
    setTimeout(() => {
      // mock: any non-empty password works against the claimed owner email
      if (instance && instance.owner_email && email.trim().toLowerCase() !== instance.owner_email.toLowerCase()) {
        setError('that email isn’t the owner of this instance');
        setBusy(false);
        return;
      }
      saveSession({
        email: email.trim(),
        name: instance?.owner_name || email.split('@')[0],
        handle: instance?.owner_handle || 'sijie',
        signed_in_at: new Date().toISOString(),
      });
      onSignedIn();
    }, 700);
  };

  return (
    <section className="rise">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3">sign in</div>
      <h1 className="font-serif text-ink" style={{ fontSize: 'clamp(38px, 5vw, 56px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1 }}>
        Sign in to your<br/>corpus<span className="text-accent">.</span>
      </h1>
      <p className="font-serif italic text-muted mt-4" style={{ fontSize: '17px', lineHeight: 1.45, maxWidth: '34em' }}>
        This is your own deployment. Authenticate as the owner and you'll land in admin.
      </p>

      <form onSubmit={submit} className="mt-10 max-w-[480px] space-y-5">
        <Field label="email">
          <input
            type="email" value={email} onChange={(e)=>setEmail(e.target.value)}
            placeholder={instance?.owner_email || 'you@example.com'}
            disabled={busy}
            className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
            style={{ fontSize: '17px' }}
            autoFocus autoComplete="email"
          />
        </Field>
        <Field label="password">
          <input
            type="password" value={password} onChange={(e)=>setPassword(e.target.value)}
            placeholder="••••••••••••"
            disabled={busy}
            className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
            style={{ fontSize: '17px', letterSpacing: '0.04em' }}
            autoComplete="current-password"
          />
        </Field>
        {error && <div className="mono text-[11px] tracking-[0.06em] text-accent">{error}</div>}
        <div className="flex items-baseline justify-between pt-2">
          <a href="#" className="mono text-[10.5px] tracking-[0.12em] text-muted hover:text-ink">forgot password?</a>
          <button
            type="submit"
            disabled={busy}
            className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors disabled:opacity-40"
          >
            {busy ? 'authenticating\u2026' : 'sign in ↵'}
          </button>
        </div>
      </form>

      <div className="mt-10 pt-7 border-t border-rule mono text-[10.5px] tracking-[0.06em] text-faint">
        <p>
          this is a fresh deployment{' '}
          <button onClick={() => onSwitchMode('setup')} className="link mono text-[10.5px]">claim it →</button>
        </p>
        <p className="mt-2">
          self-hosting? <a className="hover:text-ink" href="#">docs</a>
          {' '}<span className="text-faint">·</span>{' '}
          <a className="hover:text-ink" href="#">deploy with docker</a>
          {' '}<span className="text-faint">·</span>{' '}
          <a className="hover:text-ink" href="#">deploy to fly.io</a>
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRST-RUN SETUP — claim a fresh instance

function Setup({ onClaimed, onSwitchMode, hash }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    full: 'sijie wang',
    handle: 'sijie',
    email: 'hello@sijiewang.com',
    password: '',
    passwordConfirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    if (e) e.preventDefault();
    setError(null);
    if (!form.email.trim() || !form.password) { setError('email + password required'); return; }
    if (form.password.length < 8)                { setError('password must be at least 8 characters'); return; }
    if (form.password !== form.passwordConfirm)  { setError('passwords don’t match'); return; }
    setBusy(true);
    setTimeout(() => {
      const instance = {
        hash,
        host: window.location.host || 'localhost:3000',
        owner_email: form.email.trim(),
        owner_name: form.full,
        owner_handle: form.handle || form.email.split('@')[0],
        created_at: new Date().toISOString(),
      };
      saveInstance(instance);
      saveSession({
        email: instance.owner_email,
        name: instance.owner_name,
        handle: instance.owner_handle,
        signed_in_at: new Date().toISOString(),
      });
      onClaimed(instance);
    }, 900);
  };

  return (
    <section className="rise">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3 flex items-baseline gap-3">
        <span>first-run setup</span>
        <span className="text-faint">·</span>
        <span className="text-faint">step {step} of 2</span>
      </div>
      <h1 className="font-serif text-ink" style={{ fontSize: 'clamp(38px, 5vw, 56px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1 }}>
        Claim this<br/>instance<span className="text-accent">.</span>
      </h1>
      <p className="font-serif italic text-muted mt-4" style={{ fontSize: '17px', lineHeight: 1.45, maxWidth: '36em' }}>
        Nobody has claimed this deployment yet. The first person to sign up becomes the owner.
        Everything (corpus, codes, content) lives in your own database.
      </p>

      {/* deployment confirmation terminal block */}
      <div className="crosshair scanline border border-rule bg-surface/60 mt-8 p-4 mono text-[11.5px] leading-[1.7] text-muted max-w-[640px]">
        <span className="ch-tl" /><span className="ch-br" />
        <div><span className="text-accent">$</span> standmeet deploy</div>
        <div><span className="text-faint">├─</span> bundling indexer + retrieval</div>
        <div><span className="text-faint">├─</span> provisioning sqlite store</div>
        <div><span className="text-faint">├─</span> exposing mcp endpoint</div>
        <div><span className="text-faint">└─</span> ready at <span className="text-ink">{window.location.host || 'localhost:3000'}</span></div>
        <div className="mt-2"><span className="text-accent">$</span> awaiting first owner<span className="blink text-accent">_</span></div>
      </div>

      <form onSubmit={submit} className="mt-10 max-w-[520px] space-y-5">
        {step === 1 && (
          <div className="space-y-5 rise">
            <Field label="your full name">
              <input
                type="text" value={form.full} onChange={(e)=>onField('full', e.target.value)}
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink"
                style={{ fontSize: '17px' }} autoFocus
              />
            </Field>
            <Field label="public handle" hint="visitors see this in the URL · standmeet.com/<handle>">
              <div className="flex items-baseline gap-2 border-b border-rule">
                <span className="mono text-faint">standmeet.com/</span>
                <input
                  type="text" value={form.handle} onChange={(e)=>onField('handle', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}
                  className="flex-1 bg-transparent py-2 reading text-ink"
                  style={{ fontSize: '17px', fontWeight: 500, letterSpacing: '-0.005em' }}
                />
              </div>
            </Field>
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={()=>onSwitchMode('signin')} className="mono text-[10.5px] tracking-[0.12em] text-muted hover:text-ink">
                already claimed? sign in
              </button>
              <button
                type="button" onClick={()=>setStep(2)}
                disabled={!form.full.trim() || !form.handle.trim()}
                className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors disabled:opacity-40"
              >
                next →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 rise">
            <Field label="email" hint="used to sign in and to recover the account">
              <input
                type="email" value={form.email} onChange={(e)=>onField('email', e.target.value)}
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink"
                style={{ fontSize: '17px' }} autoFocus autoComplete="email"
              />
            </Field>
            <div className="grid grid-cols-2 gap-5">
              <Field label="password">
                <input
                  type="password" value={form.password} onChange={(e)=>onField('password', e.target.value)}
                  placeholder="8+ characters"
                  className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                  style={{ fontSize: '17px', letterSpacing: '0.04em' }} autoComplete="new-password"
                />
              </Field>
              <Field label="confirm">
                <input
                  type="password" value={form.passwordConfirm} onChange={(e)=>onField('passwordConfirm', e.target.value)}
                  className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink"
                  style={{ fontSize: '17px', letterSpacing: '0.04em' }} autoComplete="new-password"
                />
              </Field>
            </div>
            {error && <div className="mono text-[11px] tracking-[0.06em] text-accent">{error}</div>}
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={()=>setStep(1)} className="mono text-[10.5px] tracking-[0.12em] text-muted hover:text-ink">
                ← back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="mono text-[11px] tracking-[0.16em] uppercase text-paper bg-ink px-4 py-2.5 hover:bg-accent transition-colors disabled:opacity-40"
              >
                {busy ? 'claiming\u2026' : 'claim instance ↵'}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5 flex items-baseline gap-2">
        <span>{label}</span>
        {hint && <span className="text-faint normal-case tracking-[0.04em]">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDE PANEL — explains the self-host model + lists what comes with the instance

function SidePanel() {
  return (
    <aside className="hidden lg:block border-l border-rule pl-10">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-4">what you get</div>
      <ul className="space-y-5">
        {[
          { k: '01', t: 'your own corpus', b: 'A local database that holds every raw dump, every promoted wiki entry, every conversation. You own the file.' },
          { k: '02', t: 'mcp push endpoint', b: 'Send entries to your corpus from Claude / ChatGPT / Cursor with one client install. No copy-pasting screenshots between tools.' },
          { k: '03', t: 'api tokens',     b: 'Generate scoped tokens for AI agents, scripts, or other apps to read or write to your corpus.' },
          { k: '04', t: 'gated chat',     b: 'A public surface visitors land on. Codes you issue grant scoped access; BYOAI handles the rest.' },
        ].map((row) => (
          <li key={row.k} className="grid grid-cols-[28px_1fr] gap-4">
            <span className="mono text-[10.5px] tracking-[0.14em] text-faint tabular-nums pt-1.5">{row.k}</span>
            <div>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-ink mb-1.5">{row.t}</div>
              <p className="reading text-muted" style={{ fontSize: '14.5px' }}>{row.b}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-10 pt-6 border-t border-rule mono text-[10px] tracking-[0.04em] leading-[1.7] text-faint">
        <p><span className="text-muted">data lives on your server.</span> we never see your corpus.</p>
        <p className="mt-1">single-binary install · sqlite · mcp · mit license</p>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// app

function App() {
  const [instance, setInstance] = useState(() => loadInstance());
  const [hash] = useState(() => instance?.hash || makeInstanceHash());
  const [mode, setMode] = useState(() => instance ? 'signin' : 'setup');

  // sync hash into instance once it claims
  useEffect(() => {
    if (!instance && mode === 'setup') {
      // ensure the displayed hash matches what we'll save
    }
  }, [instance, mode]);

  const onSignedIn = () => { window.location.href = 'admin.html'; };
  const onClaimed  = (i) => {
    setInstance(i);
    window.location.href = 'admin.html';
  };

  const switchMode = (m) => {
    if (m === 'setup' && instance) {
      // can't re-setup an already-claimed instance from the UI
      return;
    }
    setMode(m);
  };

  // a 'reset instance' affordance for the prototype only — wipes the local owner so
  // designers can re-demo the setup flow
  const resetInstance = () => {
    try { localStorage.removeItem(INSTANCE_KEY); localStorage.removeItem(AUTH_KEY); } catch (e) {}
    setInstance(null);
    setMode('setup');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <DeployStrip instance={{ host: window.location.host || 'localhost:3000', hash }} />

      <main className="flex-1 mx-auto max-w-[1180px] w-full px-6 lg:px-10 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-12">
          <div>
            {mode === 'signin' && (
              <SignIn instance={instance} onSignedIn={onSignedIn} onSwitchMode={switchMode} />
            )}
            {mode === 'setup' && (
              <Setup hash={hash} onClaimed={onClaimed} onSwitchMode={switchMode} />
            )}
          </div>
          <SidePanel />
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-7 mono text-[10.5px] tracking-[0.06em] leading-[1.7] text-muted flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
          <div>
            <span className="text-ink">standmeet</span>
            <span className="text-faint mx-2">·</span>
            <span>self-hosted retrieval for personal corpora</span>
          </div>
          <div className="flex items-baseline gap-4">
            {instance && (
              <button onClick={resetInstance} className="text-faint hover:text-accent uppercase tracking-[0.16em] text-[10px]">
                reset instance (demo)
              </button>
            )}
            <a className="hover:text-ink" href="#">docs</a>
            <a className="hover:text-ink" href="https://github.com">source</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
