/* global React, ReactDOM, SM, AD */
/* IIFE so our destructures from window.SM / window.AD don't collide
   with the same names declared elsewhere — babel-standalone shares
   top-level scope across <script type="text/babel"> tags. */

(function () {

const {
  Chip, Pill, SmallCaps, LiveDot, Kbd, Btn, Field, Input, Textarea, Segmented,
  Crosshair, Banner, Thinking, SpeakerLabel, Citations, Quota, MaskedSecret, CopyBtn,
  Sparkline, ImageThumb, FilePill, QRCode, ActivityTicker, TopBar, StickyComposer,
  Modal, Section,
} = SM;
const {
  OWNER_ADMIN, SOURCES, ACTIVITY, GROWTH_14D,
  RAW_ENTRIES, WIKI_TAGS, WIKI_ENTRIES,
  CONVERSATIONS, CODES, REQUESTS,
  OUTPUTS, PAGES,
  JOB_SOURCES, JOB_LISTINGS, RESUME_DRAFTS, APPLICATIONS, SKILLS,
  OBSIDIAN, CONNECTORS, CONNECTOR_REGISTRY, CONNECTOR_CATEGORIES, TOKEN_SCOPES, API_TOKENS,
  SEO, ACCOUNT, SYSTEM,
  tagDot,
} = AD;

/* ── nav · grouped IA ─────────────────────────────────────────────── */

const NAV_GROUPS = [
  { label: 'overview', items: [
    { id: 'dashboard', label: 'dashboard' },
  ]},
  { label: 'corpus', items: [
    { id: 'raw',      label: 'raw',      badge: () => RAW_ENTRIES.filter(e => e.status === 'unprocessed').length },
    { id: 'wiki',     label: 'wiki' },
    { id: 'writing',  label: 'writing' },
    { id: 'outputs',  label: 'outputs' },
    { id: 'pages',    label: 'pages' },
  ]},
  { label: 'access', items: [
    { id: 'conversations', label: 'conversations' },
    { id: 'codes',         label: 'codes' },
    { id: 'requests',      label: 'requests', badge: () => REQUESTS.filter(r => r.status === 'new').length },
    { id: 'preview',       label: 'preview' },
  ]},
  { label: 'jobs', items: [
    { id: 'sources',       label: 'sources' },
    { id: 'listings',      label: 'listings', badge: () => JOB_LISTINGS.filter(j => j.status === 'shortlist').length },
    { id: 'drafts',        label: 'drafts' },
    { id: 'applications',  label: 'applications' },
    { id: 'skills',        label: 'skills' },
  ]},
  { label: 'integrations', items: [
    { id: 'connectors', label: 'connectors' },
    { id: 'api',        label: 'api · mcp' },
    { id: 'obsidian',   label: 'obsidian' },
  ]},
  { label: 'settings', items: [
    { id: 'page',     label: 'public page' },
    { id: 'seo',      label: 'seo' },
    { id: 'account',  label: 'account' },
    { id: 'system',   label: 'system' },
  ]},
];

/* ── helpers ──────────────────────────────────────────────────────── */

function useShareHost() {
  const [host, setHost] = React.useState(() => window.siteHost ? window.siteHost(window.loadPageContent()) : ('standmeet.com/' + OWNER_ADMIN.handle));
  React.useEffect(() => {
    const refresh = () => setHost(window.siteHost ? window.siteHost(window.loadPageContent()) : ('standmeet.com/' + OWNER_ADMIN.handle));
    window.addEventListener('storage', refresh);
    window.addEventListener('standmeet-page-saved', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('standmeet-page-saved', refresh); };
  }, []);
  return host;
}

function Stat({ label, value, trend, sub }) {
  return (
    <div className="ad-card tight">
      <div className="smallcaps" style={{ marginBottom: 6 }}>{label}</div>
      <div className="kpi-num">{value}</div>
      {(trend || sub) && (
        <div className={'kpi-trend ' + (trend && trend.startsWith('↑') ? 'up' : 'down')}>
          {trend} {sub && <span style={{ color: 'var(--faint)' }}>· {sub}</span>}
        </div>
      )}
    </div>
  );
}

function GroupHeader({ title, action, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 0 12px', borderBottom: '1px solid var(--rule)', marginBottom: 16 }}>
      <h3 className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink)', margin: 0 }}>
        {title}
        {count != null && <span style={{ color: 'var(--faint)', marginLeft: 10, fontSize: 10 }}>· {String(count).padStart(2,'0')}</span>}
      </h3>
      {action}
    </div>
  );
}

function Empty({ title, blurb, action }) {
  return (
    <div style={{ border: '1px dashed var(--rule)', padding: '36px 20px', textAlign: 'center', borderRadius: 3 }}>
      <div className="smallcaps" style={{ marginBottom: 6 }}>nothing here yet</div>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>{title}</div>
      {blurb && <div className="reading" style={{ fontSize: 14, color: 'var(--muted)', maxWidth: '36em', margin: '0 auto' }}>{blurb}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/* ── chrome ───────────────────────────────────────────────────────── */

function AdminTopBar({ session, onSignOut, onMenu }) {
  const host = useShareHost();
  return (
    <TopBar
      left={[
        onMenu && <button key="hm" onClick={onMenu} className="ad-sidebar-toggle mono" style={{ display: 'none', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink)', fontSize: 18, padding: '4px 8px 4px 0', marginRight: 4 }} aria-label="menu">≡</button>,
        <span key="b" className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink)' }}>standmeet</span>,
        <span key="s" style={{ color: 'var(--faint)' }}>/</span>,
        <span key="d" className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>admin</span>,
        <span key="dot" style={{ color: 'var(--faint)' }}>·</span>,
        <span key="h" className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>{session?.handle || OWNER_ADMIN.handle}</span>,
        <span key="live" style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LiveDot />
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>{SYSTEM.version}</span>
        </span>,
      ].filter(Boolean)}
      ticker={ACTIVITY}
      right={[
        <span key="m" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted)' }}>
          <span style={{ color: 'var(--ink)' }}>{OWNER_ADMIN.corpus_size.toLocaleString()}</span> entries
          <span style={{ color: 'var(--faint)', margin: '0 8px' }}>·</span>
          <span style={{ color: 'var(--ink)' }}>{OWNER_ADMIN.storage_used_mb}</span> mb
        </span>,
        <a key="p" href={'https://' + host.replace(/\/.*/, '')} className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>public ↗</a>,
        <a key="g" href="gate.html" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>gate ↗</a>,
        session && (
          <span key="u" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, paddingLeft: 16, borderLeft: '1px solid var(--rule)' }}>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{session.email}</span>
            <button onClick={onSignOut} className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)', background: 'transparent', border: 0, cursor: 'pointer' }}>sign out</button>
          </span>
        ),
      ]}
    />
  );
}

function DemoBanner() {
  return (
    <div className="demo-banner">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LiveDot />
        <span style={{ color: 'var(--accent)' }}>demo mode</span>
        <span style={{ color: 'var(--faint)' }}>·</span>
        <span style={{ textTransform: 'none', letterSpacing: '0.06em', color: 'var(--muted)' }}>viewing the admin without signing in · changes persist only in this tab</span>
      </div>
      <a href="login.html" className="mono" style={{ color: 'var(--muted)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.14em' }}>sign in / claim instance ↗</a>
    </div>
  );
}

function Sidebar({ section, onChange, mobileOpen, onClose }) {
  return (
    <nav className={'ad-sidebar' + (mobileOpen ? ' is-open' : '')} style={{ width: 232, flexShrink: 0, borderRight: '1px solid var(--rule)', padding: '20px 0', display: 'flex', flexDirection: 'column', position: 'sticky', top: 56, alignSelf: 'flex-start', height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <div className="nav-group-label">── {g.label}</div>
          {g.items.map((it) => {
            const active = section === it.id;
            const badge = it.badge ? it.badge() : null;
            return (
              <button key={it.id} onClick={() => { onChange(it.id); if (onClose) onClose(); }} className={'nav-link ' + (active ? 'active' : '')}>
                <span className="name">{it.label}</span>
                {badge ? <span className="badge">{badge}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--rule)' }}>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', lineHeight: 1.6 }}>
          <div>instance · {OWNER_ADMIN.instance_hash}</div>
          <div>uptime · {OWNER_ADMIN.uptime}</div>
          <a href="design-system.html" style={{ color: 'var(--muted)', textDecoration: 'none' }}>↗ design system</a>
        </div>
      </div>
    </nav>
  );
}

/* ───────────────────────── SECTIONS ──────────────────────────────── */

/* ── dashboard · summary KPIs + recent activity + quick links ───── */

function DashboardSection({ onJump }) {
  const newReqs = REQUESTS.filter(r => r.status === 'new').length;
  const unprocessed = RAW_ENTRIES.filter(e => e.status === 'unprocessed').length;
  const liveCodes = CODES.filter(c => c.status === 'active').length;
  const shortlist = JOB_LISTINGS.filter(j => j.status === 'shortlist').length;
  return (
    <Section kicker="overview" title="dashboard" action={
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--muted)' }}>
        last refresh · just now
      </div>
    }>
      {/* row 1: KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>
        <Stat label="entries" value={OWNER_ADMIN.corpus_size.toLocaleString()} trend="↑ 17 last 7d" sub="claude · cursor" />
        <Stat label="unprocessed" value={unprocessed} trend={unprocessed > 5 ? '↑ growing' : '↓ in flow'} sub="needs review" />
        <Stat label="codes live" value={liveCodes} trend={liveCodes + ' active'} sub={CODES.filter(c=>c.status==='expired').length + ' expired'} />
        <Stat label="requests" value={newReqs} trend={newReqs ? '↑ ' + newReqs + ' new' : 'at zero'} sub="from gate" />
      </div>

      {/* row 2: split layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* corpus pulse */}
        <Crosshair scanline className="ad-card scan">
          <GroupHeader title="corpus pulse · 14d" count={GROWTH_14D.reduce((a,b)=>a+b,0)} action={
            <span className="mono" style={{ fontSize: 10, color: 'var(--accent)' }}>↑ +14% wow</span>
          } />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
            <div>
              <div className="kpi-num">{GROWTH_14D.slice(-7).reduce((a,b)=>a+b,0)}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginTop: 4 }}>entries · last 7d</div>
            </div>
            <div style={{ flex: 1 }}>
              <Sparkline data={GROWTH_14D} width={260} height={48} />
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>14d ago</span><span>today</span>
              </div>
            </div>
          </div>
        </Crosshair>

        {/* jobs heat */}
        <div className="ad-card">
          <GroupHeader title="jobs · active loop" action={<button onClick={() => onJump('listings')} className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', background: 'transparent', border: 0, cursor: 'pointer' }}>view all →</button>} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="smallcaps" style={{ marginBottom: 4 }}>shortlist</div>
              <div className="kpi-num">{shortlist}</div>
            </div>
            <div>
              <div className="smallcaps" style={{ marginBottom: 4 }}>sent</div>
              <div className="kpi-num">{APPLICATIONS.length}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)' }}>
            <div className="smallcaps" style={{ marginBottom: 6 }}>top match</div>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>{JOB_LISTINGS[0].title} <span style={{ color: 'var(--muted)' }}>· {JOB_LISTINGS[0].company}</span></div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>match {Math.round(JOB_LISTINGS[0].match * 100)}% · {JOB_LISTINGS[0].why}</div>
          </div>
        </div>
      </div>

      {/* row 3: recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="ad-card">
          <GroupHeader title="recent visitors" action={<button onClick={() => onJump('conversations')} className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', background: 'transparent', border: 0, cursor: 'pointer' }}>all →</button>} />
          {CONVERSATIONS.slice(0,5).map((c) => (
            <div key={c.id} className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{c.visitor}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{c.code_label} · {c.turns} turns · {c.last}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.private_hits > 0 && <span className="mono" style={{ fontSize: 9.5, color: 'var(--accent)', letterSpacing: '0.14em' }}>{c.private_hits} priv</span>}
                <span className={'sent ' + c.sentiment}>{c.sentiment}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="ad-card">
          <GroupHeader title="needs your hand" />
          {newReqs > 0 && (
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{newReqs} access {newReqs === 1 ? 'request' : 'requests'}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>visitors waiting on a code</div>
              </div>
              <button onClick={() => onJump('requests')} className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 0, cursor: 'pointer' }}>review →</button>
            </div>
          )}
          {unprocessed > 0 && (
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{unprocessed} raw entries unprocessed</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>promote, edit, or archive</div>
              </div>
              <button onClick={() => onJump('raw')} className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 0, cursor: 'pointer' }}>open →</button>
            </div>
          )}
          {RESUME_DRAFTS.filter(d=>d.status==='reviewing').length > 0 && (
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{RESUME_DRAFTS.filter(d=>d.status==='reviewing').length} resume drafts pending</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>AI generated · awaiting your review</div>
              </div>
              <button onClick={() => onJump('drafts')} className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', background: 'transparent', border: 0, cursor: 'pointer' }}>review →</button>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

/* ── raw ─────────────────────────────────────────────────────────── */

function RawSection() {
  const [filter, setFilter] = React.useState('unprocessed');
  const counts = {
    all: RAW_ENTRIES.length,
    unprocessed: RAW_ENTRIES.filter(e => e.status === 'unprocessed').length,
    'flagged-private': RAW_ENTRIES.filter(e => e.status === 'flagged-private').length,
    promoted: RAW_ENTRIES.filter(e => e.status === 'promoted').length,
  };
  const list = filter === 'all' ? RAW_ENTRIES : RAW_ENTRIES.filter(e => e.status === filter);
  return (
    <Section kicker="corpus · inbox" title="raw" count={counts.unprocessed + ' unprocessed'} action={
      <div style={{ display: 'flex', gap: 6 }}>
        {['unprocessed','flagged-private','promoted','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className="mono" style={{
            fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
            padding: '4px 8px', background: 'transparent', border: 0, cursor: 'pointer',
            color: filter === f ? 'var(--ink)' : 'var(--muted)',
            borderBottom: filter === f ? '1px solid var(--accent)' : '1px solid transparent',
          }}>{f.replace('-',' ')} <span style={{ color: 'var(--faint)', marginLeft: 4 }}>{counts[f]}</span></button>
        ))}
      </div>
    }>
      <DumpBox />
      <div style={{ marginTop: 24 }}>
        {list.map((e) => <RawRow key={e.id} entry={e} />)}
      </div>
    </Section>
  );
}

function DumpBox() {
  const [text, setText] = React.useState('');
  const [source, setSource] = React.useState('claude');
  return (
    <Crosshair className="ad-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SmallCaps>quick dump · paste · drag · attach</SmallCaps>
        <Segmented value={source} options={SOURCES} onChange={setSource} />
      </div>
      <Textarea value={text} onChange={(e)=>setText(e.target.value)} rows={3} placeholder="Paste a thought, a passage, a half-formed take. Drop an image / audio / file onto this panel. Stays raw until you promote it." />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
          <button style={{ color: 'var(--muted)', background: 'transparent', border: 0, textTransform: 'uppercase', letterSpacing: '0.14em', cursor: 'pointer' }}>⌒ attach media</button>
          <span style={{ marginLeft: 8 }}>· mcp endpoint or paste here · stays unindexed until promoted</span>
        </div>
        <Btn kind="solid" disabled={!text.trim()}>dump ↵</Btn>
      </div>
    </Crosshair>
  );
}

function RawRow({ entry }) {
  const status = {
    'unprocessed':     { label: 'unprocessed',     color: 'var(--muted)' },
    'promoted':        { label: 'in wiki',         color: 'var(--faint)' },
    'flagged-private': { label: 'flagged private', color: 'var(--accent)' },
    'archived':        { label: 'archived',        color: 'var(--faint)' },
  }[entry.status];
  return (
    <article style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 24, padding: '20px 0', borderBottom: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', lineHeight: 1.5 }}>
        <div style={{ color: 'var(--ink)' }}>{entry.source}</div>
        <div style={{ color: 'var(--faint)', marginTop: 2 }}>{entry.time}</div>
      </div>
      <div>
        <p className="reading" style={{ fontSize: 15.5, color: 'var(--ink)', margin: 0 }}>{entry.body}</p>
        {entry.media && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>
            {entry.media.kind} · {entry.media.label}{entry.media.dims ? ' · ' + entry.media.dims : ''}{entry.media.duration ? ' · ' + entry.media.duration : ''}
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
          {entry.tags.map(t => <Chip key={t} tone={tagDot(t) === 'private' ? 'private' : 'neutral'}>{t}</Chip>)}
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: status.color, marginLeft: 4 }}>· {status.label}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {entry.status === 'unprocessed' && <><Btn size="sm" kind="outline">promote ↗</Btn><Btn size="sm" kind="ghost">archive</Btn></>}
        {entry.status === 'flagged-private' && <><Btn size="sm" kind="outline">promote private ↗</Btn><Btn size="sm" kind="ghost">archive</Btn></>}
        {entry.status === 'promoted' && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>in wiki ↗</span>}
      </div>
    </article>
  );
}

/* ── wiki · stub-port of existing ────────────────────────────────── */

function WikiSection() {
  const [activeTag, setActiveTag] = React.useState(null);
  const list = activeTag ? WIKI_ENTRIES.filter(e => e.tags.includes(activeTag)) : WIKI_ENTRIES;
  return (
    <Section kicker="corpus · curated" title="wiki" count={WIKI_ENTRIES.length + ' entries'} action={<Btn kind="outline">＋ new entry</Btn>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        <Chip active={!activeTag} onClick={() => setActiveTag(null)}>all</Chip>
        {WIKI_TAGS.map(t => <Chip key={t} tone={tagDot(t) === 'private' ? 'private' : 'neutral'} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</Chip>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '32px 40px' }}>
        {list.map(e => (
          <article key={e.id} style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ fontFamily: "'Newsreader',serif", fontSize: 20, fontWeight: 400, lineHeight: 1.25, margin: 0, flex: 1 }}>{e.title}</h3>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: e.visibility === 'public' ? 'var(--muted)' : 'var(--accent)' }}>● {e.visibility}</span>
            </div>
            <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', margin: '0 0 10px' }}>{e.excerpt}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {e.tags.map(t => <Chip key={t} tone={tagDot(t) === 'private' ? 'private' : 'neutral'}>{t}</Chip>)}
              </div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em' }}>{e.sources} sources · {e.last_edited}</div>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}

/* ── outputs · 3 tiers (public / unlisted / private) ──────────── */

function OutputsSection() {
  return (
    <Section kicker="corpus · public-facing" title="outputs" count={OUTPUTS.length + ' artifacts'} action={
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="outline">＋ pdf lead-magnet</Btn>
        <Btn kind="solid">＋ web essay</Btn>
      </div>
    }>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        Outputs are public-facing artifacts assembled from your wiki entries — downloadable PDFs, standalone
        web essays, investor decks. Each gets its own SEO landing at <span className="mono" style={{ color: 'var(--ink)' }}>/output/&lt;slug&gt;</span>.
        Three tiers: <span className="mono" style={{ color: 'var(--ink)' }}>public</span> (open to anyone, in sitemap),
        <span className="mono" style={{ color: 'var(--amber)', margin: '0 4px' }}>unlisted</span> (only visible to visitors with a code),
        <span className="mono" style={{ color: 'var(--violet)' }}>private</span> (specific code scopes only, never in sitemap).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>
        {OUTPUTS.map(o => <OutputCard key={o.id} o={o} />)}
      </div>
    </Section>
  );
}

function OutputCard({ o }) {
  const isDraft = o.status === 'draft';
  return (
    <article className="ad-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* cover-style top strip */}
      <div style={{
        height: 100, position: 'relative',
        borderBottom: '1px solid var(--rule)',
        background: `radial-gradient(ellipse 60% 80% at 80% 20%, color-mix(in oklab, var(--${o.cover_hue}) 30%, transparent), transparent 70%), var(--surface)`,
        filter: isDraft ? 'grayscale(0.7)' : 'none',
      }}>
        <span className="mono" style={{ position: 'absolute', top: 10, left: 12, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {o.format} · {o.tier}
        </span>
        <span style={{ position: 'absolute', bottom: 12, left: 12, fontFamily: "'Newsreader',serif", fontSize: 22, color: 'var(--ink)' }}>{o.title}</span>
        <span className={'tier-pill ' + o.tier} style={{ position: 'absolute', top: 10, right: 12 }}>{o.tier}</span>
      </div>
      <div style={{ padding: 16 }}>
        <p className="reading" style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 12px' }}>{o.blurb}</p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className={'sm-pill ' + (isDraft ? '' : 'is-accent')}>
            <span className="sm-dot"></span>
            <span>{isDraft ? 'draft' : 'live'}</span>
          </span>
          {!isDraft && (
            <>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                <span className="num" style={{ color: 'var(--ink)' }}>{o.views.toLocaleString()}</span> views
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                <span className="num" style={{ color: 'var(--ink)' }}>{o.downloads}</span> downloads
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                <span className="num" style={{ color: 'var(--accent)' }}>{o.leads}</span> leads
              </span>
            </>
          )}
        </div>
        {o.from_wiki && o.from_wiki.length > 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 10, letterSpacing: '0.06em' }}>
            assembled from · {o.from_wiki.map(s => <Chip key={s}>{s}</Chip>).reduce((a,b,i) => i===0 ? [b] : [...a, ' ', b], [])}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)' }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>/output/{o.slug}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn kind="ghost" size="sm">edit</Btn>
            <Btn kind="outline" size="sm">preview ↗</Btn>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── pages · custom React surfaces /p/<slug> ─────────────────────── */

function PagesSection() {
  return (
    <Section kicker="corpus · public-facing" title="pages" count={PAGES.length} action={
      <Btn kind="solid">＋ new page</Btn>
    }>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        Custom pages live at <span className="mono" style={{ color: 'var(--ink)' }}>/p/&lt;slug&gt;</span>.
        Each binds a template (press-kit / list-with-prose / menu / auto-now) to data from your corpus and renders
        with the same chrome as the public site.
      </p>
      <table className="ad-table">
        <thead>
          <tr>
            <th>page</th><th>template</th><th>visibility</th><th>views</th><th>updated</th><th></th>
          </tr>
        </thead>
        <tbody>
          {PAGES.map(p => (
            <tr key={p.id}>
              <td>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>{p.title}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>/p/{p.slug}</div>
              </td>
              <td className="num"><span style={{ color: 'var(--ink)' }}>{p.template}</span></td>
              <td>
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: p.visibility === 'public' ? 'var(--muted)' : 'var(--accent)' }}>
                  ● {p.visibility}
                </span>
              </td>
              <td className="num">{p.views.toLocaleString()}</td>
              <td className="num">{p.updated}</td>
              <td style={{ textAlign: 'right' }}>
                <Btn kind="ghost" size="sm">edit</Btn>
                <Btn kind="ghost" size="sm">preview ↗</Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 24 }} className="ad-card">
        <SmallCaps>templates available</SmallCaps>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginTop: 8 }}>
          {[
            { id:'press-kit', t:'press-kit', d:'photo · bio variants · downloads' },
            { id:'list-prose', t:'list-with-prose', d:'list above, prose explanation below' },
            { id:'menu', t:'menu', d:'numbered service / offer rows' },
            { id:'auto-now', t:'auto-now', d:'AI-summarized latest entries · /now' },
          ].map(tmpl => (
            <div key={tmpl.id} style={{ border: '1px solid var(--rule)', padding: 12, borderRadius: 3 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink)', letterSpacing: '0.04em' }}>{tmpl.t}</div>
              <div className="reading" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{tmpl.d}</div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ── writing · blog editor (a real composer · slash menu / crosslinks / image upload) ─── */

const POST_SLUGS = [
  { slug: 'evaluation-is-the-product', title: 'Evaluation is the product, model is the tax' },
  { slug: 'why-second-brains-fail',    title: 'Why second brains fail' },
  { slug: 'translation-layer',         title: 'Engineering is the translation layer' },
  { slug: 'lucerna-honestly',          title: 'What Lucerna is, honestly' },
  { slug: 'we-shipped-the-wrong-10x',  title: 'We shipped the wrong 10x' },
];

const SLASH_ITEMS = [
  { id:'p',  label:'Paragraph',    hint:'plain text body',     kbd:'just type' },
  { id:'h2', label:'Heading 2',    hint:'section break',       kbd:'## ' },
  { id:'pq', label:'Pull quote',   hint:'large italic quote',  kbd:'> > ' },
  { id:'img',label:'Image · upload',hint:'drag or paste',      kbd:'⌘V' },
  { id:'xref',label:'Cross-link',  hint:'link to another post',kbd:'[[' },
  { id:'div', label:'Divider',     hint:'horizontal rule',     kbd:'---' },
  { id:'code', label:'Code block', hint:'monospace fenced',    kbd:'```' },
];

function CrosslinkPicker({ query, onPick, onClose }) {
  const matches = POST_SLUGS.filter(p => p.slug.includes(query.toLowerCase()) || p.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <div style={{
      position: 'absolute', zIndex: 50,
      left: 24, top: '100%', marginTop: 6,
      background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 3,
      boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
      width: 360, padding: '4px 0',
    }}>
      <div className="smallcaps" style={{ padding: '6px 14px 4px' }}>
        cross-link <span style={{ color: 'var(--faint)', marginLeft: 6 }}>[[{query}]]</span>
      </div>
      {matches.length === 0 && (
        <div style={{ padding: '8px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--faint)' }}>
          no match · type a slug to create
        </div>
      )}
      {matches.map((m) => (
        <button key={m.slug} onClick={() => onPick(m.slug)} style={{
          width: '100%', textAlign: 'left', padding: '8px 14px',
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'baseline', gap: 10, color: 'var(--ink)',
        }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--violet)', letterSpacing: '0.04em', flex: '0 0 auto' }}>[[</span>
          <span style={{ fontFamily: "'Newsreader',serif", fontSize: 14.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', flex: '0 0 auto' }}>{m.slug}</span>
        </button>
      ))}
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>esc to cancel</span>
        <button onClick={onClose} className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase', background: 'transparent', border: 0, cursor: 'pointer' }}>close</button>
      </div>
    </div>
  );
}

function SlashMenuPanel({ items, query, onPick, onClose }) {
  const filtered = query
    ? items.filter(i => i.id.includes(query.toLowerCase()) || i.label.toLowerCase().includes(query.toLowerCase()))
    : items;
  return (
    <div style={{
      position: 'absolute', zIndex: 50,
      left: 24, top: '100%', marginTop: 6,
      background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 3,
      boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
      width: 280, padding: '4px 0',
    }}>
      <div className="smallcaps" style={{ padding: '6px 14px 4px' }}>insert</div>
      {filtered.map((s) => (
        <button key={s.id} onClick={() => onPick(s.id)} style={{
          width: '100%', textAlign: 'left', padding: '6px 14px',
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'baseline', gap: 10, color: 'var(--ink)',
        }}>
          <span style={{ fontFamily: "'Newsreader',serif", fontSize: 13.5, flex: 1 }}>{s.label}</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>{s.kbd}</span>
        </button>
      ))}
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--rule)' }}>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>esc to cancel</span>
      </div>
    </div>
  );
}

function EditableBlock({ block, focused, onChange, onFocus, onDelete, onMove, onTriggerSlash, onTriggerXref }) {
  const ref = React.useRef(null);

  // auto-grow textarea
  React.useEffect(() => {
    if (ref.current && ref.current.tagName === 'TEXTAREA') {
      ref.current.style.height = 'auto';
      ref.current.style.height = (ref.current.scrollHeight) + 'px';
    }
  }, [block.text]);

  const onKey = (e) => {
    if (e.key === '/' && (!block.text || block.text === '') && block.kind === 'p') {
      e.preventDefault();
      onTriggerSlash();
    } else if (e.key === '[' && block.text.endsWith('[')) {
      onTriggerXref();
    } else if (e.key === 'Backspace' && !block.text) {
      e.preventDefault();
      onDelete();
    }
  };

  const onTextChange = (v) => onChange({ text: v });

  const baseStyle = { width: '100%', background: 'transparent', border: 0, padding: 0, resize: 'none', display: 'block', overflow: 'hidden' };
  const fontStyle = { fontFamily: "'Newsreader',serif", lineHeight: 1.6, color: 'var(--ink)', fontWeight: 380 };

  if (block.kind === 'h2') {
    return (
      <input
        ref={ref}
        value={block.text} onChange={(e) => onTextChange(e.target.value)}
        onFocus={onFocus}
        placeholder="Section heading"
        style={{ ...baseStyle, ...fontStyle, fontSize: 26, fontWeight: 500, letterSpacing: '-0.012em', marginTop: 24 }}
      />
    );
  }
  if (block.kind === 'pq') {
    return (
      <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 18, margin: '24px 0', display: 'block' }}>
        <textarea
          ref={ref} rows={1}
          value={block.text} onChange={(e) => onTextChange(e.target.value)}
          onFocus={onFocus} onKeyDown={onKey}
          placeholder="A claim you'd want screenshot-able."
          style={{ ...baseStyle, ...fontStyle, fontSize: 22, fontStyle: 'italic', letterSpacing: '-0.008em' }}
        />
      </div>
    );
  }
  if (block.kind === 'div') {
    return <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '24px 0' }} />;
  }
  if (block.kind === 'xref') {
    return (
      <div style={{
        margin: '12px 0', padding: '12px 14px',
        border: '1px dashed color-mix(in oklab, var(--violet) 50%, var(--rule))',
        borderRadius: 3,
        background: 'color-mix(in oklab, var(--violet) 5%, transparent)',
      }}>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--violet)', textTransform: 'uppercase' }}>
          cross-link
        </div>
        <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: 'var(--ink)' }}>
          [[{block.slug}]]
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          → {(POST_SLUGS.find(p => p.slug === block.slug) || {}).title || 'unknown post'}
        </div>
      </div>
    );
  }
  if (block.kind === 'img') {
    return (
      <figure style={{ margin: '20px 0' }}>
        <div style={{
          aspectRatio: '16 / 9',
          background: 'linear-gradient(135deg, color-mix(in oklab, var(--amber) 18%, transparent) 0%, transparent 50%, color-mix(in oklab, var(--ink) 10%, transparent) 100%), repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in oklab, var(--ink) 4%, transparent) 6px 7px), var(--surface)',
          border: '1px solid var(--rule)', borderRadius: 3, position: 'relative',
        }}>
          <span className="mono" style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--paper)', background: 'color-mix(in oklab, var(--ink) 80%, transparent)', padding: '1px 5px' }}>
            IMG · {block.alt || 'untitled'}
          </span>
        </div>
        <input
          value={block.text || ''} onChange={(e) => onTextChange(e.target.value)}
          placeholder="caption (optional)"
          className="mono"
          style={{ ...baseStyle, marginTop: 8, fontSize: 11, color: 'var(--muted)', letterSpacing: '0.04em' }}
        />
      </figure>
    );
  }
  if (block.kind === 'code') {
    return (
      <textarea
        ref={ref} rows={3}
        value={block.text} onChange={(e) => onTextChange(e.target.value)}
        onFocus={onFocus} onKeyDown={onKey}
        placeholder="// code block"
        className="mono"
        style={{ ...baseStyle, fontSize: 12.5, lineHeight: 1.6, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, margin: '14px 0' }}
      />
    );
  }
  return (
    <textarea
      ref={ref} rows={1}
      value={block.text} onChange={(e) => onTextChange(e.target.value)}
      onFocus={onFocus} onKeyDown={onKey}
      placeholder={focused ? "Type, or press / for a block" : ""}
      style={{ ...baseStyle, ...fontStyle, fontSize: 19, marginTop: 10 }}
    />
  );
}

function WritingSection() {
  const [title, setTitle] = React.useState('Evaluation is the product. The model is the tax.');
  const [blocks, setBlocks] = React.useState([
    { id: 1, kind: 'p',  text: "Most ML teams I've sat with treat their evaluation suite as a finished thing — a fixture that measures whatever the modeling work happens to produce." },
    { id: 2, kind: 'p',  text: 'This is exactly backwards. The eval is the product. The model is downstream of it.' },
    { id: 3, kind: 'pq', text: 'If your eval is wrong, every modeling decision downstream of it is a coin flip dressed in lab coats.' },
    { id: 4, kind: 'h2', text: 'The reframing was the contribution; the modeling was the tax.' },
    { id: 5, kind: 'xref', slug: 'why-second-brains-fail' },
    { id: 6, kind: 'p',  text: "You can copy our model architecture. You can't copy our eval methodology without spending nine months annotating, and by then we've moved." },
  ]);
  const [focusedId, setFocusedId] = React.useState(1);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [xrefOpen,  setXrefOpen]  = React.useState(false);
  const [xrefQuery, setXrefQuery] = React.useState('');
  const [savedAt,   setSavedAt]   = React.useState('4s ago');
  const [vis, setVis] = React.useState('public');
  const [hue, setHue] = React.useState('amber');
  const [tags, setTags] = React.useState(['lucerna','eval','thinking']);
  const dropRef = React.useRef(null);
  const [drag, setDrag] = React.useState(false);

  const updateBlock = (id, patch) => setBlocks((bs) => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  const deleteBlock = (id) => setBlocks((bs) => bs.length > 1 ? bs.filter(b => b.id !== id) : bs);
  const moveBlock = (id, delta) => setBlocks((bs) => {
    const idx = bs.findIndex(b => b.id === id);
    if (idx < 0) return bs;
    const j = idx + delta;
    if (j < 0 || j >= bs.length) return bs;
    const copy = [...bs];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    return copy;
  });
  const insertBlock = (afterId, kind, props = {}) => {
    setBlocks((bs) => {
      const i = bs.findIndex(b => b.id === afterId);
      const newBlock = { id: Date.now() + Math.random(), kind, text: '', ...props };
      const next = [...bs];
      next.splice(i + 1, 0, newBlock);
      return next;
    });
    setSlashOpen(false);
    setXrefOpen(false);
  };

  const onSlashPick = (kind) => {
    if (kind === 'xref') { setSlashOpen(false); setXrefOpen(true); setXrefQuery(''); return; }
    insertBlock(focusedId, kind);
  };
  const onXrefPick = (slug) => {
    insertBlock(focusedId, 'xref', { slug });
  };

  React.useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { setSlashOpen(false); setXrefOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // outgoing crosslinks
  const outgoing = blocks.filter(b => b.kind === 'xref').map(b => b.slug);
  const wordcount = blocks.filter(b => b.kind === 'p' || b.kind === 'h2' || b.kind === 'pq').map(b => (b.text || '').split(/\s+/).filter(Boolean).length).reduce((a,b)=>a+b,0);

  return (
    <Section kicker="corpus · writing" title="writing" count="5 posts · 1 draft" action={
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost">drafts (1)</Btn>
        <Btn kind="outline">all posts ↗</Btn>
        <Btn kind="solid">＋ new post</Btn>
      </div>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24 }}>
        {/* editor */}
        <div className="ad-card" style={{ minHeight: 580, position: 'relative' }}
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('image/')) {
              insertBlock(focusedId, 'img', { alt: f.name });
            }
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <SmallCaps>composer · evaluation-is-the-product</SmallCaps>
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>autosaved {savedAt}</div>
          </div>

          {drag && (
            <div style={{ position: 'absolute', inset: 8, pointerEvents: 'none', border: '2px dashed var(--accent)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--accent) 6%, transparent)' }}>
              <span className="mono" style={{ color: 'var(--accent)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>drop to add image</span>
            </div>
          )}

          {/* title */}
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Title…"
            style={{ width: '100%', background: 'transparent', border: 0, fontFamily: "'Newsreader',serif", fontSize: 32, fontWeight: 400, letterSpacing: '-0.018em', lineHeight: 1.15, color: 'var(--ink)' }}
          />

          {/* blocks */}
          <div style={{ marginTop: 18, position: 'relative' }}>
            {blocks.map((b, i) => (
              <div key={b.id} style={{ position: 'relative', borderLeft: b.id === focusedId ? '2px solid var(--accent)' : '2px solid transparent', paddingLeft: 10, marginLeft: -12, transition: 'border-color .15s' }}
                onClick={() => setFocusedId(b.id)}
              >
                {/* hover controls */}
                {b.id === focusedId && (
                  <div style={{ position: 'absolute', left: -56, top: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveBlock(b.id, -1)} className="mono" style={{ fontSize: 11, background: 'transparent', border: 0, color: 'var(--faint)', cursor: 'pointer' }} title="move up">↑</button>
                    <button onClick={() => moveBlock(b.id, 1)} className="mono"  style={{ fontSize: 11, background: 'transparent', border: 0, color: 'var(--faint)', cursor: 'pointer' }} title="move down">↓</button>
                    <button onClick={() => deleteBlock(b.id)} className="mono" style={{ fontSize: 11, background: 'transparent', border: 0, color: 'var(--faint)', cursor: 'pointer' }} title="delete">×</button>
                  </div>
                )}
                <EditableBlock
                  block={b}
                  focused={b.id === focusedId}
                  onChange={(patch) => updateBlock(b.id, patch)}
                  onFocus={() => setFocusedId(b.id)}
                  onDelete={() => deleteBlock(b.id)}
                  onTriggerSlash={() => { setFocusedId(b.id); setSlashOpen(true); }}
                  onTriggerXref={() => { setFocusedId(b.id); setXrefOpen(true); setXrefQuery(''); }}
                />
              </div>
            ))}

            {slashOpen && <SlashMenuPanel items={SLASH_ITEMS} query="" onPick={onSlashPick} onClose={() => setSlashOpen(false)} />}
            {xrefOpen && <CrosslinkPicker query={xrefQuery} onPick={onXrefPick} onClose={() => setXrefOpen(false)} />}

            {/* insert button */}
            <button
              onClick={() => setSlashOpen(true)}
              className="mono"
              style={{ marginTop: 18, marginLeft: -2, background: 'transparent', border: 0, color: 'var(--faint)', letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 10, cursor: 'pointer' }}
            >＋ insert / block</button>
          </div>

          {/* status bar */}
          <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em', display: 'flex', gap: 14 }}>
              <span><span style={{ color: 'var(--ink)' }}>{wordcount}</span> words</span>
              <span><span style={{ color: 'var(--ink)' }}>{blocks.length}</span> blocks</span>
              <span><span style={{ color: 'var(--ink)' }}>{outgoing.length}</span> cross-links</span>
              <span><span style={{ color: 'var(--ink)' }}>~{Math.max(1, Math.round(wordcount/200))}</span> min read</span>
            </div>
            <Btn kind="ghost" size="sm">preview ↗</Btn>
          </div>
        </div>

        {/* side rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ad-card">
            <SmallCaps>publish</SmallCaps>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="visibility" hint="public is indexed">
                <Segmented value={vis} options={[{value:'public',label:'public'},{value:'unlisted',label:'unlisted'},{value:'private',label:'private'}]} onChange={setVis} />
              </Field>
              <Field label="cover · hue">
                <Segmented value={hue} options={['amber','violet','acid']} onChange={setHue} />
              </Field>
              <Field label="tags">
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tags.map(t => (
                    <Chip key={t} active onClick={() => setTags(ts => ts.filter(x => x !== t))}>{t} ×</Chip>
                  ))}
                  <Chip onClick={() => {
                    const t = prompt('tag name?');
                    if (t && t.trim()) setTags(ts => [...ts, t.trim()]);
                  }}>＋ add</Chip>
                </div>
              </Field>
              <Btn kind="solid">{vis === 'public' ? 'publish' : 'save'} · 2026.05.26</Btn>
            </div>
          </div>

          <div className="ad-card">
            <SmallCaps>cross-links</SmallCaps>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>outgoing · {outgoing.length}</div>
              {outgoing.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>none yet · press [[ to add</div>}
              {outgoing.map((s, i) => (
                <div key={i} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--ink)' }}>[[{s}]]</div>
              ))}
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginTop: 6 }}>incoming · 2 essays</div>
              {['lucerna-honestly','we-shipped-the-wrong-10x'].map(s => (
                <div key={s} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--violet)' }}>← {s}</div>
              ))}
            </div>
          </div>

          <div className="ad-card">
            <SmallCaps>keyboard</SmallCaps>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, letterSpacing: '0.04em', lineHeight: 1.95 }}>
              <Kbd>/</Kbd> &nbsp;insert block <br/>
              <Kbd>[[</Kbd> &nbsp;cross-link picker <br/>
              <Kbd>⌘V</Kbd> &nbsp;paste image inline <br/>
              <Kbd>⌘K</Kbd> &nbsp;add inline link <br/>
              <Kbd>esc</Kbd> &nbsp;close menu
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── conversations · port from v1 ─────────────────────────────────── */

function ConversationsSection() {
  const [openId, setOpenId] = React.useState(null);
  return (
    <Section kicker="access · sessions" title="conversations" count={CONVERSATIONS.length + ' sessions'} action={
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
        <span style={{ color: 'var(--accent)' }}>●</span> {CONVERSATIONS.filter(c=>c.private_hits>0).length} sessions hit private topics
      </div>
    }>
      <table className="ad-table">
        <thead><tr><th>visitor</th><th>via code</th><th>turns</th><th>sentiment</th><th>flags</th><th>last</th></tr></thead>
        <tbody>
          {CONVERSATIONS.map(c => (
            <tr key={c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)} style={{ cursor: 'pointer' }}>
              <td>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{c.visitor}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{c.id}</div>
              </td>
              <td className="num">
                <span style={{ color: 'var(--ink)' }}>{c.code_label}</span>
                {c.byoai && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· byoai · {c.model}</span>}
              </td>
              <td className="num">{c.turns}</td>
              <td><span className={'sent ' + c.sentiment}>{c.sentiment}</span></td>
              <td>{c.private_hits > 0 ? <span className="mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.14em' }}>{c.private_hits} priv</span> : <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>—</span>}</td>
              <td className="num">{c.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── codes · stub-port ───────────────────────────────────────────── */

function CodesSection() {
  return (
    <Section kicker="access · codes" title="codes" count={CODES.length} action={
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
          {CODES.reduce((a,c)=>a+c.members.length,0)} reviewers across {CODES.filter(c=>c.status==='active').length} active codes
        </span>
        <Btn kind="solid">＋ new code</Btn>
      </div>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>
        {CODES.map(c => <CodeCard key={c.id} code={c} />)}
      </div>
    </Section>
  );
}

function CodeCard({ code }) {
  const host = useShareHost();
  const link = host + '?c=' + code.code;
  const fullLink = 'https://' + link;
  const isExpired = code.status === 'expired';
  return (
    <Crosshair className="ad-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h3 style={{ fontFamily: "'Newsreader',serif", fontSize: 20, fontWeight: 500, margin: 0 }}>{code.label}</h3>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: isExpired ? 'var(--faint)' : 'var(--accent)' }}>{isExpired ? 'expired' : '● active'}</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            <span style={{ color: 'var(--ink)' }}>{code.code}</span> · {code.purpose}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn kind="ghost" size="sm">preview ↗</Btn>
          <Btn kind="outline" size="sm">edit</Btn>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 18, marginTop: 16 }}>
        <div>
          <SmallCaps>members</SmallCaps>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {code.members.slice(0,4).map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontFamily: "'Newsreader',serif", fontStyle: m.anon ? 'italic' : 'normal', color: m.anon ? 'var(--muted)' : 'var(--ink)' }}>
                <span>{m.name}</span><span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{m.last}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SmallCaps>scope</SmallCaps>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {code.scope.map(t => <Chip key={t}>{t}</Chip>)}
            {code.excluded.map(t => <Chip key={t} tone="private">× {t}</Chip>)}
          </div>
        </div>
        <QRCode value={fullLink} size={80} />
      </div>
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Quota used={code.uses} max={code.quota} label="uses" />
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{link}</span>
      </div>
    </Crosshair>
  );
}

/* ── access requests · inbox + decision flow ─────────────────────── */

function RequestsSection() {
  return (
    <Section kicker="access · gate inbox" title="requests" count={REQUESTS.filter(r=>r.status==='new').length + ' new'} action={
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>auto-decline rules · 0 set</span>
        <Btn kind="outline">rules</Btn>
      </div>
    }>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 20, maxWidth: '54em' }}>
        Submissions from the gate's "no code" path. Approve and you'll generate a code on the spot; decline and they
        get a polite note (with optional reason). Sijie reads every one personally — that's the point.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {REQUESTS.map(r => <RequestRow key={r.id} r={r} />)}
      </div>
    </Section>
  );
}

function RequestRow({ r }) {
  const tone = { new: 'accent', pending: 'amber', approved: 'neutral', declined: 'neutral' }[r.status];
  return (
    <article className="ad-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h4 style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, margin: 0 }}>{r.name}</h4>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>· {r.org}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>· {r.email}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--faint)', marginTop: 4 }}>{r.when}</div>
        </div>
        <Pill tone={tone}>{r.status}{r.issued_code ? ' · ' + r.issued_code : ''}</Pill>
      </div>
      <blockquote style={{ fontFamily: "'Newsreader',serif", fontStyle: 'italic', fontSize: 16, color: 'var(--ink)', borderLeft: '2px solid var(--rule)', paddingLeft: 16, margin: '0 0 12px' }}>
        "{r.note}"
      </blockquote>
      {r.status === 'new' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Btn kind="solid" size="sm">approve · issue code →</Btn>
          <Btn kind="outline" size="sm">decline politely</Btn>
          <Btn kind="ghost" size="sm">defer · pending</Btn>
          <Btn kind="ghost" size="sm" className="sm-btn-danger">block sender</Btn>
        </div>
      )}
      {r.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Btn kind="solid" size="sm">approve · issue code →</Btn>
          <Btn kind="outline" size="sm">decline</Btn>
        </div>
      )}
      {r.status === 'declined' && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>declined · {r.decline_reason}</div>
      )}
    </article>
  );
}

/* ── preview · clickable code-perspective embed ─────────────────── */

function PreviewSection() {
  const [selected, setSelected] = React.useState(CODES[0].id);
  const code = CODES.find(c => c.id === selected);
  const host = useShareHost();
  return (
    <Section kicker="access · external view" title="preview" action={
      <a href="index.html" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>open public ↗</a>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SmallCaps>see-as · code</SmallCaps>
          {CODES.map(c => (
            <button key={c.id} onClick={() => setSelected(c.id)} className="ad-card tight" style={{
              textAlign: 'left', background: selected === c.id ? 'var(--surface)' : 'transparent',
              borderColor: selected === c.id ? 'var(--ink)' : 'var(--rule)',
              cursor: 'pointer',
            }}>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{c.label}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{c.code} · {c.scope.length} included · {c.excluded.length} excluded</div>
            </button>
          ))}
          <button onClick={() => setSelected('byoai')} className="ad-card tight" style={{
            textAlign: 'left', background: selected === 'byoai' ? 'var(--surface)' : 'transparent',
            borderColor: selected === 'byoai' ? 'var(--ink)' : 'var(--rule)',
            cursor: 'pointer',
          }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>BYOAI · anonymous</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>public scope only</div>
          </button>
        </div>
        <div className="preview-frame">
          <SmallCaps>preview · visitor view</SmallCaps>
          {selected === 'byoai' ? (
            <div style={{ marginTop: 16 }}>
              <Banner tone="accent" right={[<a key="r" href="#" className="mono" style={{ color: 'var(--muted)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 10 }}>request a code ↗</a>]}>
                <LiveDot /><span style={{ color: 'var(--accent)' }}>byoai mode</span><span style={{ color: 'var(--faint)' }}>·</span><span>model · claude</span><span style={{ color: 'var(--faint)' }}>·</span><span>public scope</span>
              </Banner>
              <p style={{ fontFamily: "'Newsreader',serif", fontSize: 17, color: 'var(--ink)', marginTop: 16, lineHeight: 1.55 }}>
                Hi. You're running on your own claude key — pay for inference, public slice only. Private topics return a "need a code" response.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <Banner tone="accent">
                <LiveDot /><span style={{ color: 'var(--accent)' }}>{code.label}</span><span style={{ color: 'var(--faint)' }}>·</span><span>code · {code.code}</span>
              </Banner>
              <p style={{ fontFamily: "'Newsreader',serif", fontSize: 17, color: 'var(--ink)', marginTop: 16, lineHeight: 1.55 }}>
                Welcome. You've come in on <span style={{ color: 'var(--accent)' }}>{code.label}</span>.
                I'm scoped to: {code.scope.join(', ')}. Private topics from {code.excluded.join(' / ')} stay redacted.
                Ask anything in scope.
              </p>
              <div style={{ marginTop: 20 }}>
                <SmallCaps>suggested by you</SmallCaps>
                <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {code.suggested.slice(0,3).map((q, i) => (
                    <li key={i} style={{ fontFamily: "'Newsreader',serif", fontStyle: 'italic', fontSize: 15, color: 'var(--muted)' }}>"{q}"</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

/* ── jobs · sources ────────────────────────────────────────────── */

function SourceConfigModal({ source, onClose, onSave }) {
  const isNew = !source;
  const [form, setForm] = React.useState({
    kind: source?.kind || 'greenhouse',
    label: source?.label || '',
    url: source?.url || '',
    enabled: source?.enabled ?? true,
    cadence: '30m',
    filters: source?.filters || 'title:(staff OR senior OR founding) AND NOT title:manager',
  });
  const KINDS = [
    { id: 'greenhouse', label: 'Greenhouse', hint: 'boards.greenhouse.io/<slug>' },
    { id: 'lever',      label: 'Lever',      hint: 'jobs.lever.co/<slug>' },
    { id: 'wellfound',  label: 'Wellfound',  hint: 'wellfound.com/<slug>' },
    { id: 'rss',        label: 'RSS feed',   hint: 'any RSS/Atom URL' },
    { id: 'scraper',    label: 'HTML scraper', hint: 'arbitrary careers page' },
  ];
  const cur = KINDS.find((k) => k.id === form.kind);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open onClose={onClose} maxWidth={680}
      kicker={isNew ? 'new source' : 'edit source'}
      title={isNew ? 'connect a job feed' : form.label || 'untitled source'}
      footer={
        <>
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em' }}>
            {form.enabled ? '● on' : '○ off'} · scans every {form.cadence}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={onClose}>cancel</Btn>
            <Btn kind="solid" onClick={() => onSave(form)}>{isNew ? 'connect →' : 'save'}</Btn>
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="smallcaps" style={{ marginBottom: 8 }}>kind</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {KINDS.map((k) => (
              <button key={k.id} onClick={() => set('kind', k.id)}
                className="mono"
                style={{
                  padding: '6px 12px', borderRadius: 2, border: '1px solid var(--rule)',
                  background: form.kind === k.id ? 'var(--ink)' : 'transparent',
                  color: form.kind === k.id ? 'var(--paper)' : 'var(--muted)',
                  fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                  cursor: 'pointer',
                }}>{k.label}</button>
            ))}
          </div>
        </div>
        <Field label="label" hint="shown in the table">
          <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Anthropic" />
        </Field>
        <Field label="url / path" hint={cur.hint}>
          <Input mono value={form.url} onChange={(e) => set('url', e.target.value)} placeholder={cur.hint} />
        </Field>
        <Field label="filters · saved-search dsl" hint="applied before listings are ranked">
          <Textarea rows={2} value={form.filters} onChange={(e) => set('filters', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="scan cadence">
            <Segmented value={form.cadence} options={['15m','30m','1h','6h']} onChange={(v) => set('cadence', v)} />
          </Field>
          <Field label="status">
            <Segmented value={form.enabled ? 'on' : 'off'} options={[{value:'on',label:'enabled'},{value:'off',label:'paused'}]} onChange={(v) => set('enabled', v === 'on')} />
          </Field>
        </div>
        <Crosshair className="ad-card" style={{ marginTop: 6 }}>
          <SmallCaps>preview · last scan would have caught</SmallCaps>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8, marginTop: 6, letterSpacing: '0.02em' }}>
            <div><span style={{ color: 'var(--accent)' }}>↑ 3 new</span> · Staff Software Engineer · Applied (filter match)</div>
            <div><span style={{ color: 'var(--accent)' }}>↑</span> · Member of Technical Staff · Applied AI</div>
            <div><span style={{ color: 'var(--faint)' }}>—</span> · Engineering Manager <span style={{ color: 'var(--faint)' }}>(excluded by filter)</span></div>
          </div>
        </Crosshair>
      </div>
    </Modal>
  );
}

function SourcesSection() {
  const [open, setOpen] = React.useState(null); // null | source | 'new'
  return (
    <Section kicker="jobs · sources" title="sources" count={JOB_SOURCES.filter(s=>s.enabled).length + ' active'} action={
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="outline" onClick={() => setOpen('new')}>＋ rss / scraper</Btn>
        <Btn kind="solid" onClick={() => setOpen('new')}>＋ board</Btn>
      </div>
    }>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 20, maxWidth: '54em' }}>
        Where the loop pulls listings from. Greenhouse / Lever / Wellfound are first-class; RSS and HTML scrapers
        are also supported. Each source is scanned every 30 minutes.
      </p>
      <table className="ad-table">
        <thead><tr><th>source</th><th>kind</th><th>new</th><th>total</th><th>last scan</th><th></th></tr></thead>
        <tbody>
          {JOB_SOURCES.map(s => (
            <tr key={s.id} onClick={() => setOpen(s)} style={{ cursor: 'pointer' }}>
              <td>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{s.label}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{s.url}</div>
              </td>
              <td className="num"><span style={{ color: 'var(--ink)' }}>{s.kind}</span></td>
              <td className="num">{s.new_count > 0 ? <span style={{ color: 'var(--accent)' }}>↑ {s.new_count}</span> : <span>—</span>}</td>
              <td className="num">{s.total}</td>
              <td className="num">{s.last_run}</td>
              <td style={{ textAlign: 'right' }}>
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: s.enabled ? 'var(--accent)' : 'var(--faint)' }}>
                  {s.enabled ? '● on' : '○ off'}
                </span>
                <Btn kind="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setOpen(s); }}>edit</Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <SourceConfigModal source={open === 'new' ? null : open} onClose={() => setOpen(null)} onSave={() => setOpen(null)} />}
    </Section>
  );
}

/* ── jobs · listings ───────────────────────────────────────────── */

function ListingsSection() {
  const [filter, setFilter] = React.useState('shortlist');
  const counts = {
    all:        JOB_LISTINGS.length,
    shortlist:  JOB_LISTINGS.filter(j=>j.status==='shortlist').length,
    applied:    JOB_LISTINGS.filter(j=>j.status==='applied').length,
    considering:JOB_LISTINGS.filter(j=>j.status==='considering').length,
    pass:       JOB_LISTINGS.filter(j=>j.status==='pass').length,
  };
  const list = filter === 'all' ? JOB_LISTINGS : JOB_LISTINGS.filter(j => j.status === filter);
  return (
    <Section kicker="jobs · listings" title="listings" count={JOB_LISTINGS.length + ' indexed'} action={
      <div style={{ display: 'flex', gap: 4 }}>
        {['shortlist','applied','considering','pass','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className="mono" style={{
            fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
            padding: '4px 8px', background: 'transparent', border: 0, cursor: 'pointer',
            color: filter === f ? 'var(--ink)' : 'var(--muted)',
            borderBottom: filter === f ? '1px solid var(--accent)' : '1px solid transparent',
          }}>{f} <span style={{ color: 'var(--faint)', marginLeft: 4 }}>{counts[f]}</span></button>
        ))}
      </div>
    }>
      <table className="ad-table">
        <thead><tr><th>role</th><th>match</th><th>comp</th><th>posted</th><th>status</th><th></th></tr></thead>
        <tbody>
          {list.map(j => (
            <tr key={j.id}>
              <td>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>{j.title}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{j.company} · {j.location}</div>
                <div className="reading" style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 4, maxWidth: '40em' }}>{j.why}</div>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="match-bar"><div className="match-fill" style={{ width: (j.match * 100) + '%' }} /></div>
                  <span className="num" style={{ color: 'var(--accent)' }}>{Math.round(j.match * 100)}%</span>
                </div>
              </td>
              <td className="num">{j.comp}</td>
              <td className="num">{j.posted}</td>
              <td>
                <span className="mono" style={{
                  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: j.status === 'applied' ? 'var(--accent)' : j.status === 'shortlist' ? 'var(--ink)' : 'var(--muted)',
                }}>● {j.status}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {j.status === 'shortlist' && <Btn kind="solid" size="sm">draft resume →</Btn>}
                {j.status === 'applied' && <Btn kind="ghost" size="sm">view application</Btn>}
                {(j.status === 'considering' || j.status === 'pass') && <Btn kind="outline" size="sm">shortlist</Btn>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── jobs · drafts ─────────────────────────────────────────────── */

// initial editable model — would come from RESUME_DRAFTS.<id>.snapshot in real backend
function buildDraftModel(d) {
  const job = JOB_LISTINGS.find((j) => j.id === d.for_job);
  return {
    id: d.id,
    company: d.company, role: d.title, job_id: d.for_job, job: job,
    summary: 'Building Lucerna — retrieval substrate for personal corpora. Previously led retrieval-quality at Google Brain (top-1 38% → 71% in nine months on the 2023 product launch). I think the eval is the product; the model is the tax. Tailored for this loop on the rebuilt-eval story.',
    contact: { email: 'sijie@standmeet.com', location: 'Markham, Ontario', site: 'standmeet.com/sijie' },
    skills: ['retrieval / RAG','evaluation methodology','llm post-training','distributed systems','python / typescript / rust'],
    experience: [
      { id: 'e-1', org: 'Lucerna', role: 'founder · technical', range: '2024 — present', loc: 'Markham',
        bullets: [
          'Founded Lucerna, retrieval substrate for personal corpora. Four-person team, two customers, growing.',
          'Built the eval methodology we sell on — three columns: faithfulness, attribution, refusal-when-absent.',
          'Personally hold technical bar; wrote ~60% of the production code; rest is K. + two contractors.',
        ],
      },
      { id: 'e-2', org: 'Google Brain', role: 'research engineer', range: '2019 — 2024', loc: 'SF',
        bullets: [
          'Led retrieval quality for an unnamed 2023 product launch — top-1 38% → 71% in nine months.',
          'Roughly half the gain came from rebuilding the eval rubric, half from modeling. The reframing was the contribution.',
          'Authored the team\u2019s ML-onboarding doc, copied into three adjacent teams.',
        ],
      },
      { id: 'e-3', org: 'Stripe', role: 'software engineer', range: '2017 — 2019', loc: 'SF',
        bullets: [
          'Payments reliability — wrote idempotency-layer caching that handled ~12% of total traffic.',
          'Pre-Brain career step; mostly distributed systems and on-call discipline.',
        ],
      },
    ],
    education: [
      { id: 'ed-1', school: 'Stanford', degree: 'PhD, representation learning', range: '2013 — 2019' },
      { id: 'ed-2', school: 'Tsinghua', degree: 'BSc, applied mathematics',     range: '2009 — 2013' },
    ],
    cover_letter: d.cover_letter ?
`Dear ${job ? job.company : 'team'},

The role caught my eye for the obvious reason — Lucerna's hardest problem is retrieval quality, and the way I think about retrieval is downstream of the eval. That's the same wager you're making on ${job ? job.title.toLowerCase() : 'this role'}.

I led retrieval-quality at Brain for the 2023 launch and we moved top-1 from 38% to 71% over nine months. The story I want to tell on a call isn't the number — it's the reframe: half of the gain was modeling, half was rebuilding the eval to measure something that mattered. I expect that frame is portable to your stack.

Happy to share more on a 30-min call.

— Sijie` : null,
  };
}

const COMPOSER_PANELS = [
  { id:'header',     label:'header' },
  { id:'summary',    label:'summary' },
  { id:'skills',     label:'skills' },
  { id:'experience', label:'experience' },
  { id:'education',  label:'education' },
  { id:'cover',      label:'cover letter' },
];

function ResumeComposer({ draft, onClose }) {
  const [model, setModel] = React.useState(() => buildDraftModel(draft));
  const [panel, setPanel] = React.useState('header');
  const [zoom, setZoom] = React.useState(0.62);
  const [pgIdx, setPgIdx] = React.useState(0);
  const [confirm, setConfirm] = React.useState(false);

  // last saved indicator
  const [lastSaved, setLastSaved] = React.useState('just now');
  React.useEffect(() => { setLastSaved('moments ago'); const t = setTimeout(() => setLastSaved('saved'), 600); return () => clearTimeout(t); }, [model]);

  const set = (patch) => setModel((m) => ({ ...m, ...patch }));
  const setExp = (id, patch) => set({ experience: model.experience.map((e) => e.id === id ? { ...e, ...patch } : e) });
  const setEdu = (id, patch) => set({ education:  model.education.map((e) => e.id === id ? { ...e, ...patch } : e) });

  // confidence — fake but reactive: bullets w/ numbers + role-fit keywords push it up
  const confidence = React.useMemo(() => {
    const text = JSON.stringify(model).toLowerCase();
    const hits = (text.match(/retrieval|eval|71%|38%|moat|brain|lucerna/g) || []).length;
    return Math.min(0.98, 0.5 + hits * 0.03);
  }, [model]);

  // pages: just split experience into a 2-page mock based on count
  const pages = model.experience.length > 2 ? 2 : 1;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'var(--paper)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* sticky composer top bar */}
      <header style={{
        height: 56, padding: '0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--rule)', flexShrink: 0, gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
          <button onClick={onClose} className="mono" style={{ background: 'transparent', border: 0, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', cursor: 'pointer' }}>← drafts</button>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink)' }}>{model.company} <span style={{ color: 'var(--muted)' }}>· {model.role}</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Quota used={Math.round(confidence * 100)} max={100} label="match" />
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em' }}>{lastSaved}</span>
          <Btn kind="outline" size="sm">regenerate ⌖</Btn>
          <Btn kind="solid" size="sm" onClick={() => setConfirm(true)}>send →</Btn>
        </div>
      </header>

      {/* main: two-pane editor + preview */}
      <div className="composer-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
        {/* LEFT — editor */}
        <div style={{ borderRight: '1px solid var(--rule)', display: 'flex', minHeight: 0 }}>
          {/* section nav rail */}
          <nav style={{ width: 132, flexShrink: 0, borderRight: '1px solid var(--rule)', padding: '14px 0', display: 'flex', flexDirection: 'column' }}>
            {COMPOSER_PANELS.map((p) => (
              <button key={p.id} onClick={() => setPanel(p.id)} className={'nav-link ' + (panel === p.id ? 'active' : '')} style={{ fontSize: 11 }}>
                <span className="name">{p.label}</span>
              </button>
            ))}
            <div style={{ marginTop: 'auto', padding: '14px 16px', borderTop: '1px solid var(--rule)' }}>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', lineHeight: 1.7 }}>
                based on master · diff visible in preview
              </div>
            </div>
          </nav>

          {/* panel content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
            {panel === 'header' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="role applying for"><Input value={model.role} onChange={(e) => set({ role: e.target.value })} /></Field>
                <Field label="company"><Input value={model.company} onChange={(e) => set({ company: e.target.value })} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="email"><Input mono value={model.contact.email} onChange={(e) => set({ contact: { ...model.contact, email: e.target.value } })} /></Field>
                  <Field label="location"><Input value={model.contact.location} onChange={(e) => set({ contact: { ...model.contact, location: e.target.value } })} /></Field>
                </div>
                <Field label="public site"><Input mono value={model.contact.site} onChange={(e) => set({ contact: { ...model.contact, site: e.target.value } })} /></Field>
              </div>
            )}

            {panel === 'summary' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="opening summary" hint="3 sentences max · what they should know in 8 seconds">
                  <Textarea rows={6} value={model.summary} onChange={(e) => set({ summary: e.target.value })} />
                </Field>
                <Crosshair className="ad-card" style={{ background: 'color-mix(in oklab, var(--accent) 4%, transparent)' }}>
                  <SmallCaps>ai suggestion</SmallCaps>
                  <p className="reading" style={{ fontSize: 14, color: 'var(--muted)', margin: '6px 0 0', lineHeight: 1.55 }}>
                    For Anthropic Applied — lead with the eval-rebuild story, mention the 71% number, drop the Stripe years (too far). One sentence on Lucerna, one on Brain, one on what you'd bring.
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <Btn size="sm" kind="outline">apply suggestion</Btn>
                    <Btn size="sm" kind="ghost">regenerate</Btn>
                  </div>
                </Crosshair>
              </div>
            )}

            {panel === 'skills' && (
              <div>
                <Field label="skills · ordered for this role">
                  <Textarea rows={4} value={model.skills.join('\n')} onChange={(e) => set({ skills: e.target.value.split('\n').filter(Boolean) })} />
                </Field>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 8, letterSpacing: '0.06em' }}>
                  one per line · move the most-relevant ones up
                </div>
              </div>
            )}

            {panel === 'experience' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {model.experience.map((e, i) => (
                  <article key={e.id} className="ad-card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <Input value={e.org} onChange={(ev) => setExp(e.id, { org: ev.target.value })} placeholder="org" style={{ flex: 1 }} />
                      <Input value={e.role} onChange={(ev) => setExp(e.id, { role: ev.target.value })} placeholder="role" style={{ flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <Input mono value={e.range} onChange={(ev) => setExp(e.id, { range: ev.target.value })} placeholder="2024 — present" style={{ flex: 1 }} />
                      <Input value={e.loc} onChange={(ev) => setExp(e.id, { loc: ev.target.value })} placeholder="city" style={{ flex: 1 }} />
                    </div>
                    <SmallCaps>bullets</SmallCaps>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {e.bullets.map((b, bi) => (
                        <div key={bi} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', paddingTop: 6 }}>·</span>
                          <Textarea rows={2} value={b} onChange={(ev) => {
                            const next = [...e.bullets]; next[bi] = ev.target.value; setExp(e.id, { bullets: next });
                          }} style={{ flex: 1 }} />
                          <button onClick={() => setExp(e.id, { bullets: e.bullets.filter((_, j) => j !== bi) })} className="mono" style={{ background: 'transparent', border: 0, color: 'var(--faint)', cursor: 'pointer', padding: '6px 4px' }}>×</button>
                        </div>
                      ))}
                      <button onClick={() => setExp(e.id, { bullets: [...e.bullets, ''] })} className="mono" style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', textAlign: 'left', padding: '4px 0' }}>＋ add bullet</button>
                    </div>
                    {i < model.experience.length - 1 && (
                      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => set({ experience: model.experience.filter((x) => x.id !== e.id) })} className="mono" style={{ background: 'transparent', border: 0, color: 'var(--faint)', cursor: 'pointer', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>remove role</button>
                      </div>
                    )}
                  </article>
                ))}
                <Btn kind="outline" size="sm" onClick={() => set({ experience: [...model.experience, { id: 'e-' + Date.now(), org: '', role: '', range: '', loc: '', bullets: [''] }] })}>＋ add role</Btn>
              </div>
            )}

            {panel === 'education' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {model.education.map((e) => (
                  <div key={e.id} className="ad-card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <Input value={e.school} onChange={(ev) => setEdu(e.id, { school: ev.target.value })} placeholder="school" style={{ flex: 1 }} />
                      <Input mono value={e.range} onChange={(ev) => setEdu(e.id, { range: ev.target.value })} placeholder="2019 — 2024" style={{ flex: 1 }} />
                    </div>
                    <Input value={e.degree} onChange={(ev) => setEdu(e.id, { degree: ev.target.value })} placeholder="degree" />
                  </div>
                ))}
              </div>
            )}

            {panel === 'cover' && (
              <div>
                <Field label="cover letter" hint="markdown ok · rendered on page 2">
                  <Textarea rows={14} value={model.cover_letter || ''} onChange={(e) => set({ cover_letter: e.target.value })} />
                </Field>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{(model.cover_letter || '').length} chars · ≈ {Math.round((model.cover_letter || '').length / 5 / 60)} min read</span>
                  <Btn size="sm" kind="outline">regenerate ⌖</Btn>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — preview */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'color-mix(in oklab, var(--surface) 40%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid var(--rule)' }}>
            <SmallCaps>preview · resume_{model.company.toLowerCase().replace(/\s+/g,'-')}.pdf</SmallCaps>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setPgIdx((i) => Math.max(0, i - 1))} disabled={pgIdx === 0} className="mono" style={{ background: 'transparent', border: 0, color: pgIdx === 0 ? 'var(--faint)' : 'var(--muted)', cursor: pgIdx === 0 ? 'default' : 'pointer', fontSize: 14 }}>←</button>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{pgIdx + 1} / {pages}</span>
              <button onClick={() => setPgIdx((i) => Math.min(pages - 1, i + 1))} disabled={pgIdx >= pages - 1} className="mono" style={{ background: 'transparent', border: 0, color: pgIdx >= pages - 1 ? 'var(--faint)' : 'var(--muted)', cursor: pgIdx >= pages - 1 ? 'default' : 'pointer', fontSize: 14 }}>→</button>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} className="mono" style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>−</button>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', tabularNums: true, minWidth: 32, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(1.2, z + 0.1))} className="mono" style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>+</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '24px 0' }}>
            <ResumePage model={model} pageIndex={pgIdx} zoom={zoom} />
          </div>
        </div>
      </div>

      {confirm && (
        <Modal open onClose={() => setConfirm(false)} maxWidth={480}
          kicker="commit this application"
          title={'Send to ' + model.company + '?'}
          footer={<>
            <Btn kind="ghost" onClick={() => setConfirm(false)}>cancel</Btn>
            <Btn kind="accent" onClick={() => { setConfirm(false); onClose(); }}>send · commit ↵</Btn>
          </>}
        >
          <p className="reading" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 10 }}>
            This will freeze the current draft, generate the PDF, and log an application entry under <span className="mono">jobs · applications</span>.
          </p>
          <p className="reading" style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 4 }}>
            Once committed, the resume snapshot is read-only — you can edit the master, but this version of the
            PDF is what {model.company} will see.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ResumePage({ model, pageIndex, zoom }) {
  // canvas-style page so the preview looks like a PDF, scaled with zoom
  const W = 612; // 8.5 * 72
  const H = 792; // 11 * 72
  return (
    <div style={{
      width:  W * zoom, height: H * zoom,
      background: 'white',
      boxShadow: '0 24px 60px rgba(0,0,0,0.12), 0 1px 0 var(--rule)',
      transformOrigin: 'top center',
      color: '#1B1814',
      fontFamily: "'Newsreader',serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ transform: 'scale(' + zoom + ')', transformOrigin: 'top left', width: W, height: H, padding: '48px 52px', boxSizing: 'border-box' }}>
        {pageIndex === 0 && (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.018em', lineHeight: 1, margin: 0 }}>sijie wang</h1>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: '#7A7167', letterSpacing: '0.06em', marginTop: 4 }}>
              {model.contact.email} · {model.contact.location} · {model.contact.site}
            </div>
            <hr style={{ border: 0, borderTop: '1px solid #DCD3BF', margin: '14px 0' }} />

            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7167', marginBottom: 6 }}>summary</div>
            <p style={{ fontSize: 11.5, lineHeight: 1.5, margin: 0 }}>{model.summary}</p>

            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7167', marginTop: 16, marginBottom: 6 }}>experience</div>
            {model.experience.slice(0, 2).map((e) => (
              <div key={e.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 12 }}>{e.org}</span>
                    <span style={{ color: '#7A7167', fontSize: 11 }}> · {e.role}</span>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#7A7167' }}>{e.range} · {e.loc}</div>
                </div>
                <ul style={{ marginTop: 4, paddingLeft: 14, fontSize: 10.5, lineHeight: 1.45 }}>
                  {e.bullets.filter(Boolean).map((b, i) => <li key={i} style={{ marginBottom: 3 }}>{b}</li>)}
                </ul>
              </div>
            ))}

            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7167', marginTop: 14, marginBottom: 6 }}>education</div>
            {model.education.map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 3 }}>
                <span><span style={{ fontWeight: 500 }}>{e.school}</span> · {e.degree}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#7A7167' }}>{e.range}</span>
              </div>
            ))}

            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A7167', marginTop: 14, marginBottom: 6 }}>skills</div>
            <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>{model.skills.join(' · ')}</div>

            <div style={{ position: 'absolute', bottom: 20, right: 36, fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: '#B0A89A' }}>1 / 2</div>
          </>
        )}

        {pageIndex === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.018em', lineHeight: 1, margin: 0 }}>cover letter</h1>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: '#7A7167', letterSpacing: '0.06em', marginTop: 4 }}>
              to · {model.company} · {model.role}
            </div>
            <hr style={{ border: 0, borderTop: '1px solid #DCD3BF', margin: '14px 0' }} />
            <div style={{ fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{model.cover_letter}</div>
            <div style={{ position: 'absolute', bottom: 20, right: 36, fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: '#B0A89A' }}>2 / 2</div>
          </>
        )}
      </div>
    </div>
  );
}

function DraftsSection() {
  const [openDraft, setOpenDraft] = React.useState(null);
  return (
    <Section kicker="jobs · resume drafts" title="drafts" count={RESUME_DRAFTS.length} action={<Btn kind="outline">master resume ↗</Btn>}>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        Each draft is a per-application snapshot of your master resume, tailored by AI to the job posting.
        Click any draft to open the side-by-side composer — edit on the left, watch the PDF preview update on the right.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {RESUME_DRAFTS.map(d => <DraftCard key={d.id} d={d} onOpen={() => setOpenDraft(d)} />)}
      </div>
      {openDraft && <ResumeComposer draft={openDraft} onClose={() => setOpenDraft(null)} />}
    </Section>
  );
}

function DraftCard({ d, onOpen }) {
  const isPdf = d.status === 'sent';
  return (
    <div className="ad-card" style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 20 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <h4 style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, margin: 0 }}>{d.company} · {d.title}</h4>
          <Pill tone={d.status === 'sent' ? 'accent' : d.status === 'reviewing' ? 'amber' : 'neutral'}>{d.status}</Pill>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.04em', marginBottom: 8 }}>
          based on master · cover letter {d.cover_letter ? 'included' : 'not yet'} · confidence {Math.round(d.confidence * 100)}% · updated {d.updated}
        </div>
        <SmallCaps>diff vs master</SmallCaps>
        <div className="reading" style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, padding: 12, borderLeft: '2px solid var(--accent)', background: 'color-mix(in oklab, var(--accent) 4%, transparent)' }}>
          {d.delta}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {d.status === 'reviewing' && <><Btn kind="solid" size="sm" onClick={onOpen}>open composer →</Btn><Btn kind="outline" size="sm" onClick={onOpen}>edit</Btn><Btn kind="ghost" size="sm">regenerate</Btn></>}
          {d.status === 'draft' && <><Btn kind="outline" size="sm" onClick={onOpen}>finish drafting →</Btn><Btn kind="ghost" size="sm">discard</Btn></>}
          {d.status === 'sent' && <><Btn kind="ghost" size="sm">view application</Btn><Btn kind="outline" size="sm" onClick={onOpen}>view pdf</Btn></>}
        </div>
      </div>
      {/* preview */}
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 3,
        padding: 12,
        height: 220,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 14, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.01em' }}>sijie wang</div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 7.5, letterSpacing: '0.06em', color: 'var(--muted)', marginTop: 2 }}>Markham · sijie@standmeet.com</div>
        <div style={{ borderTop: '1px solid var(--rule)', margin: '10px 0' }}></div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 6.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>experience</div>
        <div style={{ marginTop: 4, fontSize: 7.5, fontFamily: "'Newsreader',serif", lineHeight: 1.35 }}>
          <div style={{ fontWeight: 500 }}>Lucerna · founder</div>
          <div style={{ color: 'var(--muted)' }}>retrieval substrate</div>
          <div style={{ marginTop: 4, fontWeight: 500 }}>Google Brain · research eng</div>
          <div style={{ color: 'var(--muted)' }}>retrieval quality lead · 71% top-1</div>
        </div>
        <div style={{ position: 'absolute', bottom: 8, left: 12, right: 12, fontFamily: "'JetBrains Mono',monospace", fontSize: 7, color: 'var(--faint)', display: 'flex', justifyContent: 'space-between' }}>
          <span>resume_{d.company.toLowerCase()}.pdf</span>
          <span>1 / 2</span>
        </div>
      </div>
    </div>
  );
}

/* ── jobs · applications ─────────────────────────────────────── */

function ApplicationDetailModal({ app, onClose }) {
  const job = JOB_LISTINGS.find(j => j.id === app.job_id);
  const draft = RESUME_DRAFTS.find(d => d.id === app.resume_draft_id);
  const timeline = [
    { t: app.sent_at,        label: 'application sent',      kind: 'accent' },
    { t: '6 hours later',     label: 'application opened (mailbox tracker)', kind: 'muted' },
    { t: 'next morning',      label: 'recruiter replied · scheduling',       kind: app.status === 'reviewing' ? 'accent' : 'muted' },
    { t: 'in progress',       label: 'reviewing',                            kind: app.status === 'reviewing' ? 'accent' : 'faint' },
  ];
  return (
    <Modal open onClose={onClose} maxWidth={920}
      kicker={`application · ${app.id}`}
      title={job ? `${job.title} · ${job.company}` : 'untitled application'}
      footer={
        <>
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em' }}>
            sent {app.sent_at} · {app.method}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" className="sm-btn-danger">withdraw</Btn>
            <Btn kind="outline">log update</Btn>
            <Btn kind="solid" onClick={onClose}>close</Btn>
          </div>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <div>
          <SmallCaps>timeline</SmallCaps>
          <div style={{ marginTop: 10, position: 'relative', paddingLeft: 18 }}>
            <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 1, background: 'var(--rule)' }} />
            {timeline.map((evt, i) => (
              <div key={i} style={{ position: 'relative', paddingBottom: 14 }}>
                <div style={{ position: 'absolute', left: -16, top: 4, width: 8, height: 8, borderRadius: '50%', background: evt.kind === 'accent' ? 'var(--accent)' : evt.kind === 'muted' ? 'var(--muted)' : 'var(--rule)', boxShadow: evt.kind === 'accent' ? '0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent)' : 'none' }} />
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em' }}>{evt.t}</div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, marginTop: 2, color: evt.kind === 'faint' ? 'var(--faint)' : 'var(--ink)' }}>{evt.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
            <SmallCaps>contact</SmallCaps>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, marginTop: 4 }}>{app.contact}</div>
            <Btn size="sm" kind="outline" style={{ marginTop: 8 }}>ping in chat ↗</Btn>
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
            <SmallCaps>private notes</SmallCaps>
            <Textarea rows={3} defaultValue={app.notes} style={{ marginTop: 6 }} />
          </div>
        </div>
        <div>
          <SmallCaps>resume sent · snapshot</SmallCaps>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', padding: 14, marginTop: 6, fontFamily: "'Newsreader',serif", aspectRatio: '8.5/11', overflow: 'hidden', position: 'relative' }}>
            <div style={{ fontSize: 18, fontWeight: 500 }}>sijie wang</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.06em', marginTop: 2 }}>Markham · sijie@standmeet.com · standmeet.com/sijie</div>
            <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '10px 0' }} />
            {draft && (
              <>
                <div className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>tailored for {draft.company}</div>
                <div style={{ fontSize: 11, lineHeight: 1.5, marginTop: 8, color: 'var(--ink)' }}>
                  <div style={{ fontWeight: 500 }}>Lucerna · founder</div>
                  <div style={{ color: 'var(--muted)' }}>retrieval substrate for personal corpora</div>
                  <div style={{ marginTop: 8, fontWeight: 500 }}>Google Brain · research engineer</div>
                  <div style={{ color: 'var(--muted)' }}>led retrieval-quality for the 2023 product launch · top-1 38% → 71%</div>
                  <div style={{ marginTop: 8, fontStyle: 'italic', color: 'var(--accent)' }}>{draft.delta}</div>
                </div>
              </>
            )}
            <div className="mono" style={{ position: 'absolute', bottom: 8, right: 14, fontSize: 7, color: 'var(--faint)' }}>1 / 2</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Btn size="sm" kind="outline">view full ↗</Btn>
            <Btn size="sm" kind="ghost">download pdf</Btn>
          </div>
          <div style={{ marginTop: 14, padding: '10px 12px', border: '1px solid var(--rule)', borderRadius: 3, background: 'color-mix(in oklab, var(--surface) 50%, transparent)' }}>
            <SmallCaps>status</SmallCaps>
            <div style={{ marginTop: 6 }}>
              <Segmented value={app.status} options={['silent','reviewing','replied','rejected','offer']} onChange={()=>{}} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ApplicationsSection() {
  const [open, setOpen] = React.useState(null);
  return (
    <Section kicker="jobs · sent" title="applications" count={APPLICATIONS.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {APPLICATIONS.length === 0 && <Empty title="No applications sent yet." blurb="Draft a resume from a shortlisted job listing, then send to commit it here." />}
        {APPLICATIONS.map(a => {
          const job = JOB_LISTINGS.find(j => j.id === a.job_id);
          return (
            <div key={a.id} className="ad-card" onClick={() => setOpen(a)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <h4 style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, margin: 0 }}>{job ? job.title : '—'}</h4>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{job ? job.company : ''} · sent {a.sent_at} · via {a.method}</div>
                </div>
                <Pill tone={a.status === 'reviewing' ? 'accent' : 'neutral'}>{a.status}</Pill>
              </div>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'baseline' }}>
                <div>
                  <SmallCaps>contact</SmallCaps>
                  <div style={{ fontFamily: "'Newsreader',serif", fontSize: 14, marginTop: 4 }}>{a.contact}</div>
                </div>
                <div>
                  <SmallCaps>notes</SmallCaps>
                  <div className="reading" style={{ fontSize: 13.5, marginTop: 4, color: 'var(--muted)' }}>{a.notes}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>open ›</span>
              </div>
            </div>
          );
        })}
      </div>
      {open && <ApplicationDetailModal app={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

/* ── jobs · skills graph ─────────────────────────────────────── */

function SkillsSection() {
  return (
    <Section kicker="jobs · skill graph" title="skills" count={SKILLS.length + ' tracked'} action={<Btn kind="outline">rebuild from corpus</Btn>}>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        Inferred from your corpus by tag frequency and writing recency. "Heat" measures how active a skill is in
        recent thinking; role buckets by maturity. The job loop uses this to score listings.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 18 }}>
        {SKILLS.map(s => (
          <div key={s.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontFamily: "'Newsreader',serif", fontSize: 15, color: 'var(--ink)' }}>{s.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{s.role} · {s.sources} sources</span>
            </div>
            <div className="heat-bar"><div className="heat-fill" style={{ width: (s.heat * 100) + '%' }} /></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── connectors / api ports ──────────────────────────────────── */

function ConnectorTypeCard({ entry, installed, onPick }) {
  return (
    <button
      onClick={() => onPick(entry)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left',
        padding: '14px 16px', borderRadius: 3, gap: 6,
        border: '1px solid var(--rule)',
        background: 'color-mix(in oklab, var(--surface) 50%, transparent)',
        cursor: 'pointer', position: 'relative',
        transition: 'border-color .15s, background .15s',
      }}
      onMouseEnter={(e)=>{ e.currentTarget.style.borderColor='var(--ink)'; }}
      onMouseLeave={(e)=>{ e.currentTarget.style.borderColor='var(--rule)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, width: '100%' }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, color: 'var(--accent)' }}>{entry.icon}</span>
        <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>{entry.name}</span>
        {installed && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>● installed</span>}
        {entry.builtin && !installed && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>built-in</span>}
      </div>
      <p className="reading" style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>{entry.blurb}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {entry.fields.slice(0, 3).map((f, i) => (
          <span key={i} className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--faint)', textTransform: 'lowercase', padding: '1px 6px', border: '1px solid var(--rule)', borderRadius: 1 }}>{f.k}{f.secret ? ' ·' : ''}{f.secret ? ' secret' : ''}{f.oauth ? ' · oauth' : ''}</span>
        ))}
      </div>
    </button>
  );
}

function ConnectorConfigForm({ entry, onCancel, onSave }) {
  const initial = {};
  for (const f of entry.fields) initial[f.k] = f.default || '';
  const [form, setForm] = React.useState(initial);
  const [reveal, setReveal] = React.useState({});
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="ad-card" style={{ padding: '14px 16px', background: 'color-mix(in oklab, var(--surface) 50%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, color: 'var(--accent)' }}>{entry.icon}</span>
          <h3 style={{ fontFamily: "'Newsreader',serif", fontSize: 19, fontWeight: 500, margin: 0 }}>{entry.name}</h3>
          <a href={entry.docs_url} className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', textDecoration: 'none', marginLeft: 'auto', letterSpacing: '0.12em', textTransform: 'uppercase' }}>docs ↗</a>
        </div>
        <p className="reading" style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0' }}>{entry.blurb}</p>
      </div>
      {entry.fields.map((f) => (
        <Field key={f.k} label={f.label} hint={f.secret ? 'never leaves this instance' : (f.oauth ? 'redirects to provider' : null)}>
          {f.oauth ? (
            <Btn kind="outline" size="md">{f.label} →</Btn>
          ) : f.options ? (
            <Segmented value={form[f.k] || f.options[0]} options={f.options} onChange={(v) => set(f.k, v)} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <input
                type={f.secret && !reveal[f.k] ? 'password' : 'text'}
                value={form[f.k] || ''} onChange={(e) => set(f.k, e.target.value)}
                placeholder={f.default || ''}
                className="sm-field-input"
                style={{ fontFamily: f.secret ? "'JetBrains Mono', monospace" : 'inherit' }}
              />
              {f.secret && (
                <button type="button" onClick={() => setReveal((r) => ({ ...r, [f.k]: !r[f.k] }))}
                  className="mono" style={{ background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  {reveal[f.k] ? 'hide' : 'reveal'}
                </button>
              )}
            </div>
          )}
        </Field>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6 }}>
        <Btn kind="ghost" onClick={onCancel}>← pick different</Btn>
        <Btn kind="solid" onClick={() => onSave({ entry, form })}>connect →</Btn>
      </div>
    </div>
  );
}

function ConnectorAddModal({ installed, onClose, onConnect }) {
  const [picked, setPicked] = React.useState(null);
  const [filter, setFilter] = React.useState('all');
  const installedIds = new Set(installed.map((c) => c.id));
  const filtered = filter === 'all' ? CONNECTOR_REGISTRY : CONNECTOR_REGISTRY.filter((e) => e.category === filter);
  return (
    <Modal open onClose={onClose} maxWidth={840}
      kicker={picked ? 'configure connector' : 'connector catalog'}
      title={picked ? picked.name : 'Connect something new.'}
      footer={!picked && (
        <>
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em' }}>
            {CONNECTOR_REGISTRY.length} connectors available · {installedIds.size} already installed
          </span>
          <a href="#" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none' }}>
            build your own · docs ↗
          </a>
        </>
      )}
    >
      {picked ? (
        <ConnectorConfigForm
          entry={picked}
          onCancel={() => setPicked(null)}
          onSave={(payload) => { onConnect(payload); onClose(); }}
        />
      ) : (
        <>
          <p className="reading" style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 16px', maxWidth: '54em' }}>
            Every connector is a small plugin: a name, an icon, a handful of fields, and a callback. The catalog
            below is the registry; adding a new one is a single object — no code in the admin to touch.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
            <button onClick={() => setFilter('all')} className="mono" style={{
              fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              padding: '4px 8px', background: 'transparent', border: 0, cursor: 'pointer',
              color: filter === 'all' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: filter === 'all' ? '1px solid var(--accent)' : '1px solid transparent',
            }}>all <span style={{ color: 'var(--faint)', marginLeft: 4 }}>{CONNECTOR_REGISTRY.length}</span></button>
            {CONNECTOR_CATEGORIES.map((c) => {
              const n = CONNECTOR_REGISTRY.filter((e) => e.category === c.id).length;
              return (
                <button key={c.id} onClick={() => setFilter(c.id)} className="mono" style={{
                  fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
                  padding: '4px 8px', background: 'transparent', border: 0, cursor: 'pointer',
                  color: filter === c.id ? 'var(--ink)' : 'var(--muted)',
                  borderBottom: filter === c.id ? '1px solid var(--accent)' : '1px solid transparent',
                }}>{c.label} <span style={{ color: 'var(--faint)', marginLeft: 4 }}>{n}</span></button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
            {filtered.map((entry) => (
              <ConnectorTypeCard key={entry.id} entry={entry} installed={installedIds.has(entry.id)} onPick={setPicked} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function ConnectorsSection() {
  const [showAdd, setShowAdd] = React.useState(false);
  return (
    <Section kicker="integrations" title="connectors"
      count={CONNECTORS.filter(c=>c.connected).length + ' / ' + CONNECTORS.length + ' connected'}
      action={
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>
            {CONNECTOR_REGISTRY.length} more available in catalog
          </span>
          <Btn kind="solid" onClick={() => setShowAdd(true)}>＋ add connector</Btn>
        </div>
      }
    >
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 18, maxWidth: '54em' }}>
        Every connector is a plugin entry — name + icon + fields + a callback. Browse the catalog to plug in new ones;
        the registry is data-driven so future integrations slot in without touching component code.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14 }}>
        {CONNECTORS.map(c => (
          <article key={c.id} className="ad-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <h3 style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, margin: 0 }}>{c.name}</h3>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: c.connected ? 'var(--accent)' : 'var(--faint)' }}>{c.connected ? '● connected' : '○ off'}</span>
            </div>
            <p className="reading" style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 12px' }}>{c.note}</p>
            <div style={{ paddingTop: 10, borderTop: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {c.account || <span style={{ color: 'var(--faint)' }}>no account linked</span>}
                {c.last_event && <><br/><span style={{ color: 'var(--faint)' }}>{c.last_event}</span></>}
              </div>
              <Btn kind={c.connected ? 'ghost' : 'outline'} size="sm">{c.connected ? 'manage' : 'connect ↗'}</Btn>
            </div>
          </article>
        ))}
        {/* "+ add" placeholder card · sits alongside installed ones */}
        <button onClick={() => setShowAdd(true)}
          className="ad-card" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: '1px dashed var(--rule)', background: 'transparent', cursor: 'pointer',
            color: 'var(--muted)', gap: 6, padding: '24px 16px',
            transition: 'border-color .15s, color .15s',
          }}
          onMouseEnter={(e)=>{ e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
          onMouseLeave={(e)=>{ e.currentTarget.style.borderColor='var(--rule)'; e.currentTarget.style.color='var(--muted)'; }}
        >
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, color: 'inherit' }}>＋</span>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            browse the catalog
          </span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em' }}>
            {CONNECTOR_REGISTRY.length} types available
          </span>
        </button>
      </div>
      {showAdd && (
        <ConnectorAddModal
          installed={CONNECTORS}
          onClose={() => setShowAdd(false)}
          onConnect={() => setShowAdd(false)}
        />
      )}
    </Section>
  );
}

function ApiSection() {
  const [tab, setTab] = React.useState('claude-desktop');
  const [secret, setSecret] = React.useState(false);
  const host = useShareHost();
  const baseUrl = 'https://' + host.replace(/\/.*/, '') + '/api/v1';
  const snippets = {
    'claude-desktop': `{
  "mcpServers": {
    "standmeet": {
      "command": "npx",
      "args": ["-y", "@standmeet/mcp-client@latest"],
      "env": {
        "STANDMEET_HOST": "${baseUrl}",
        "STANDMEET_API_KEY": "${API_TOKENS[0].secret}"
      }
    }
  }
}`,
    'cursor': `{
  "standmeet": {
    "command": "npx",
    "args": ["-y", "@standmeet/mcp-client@latest"],
    "env": {
      "STANDMEET_HOST": "${baseUrl}",
      "STANDMEET_API_KEY": "${API_TOKENS[0].secret}"
    }
  }
}`,
    'http': `curl -X POST ${baseUrl}/raw \\
  -H "authorization: Bearer ${API_TOKENS[0].secret}" \\
  -H "content-type: application/json" \\
  -d '{ "source":"claude", "body":"…", "tags":["thinking"] }'`,
  };
  return (
    <Section kicker="integrations · programmatic" title="api · mcp" count={API_TOKENS.length + ' tokens'} action={
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>base · <span style={{ color: 'var(--ink)' }}>{baseUrl}</span></span>
        <Btn kind="solid">＋ new token</Btn>
      </div>
    }>
      <div style={{ marginBottom: 28 }}>
        <GroupHeader title="api tokens" />
        {API_TOKENS.map(t => (
          <div key={t.id} className="ad-card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 17, fontWeight: 500 }}>{t.name}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>
                  created {t.created} · last used {t.last_used} · {t.uses_30d} calls last 30d
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {t.scopes.map(s => <Chip key={s}>{s}</Chip>)}
              </div>
            </div>
            <MaskedSecret value={t.secret} revealed={secret} onReveal={() => setSecret(s => !s)} onCopy={() => navigator.clipboard?.writeText(t.secret)} />
          </div>
        ))}
      </div>
      <Crosshair className="ad-card scan">
        <GroupHeader title="mcp setup" />
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {[
            { id: 'claude-desktop', label: 'Claude Desktop' },
            { id: 'cursor', label: 'Cursor' },
            { id: 'http', label: 'Raw HTTP' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className="mono" style={{
              fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              padding: '6px 12px', background: 'transparent', border: 0, cursor: 'pointer',
              color: tab === t.id ? 'var(--ink)' : 'var(--muted)',
              borderBottom: tab === t.id ? '1px solid var(--accent)' : '1px solid transparent',
            }}>{t.label}</button>
          ))}
        </div>
        <pre style={{ background: 'var(--paper)', border: '1px solid var(--rule)', padding: 14, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, lineHeight: 1.55, overflowX: 'auto', color: 'var(--ink)', margin: 0 }}>{snippets[tab]}</pre>
      </Crosshair>
      <div style={{ marginTop: 24 }}>
        <GroupHeader title="install · mcp client" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
          {[
            { cmd: 'npm install -g @standmeet/mcp-client', label: 'npm · universal', size: '482 kB' },
            { cmd: 'standmeet-mcp_1.4.0_darwin.zip', label: 'macOS universal', size: '11.4 MB' },
            { cmd: 'standmeet-mcp_1.4.0_linux-x64.tar.gz', label: 'Linux x64', size: '12.1 MB' },
            { cmd: 'standmeet-mcp_1.4.0_windows.zip', label: 'Windows x64', size: '13.7 MB' },
          ].map(p => (
            <a key={p.label} className="ad-card tight" style={{ textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', cursor: 'pointer' }}>
              <div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink)' }}>{p.cmd}</div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 4 }}>{p.label} · {p.size}</div>
              </div>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--muted)' }}>↓</span>
            </a>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ── obsidian sync ───────────────────────────────────────────── */

function ObsidianSection() {
  const o = OBSIDIAN;
  return (
    <Section kicker="integrations · vault" title="obsidian" action={
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: o.connected ? 'var(--accent)' : 'var(--faint)' }}>
        {o.connected ? '● connected' : '○ off'}
      </span>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <div className="ad-card">
          <SmallCaps>vault</SmallCaps>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: 'var(--ink)', marginTop: 6, letterSpacing: '0.02em' }}>{o.vault_path}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginTop: 18 }}>
            <Stat label="mode" value={o.mode} />
            <Stat label="notes" value={o.total_notes.toLocaleString()} />
            <Stat label="size · mb" value={o.total_size_mb} />
            <Stat label="last sync" value="14m" sub="ago" />
          </div>
          <div style={{ marginTop: 18 }}>
            <SmallCaps>queue</SmallCaps>
            <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}><span style={{ color: o.push_pending > 0 ? 'var(--accent)' : 'var(--ink)' }}>{o.push_pending}</span> push pending</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}><span style={{ color: 'var(--ink)' }}>{o.pull_pending}</span> pull pending</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}><span style={{ color: o.conflicts > 0 ? 'var(--accent)' : 'var(--ink)' }}>{o.conflicts}</span> conflicts</span>
            </div>
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <Btn kind="solid">force sync now</Btn>
            <Btn kind="outline">change vault</Btn>
            <Btn kind="ghost" className="sm-btn-danger">disconnect</Btn>
          </div>
        </div>
        <div className="ad-card">
          <SmallCaps>recent events</SmallCaps>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {o.recent_events.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 80px 1fr', gap: 8, alignItems: 'baseline', paddingBottom: 8, borderBottom: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)' }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{e.t}</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: e.action === 'conflict-resolved' ? 'var(--amber)' : 'var(--accent)' }}>{e.action}</span>
                <span className="reading" style={{ fontSize: 13, color: 'var(--muted)' }}>{e.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── page (public landing content) — port from v1 page editor ── */

function PageSection() {
  return (
    <Section kicker="settings · public face" title="public page" action={
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)' }}>
        edits sync to <a href="index.html" target="_blank" style={{ color: 'var(--muted)', textDecoration: 'none' }}>{window.siteHost ? window.siteHost(window.loadPageContent()) : 'standmeet.com/sijie'} ↗</a>
      </span>
    }>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        The five blocks visitors land on. Hero is the prose paragraph + chat input. Below: insights, projects,
        where you are, how to talk to you. (Editor inputs trimmed in this rebuild — full editor lives in v1; this
        page just exposes the high-level structure & save bar.)
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { id:'hero',     t:'hero',                          d:'serif prose · chat input · 4 example prompts' },
          { id:'insights', t:"things i've been thinking about", d:'theses with one-line context · expandable bodies' },
          { id:'projects', t:"what i'm building",             d:'4 projects · typography only · no screenshots' },
          { id:'where',    t:'where i am',                    d:'location · employment posture · the filter' },
          { id:'contact',  t:'how to talk to me',             d:'chat-line · email · recruiter rules · casual rules' },
          { id:'site',     t:'site · domain',                 d:'standmeet.com/sijie · or custom domain via CNAME' },
          { id:'byoai',    t:'byoai mode',                    d:'visitors-without-codes chat path · public scope only' },
        ].map(b => (
          <div key={b.id} className="ad-card" style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 18, alignItems: 'baseline' }}>
            <SmallCaps>{b.t}</SmallCaps>
            <span className="reading" style={{ fontSize: 14.5, color: 'var(--muted)' }}>{b.d}</span>
            <Btn kind="outline" size="sm">edit ↗</Btn>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── seo ─────────────────────────────────────────────────────── */

function SeoSection() {
  return (
    <Section kicker="settings · search" title="seo" action={<Btn kind="outline">regenerate sitemap</Btn>}>
      <p className="reading" style={{ fontSize: 14.5, color: 'var(--muted)', marginBottom: 24, maxWidth: '54em' }}>
        Defaults applied across the public site. Per-output / per-post SEO overrides live with the individual entry.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24 }}>
        <div className="ad-card">
          <SmallCaps>defaults</SmallCaps>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
            <Field label="site title"><Input defaultValue={SEO.site_title} /></Field>
            <Field label="default description"><Textarea defaultValue={SEO.default_description} rows={2} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="twitter handle"><Input defaultValue={SEO.twitter_handle} /></Field>
              <Field label="canonical host"><Input mono defaultValue={SEO.canonical_host} /></Field>
            </div>
            <Field label="robots">
              <Segmented value={SEO.robots} options={[{value:'index, follow', label:'index'},{value:'noindex', label:'noindex'}]} onChange={()=>{}} />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ad-card">
            <SmallCaps>indexing</SmallCaps>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginTop: 8 }}>
              <Stat label="pages" value={SEO.indexed_pages} />
              <Stat label="outputs" value={SEO.indexed_outputs} />
              <Stat label="posts" value={SEO.indexed_posts} />
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 10, letterSpacing: '0.06em' }}>
              sitemap · {SEO.sitemap_status}<br/>last run · {SEO.last_sitemap_run}
            </div>
          </div>
          <div className="ad-card">
            <SmallCaps>og · default cover</SmallCaps>
            <div style={{
              marginTop: 8, height: 100,
              background: 'linear-gradient(135deg, color-mix(in oklab, var(--amber) 25%, var(--surface)), var(--surface))',
              border: '1px solid var(--rule)', position: 'relative',
            }}>
              <span style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: "'Newsreader',serif", fontSize: 18, color: 'var(--ink)' }}>sijie wang · standmeet</span>
            </div>
            <Btn kind="ghost" size="sm" style={{ marginTop: 8 }}>upload custom og</Btn>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── account ─────────────────────────────────────────────────── */

function AccountSection() {
  return (
    <Section kicker="settings · owner" title="account">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="ad-card">
          <SmallCaps>profile</SmallCaps>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="full name"><Input defaultValue={OWNER_ADMIN.full} /></Field>
            <Field label="email"><Input defaultValue={OWNER_ADMIN.email} /></Field>
            <Field label="handle"><Input mono defaultValue={OWNER_ADMIN.handle} hint="appears in standmeet.com/<handle>" /></Field>
          </div>
        </div>
        <div className="ad-card">
          <SmallCaps>security</SmallCaps>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>Password</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>changed {ACCOUNT.password_last_changed}</div>
              </div>
              <Btn kind="outline" size="sm">change</Btn>
            </div>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>Two-factor</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>{ACCOUNT.two_factor ? '● enabled · TOTP' : '○ off'}</div>
              </div>
              <Btn kind="ghost" size="sm">manage</Btn>
            </div>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>Recovery phrase</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{ACCOUNT.recovery_phrase_set ? 'set · keep it offline' : 'not yet set'}</div>
              </div>
              <Btn kind="outline" size="sm">view</Btn>
            </div>
          </div>
        </div>
        <div className="ad-card">
          <SmallCaps>inference</SmallCaps>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="default provider">
              <Segmented value={ACCOUNT.inference_provider} options={['anthropic','openai','gemini','ollama']} onChange={()=>{}} />
            </Field>
            <Field label="model"><Input mono defaultValue={ACCOUNT.inference_model} /></Field>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>30-day spend</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>your inference key · sijie pays</div>
              </div>
              <span className="mono" style={{ fontSize: 16, color: 'var(--ink)' }}>${ACCOUNT.inference_spend_30d_usd}</span>
            </div>
          </div>
        </div>
        <div className="ad-card">
          <SmallCaps>data · backups</SmallCaps>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>Storage</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{ACCOUNT.storage_used_mb} mb of {ACCOUNT.storage_limit_mb} mb</div>
              </div>
              <Quota used={ACCOUNT.storage_used_mb} max={ACCOUNT.storage_limit_mb} label="" />
            </div>
            <div className="ll-row">
              <div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>Last backup</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{ACCOUNT.last_backup} · {ACCOUNT.backup_location}</div>
              </div>
              <Btn kind="outline" size="sm">backup now</Btn>
            </div>
            <Btn kind="ghost" size="sm" className="sm-btn-danger">export entire corpus ↗</Btn>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── system info ─────────────────────────────────────────────── */

function SystemSection() {
  const sys = SYSTEM;
  return (
    <Section kicker="settings · runtime" title="system" action={<Btn kind="outline">check for updates</Btn>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Crosshair scanline className="ad-card scan">
          <SmallCaps>deployment</SmallCaps>
          <div className="term" style={{ marginTop: 10 }}>
            <div><span className="ok">$</span> standmeet status</div>
            <div><span className="fa">├─</span> version <span className="em">{sys.version}</span> <span className="fa">· commit {sys.commit}</span></div>
            <div><span className="fa">├─</span> built <span className="em">{sys.built}</span></div>
            <div><span className="fa">├─</span> node <span className="em">{sys.node}</span> · platform <span className="em">{sys.platform}</span></div>
            <div><span className="fa">├─</span> uptime <span className="em">{sys.uptime}</span></div>
            <div><span className="fa">└─</span> migrations <span className="em">{sys.pending_migrations} pending</span></div>
            <div style={{ marginTop: 8 }}><span className="ok">$</span> ready<span className="sm-blink">_</span></div>
          </div>
        </Crosshair>
        <div className="ad-card">
          <SmallCaps>resources</SmallCaps>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 10 }}>
            <Stat label="cpu load" value={Math.round(sys.cpu_load * 100) + '%'} sub="1m avg" />
            <Stat label="memory" value={sys.memory_used_mb + ' mb'} sub={'/ ' + sys.memory_total_mb + ' mb'} />
          </div>
        </div>
        <div className="ad-card" style={{ gridColumn: '1 / -1' }}>
          <GroupHeader title="background jobs" />
          <table className="ad-table">
            <thead><tr><th>job</th><th>schedule</th><th>last</th><th>status</th></tr></thead>
            <tbody>
              {sys.background_jobs.map(j => (
                <tr key={j.id}>
                  <td style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{j.name}</td>
                  <td className="num">{j.schedule}</td>
                  <td className="num">{j.last}</td>
                  <td><span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: j.status === 'ok' ? 'var(--accent)' : 'var(--amber)' }}>● {j.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ad-card" style={{ gridColumn: '1 / -1' }}>
          <GroupHeader title="health checks" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
            {sys.health_checks.map(h => (
              <div key={h.name} style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: '1px solid color-mix(in oklab, var(--rule) 60%, transparent)' }}>
                <span className={'status-dot ' + (h.status === 'warn' ? 'warn' : h.status === 'error' ? 'error' : 'live')}></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>{h.name}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{h.detail}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: h.status === 'ok' ? 'var(--accent)' : 'var(--amber)' }}>{h.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── app ─────────────────────────────────────────────────────── */

function App() {
  const [session, setSession] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('standmeet-auth') || 'null'); } catch (e) { return null; }
  });
  const demoMode = !session;
  const signOut = () => { try { localStorage.removeItem('standmeet-auth'); } catch (e) {} setSession(null); };
  const [section, setSection] = React.useState('dashboard');
  const [navOpen, setNavOpen] = React.useState(false);

  const renderSection = () => {
    switch (section) {
      case 'dashboard':     return <DashboardSection onJump={setSection} />;
      case 'raw':           return <RawSection />;
      case 'wiki':          return <WikiSection />;
      case 'writing':       return <WritingSection />;
      case 'outputs':       return <OutputsSection />;
      case 'pages':         return <PagesSection />;
      case 'conversations': return <ConversationsSection />;
      case 'codes':         return <CodesSection />;
      case 'requests':      return <RequestsSection />;
      case 'preview':       return <PreviewSection />;
      case 'sources':       return <SourcesSection />;
      case 'listings':      return <ListingsSection />;
      case 'drafts':        return <DraftsSection />;
      case 'applications':  return <ApplicationsSection />;
      case 'skills':        return <SkillsSection />;
      case 'connectors':    return <ConnectorsSection />;
      case 'api':           return <ApiSection />;
      case 'obsidian':      return <ObsidianSection />;
      case 'page':          return <PageSection />;
      case 'seo':           return <SeoSection />;
      case 'account':       return <AccountSection />;
      case 'system':        return <SystemSection />;
      default:              return <Empty title={'Section "' + section + '" not built yet.'} blurb="Stub — coming in the next pass." />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {demoMode && <DemoBanner />}
      <AdminTopBar session={session || { handle: OWNER_ADMIN.handle, email: 'demo@standmeet.local' }} onSignOut={signOut} onMenu={() => setNavOpen((o) => !o)} />
      <div style={{ display: 'flex', flex: 1 }}>
        {navOpen && <div className="ad-sidebar-backdrop" onClick={() => setNavOpen(false)} />}
        <Sidebar section={section} onChange={setSection} mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
        <main style={{ flex: 1, padding: '32px 48px', overflowX: 'hidden' }}>
          <div style={{ maxWidth: 1200 }}>
            {renderSection()}
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

})();
