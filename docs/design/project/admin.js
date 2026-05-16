/* global React, ReactDOM, OWNER_ADMIN, SOURCES, RAW_ENTRIES, WIKI_ENTRIES,
   WIKI_TAGS, CONVERSATIONS, CODES, CONNECTORS, tagDot */

const { useState, useEffect, useRef, useMemo } = React;

// ─────────────────────────────────────────────────────────────────────────────
// shared atoms

function Pill({ children, tone = 'neutral' }) {
  const cls = tone === 'accent' ? 'pill is-active text-accent border-accent/40' : 'pill';
  return <span className={cls}>{children}</span>;
}

function Chip({ children, tone = 'neutral', active = false, onClick, title }) {
  const cls =
    'chip' +
    (tone === 'private' ? ' is-private' : '') +
    (active ? ' is-active' : '') +
    (onClick ? ' cursor-pointer hover:border-ink' : '');
  return (
    <span className={cls} onClick={onClick} title={title} role={onClick ? 'button' : undefined}>
      {children}
    </span>
  );
}

function SectionHeader({ kicker, title, count, action }) {
  return (
    <div className="flex items-baseline justify-between border-b border-rule pb-4 mb-7">
      <div>
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">{kicker}</div>
        <h1 className="font-serif text-ink" style={{ fontSize: '32px', fontWeight: 400, letterSpacing: '-0.018em', lineHeight: 1 }}>
          {title}
          {count != null && <span className="text-faint mono ml-3" style={{ fontSize: '14px', letterSpacing: '0.1em' }}>· {count}</span>}
        </h1>
      </div>
      {action}
    </div>
  );
}

function Btn({ children, onClick, kind = 'ghost', disabled, type = 'button', size = 'md' }) {
  const base = 'mono uppercase tracking-[0.14em] transition-colors disabled:opacity-40 inline-flex items-center gap-2';
  const sz = size === 'sm' ? 'text-[10.5px] px-2.5 py-1.5' : 'text-[11px] px-3.5 py-2';
  const k = {
    ghost:    'text-muted hover:text-ink',
    outline:  'border border-rule text-ink hover:border-ink',
    solid:    'bg-ink text-paper hover:bg-accent',
    danger:   'text-muted hover:text-accent',
  }[kind];
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${sz} ${k}`}>
      {children}
    </button>
  );
}

function MetaPair({ label, children, className = '' }) {
  return (
    <div className={className}>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">{label}</div>
      <div className="font-serif text-ink" style={{ fontSize: '15px', lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// tech-detail atoms — QR / sparkline / waveform / thumb / ticker / pulse

function QRCode({ value, size = 96, quiet = 2 }) {
  const data = useMemo(() => {
    if (typeof window.qrcode !== 'function') return null;
    try {
      const q = window.qrcode(0, 'M');
      q.addData(value || ' ');
      q.make();
      const n = q.getModuleCount();
      const grid = [];
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
        grid.push(row);
      }
      return { n, grid };
    } catch (e) {
      return null;
    }
  }, [value]);

  if (!data) {
    return (
      <div className="mono text-faint text-[9px] flex items-center justify-center border border-rule" style={{ width: size, height: size }}>
        qr…
      </div>
    );
  }

  const { n, grid } = data;
  const total = n + quiet * 2;
  const cell = size / total;
  const offset = quiet * cell;
  const isFinder = (r, c) => {
    if (r < 7 && c < 7) return true;
    if (r < 7 && c >= n - 7) return true;
    if (r >= n - 7 && c < 7) return true;
    return false;
  };

  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r][c]) continue;
      cells.push({ r, c, finder: isFinder(r, c) });
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" style={{ display: 'block' }}>
      <rect width={size} height={size} fill="var(--paper)" />
      {cells.map(({ r, c, finder }, i) => (
        <rect
          key={i}
          x={offset + c * cell}
          y={offset + r * cell}
          width={cell + 0.4}
          height={cell + 0.4}
          fill={finder ? 'var(--accent)' : 'var(--ink)'}
        />
      ))}
    </svg>
  );
}

function Sparkline({ data, width = 120, height = 28, label }) {
  const max = Math.max(1, ...data);
  const w = width / data.length;
  return (
    <div className="flex items-end gap-px" style={{ width, height }} title={label}>
      {data.map((v, i) => (
        <div
          key={i}
          className="spark-col"
          style={{ height: `${(v / max) * 100}%`, width: `${w - 0.5}px` }}
        />
      ))}
    </div>
  );
}

function AudioWaveform({ wave, played = 0.0, duration }) {
  return (
    <div className="flex items-center gap-4">
      <button className="mono text-[10px] tracking-[0.14em] uppercase text-ink border border-ink px-2.5 py-1.5 hover:bg-ink hover:text-paper transition-colors shrink-0">
        ▶ play
      </button>
      <div className="flex items-end gap-[2px] h-9 flex-1 max-w-[280px]">
        {wave.map((v, i) => (
          <div
            key={i}
            className={`wave-bar ${(i / wave.length) < played ? 'is-played' : ''}`}
            style={{ height: `${Math.max(8, (v / 16) * 100)}%` }}
          />
        ))}
      </div>
      <span className="mono text-[10.5px] tracking-[0.1em] text-muted tabular-nums shrink-0">{duration}</span>
    </div>
  );
}

function MediaThumb({ media }) {
  if (media.kind === 'image') {
    return (
      <div className="thumb">
        <span className="thumb-tag">IMG · {media.dims || ''}</span>
      </div>
    );
  }
  if (media.kind === 'file') {
    return (
      <div className="thumb flex items-center justify-center">
        <span className="mono text-[14px] text-muted">{(media.label || '').split('.').pop().toUpperCase()}</span>
        <span className="thumb-tag">FILE</span>
      </div>
    );
  }
  return null;
}

function FilePill({ media, onRemove }) {
  const icon = media.kind === 'image' ? '⬚' : media.kind === 'audio' ? '◉' : '▤';
  return (
    <span className="pill" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
      <span style={{ fontSize: '11px' }}>{icon}</span>
      <span className="lowercase">{media.label}</span>
      {onRemove && (
        <button onClick={onRemove} className="ml-1 text-muted hover:text-ink" aria-label="remove">×</button>
      )}
    </span>
  );
}

function ActivityTicker({ items }) {
  // double the items so the marquee can loop seamlessly
  const doubled = [...items, ...items];
  const evtColor = (e) => ({
    'ingest':       'text-ink',
    'visitor':      'text-ink',
    'private-hit':  'text-accent',
    'promote':      'text-muted',
    'connector':    'text-muted',
  }[e] || 'text-muted');
  return (
    <div className="ticker-host flex-1 min-w-0 overflow-hidden mx-6">
      <div className="ticker-track">
        {doubled.map((it, i) => (
          <span key={i} className="inline-flex items-baseline gap-2 mono text-[10.5px] tracking-[0.04em] whitespace-nowrap">
            <span className="text-faint tabular-nums">{it.t}</span>
            <span className={`uppercase tracking-[0.14em] text-[9.5px] ${evtColor(it.evt)}`}>{it.evt}</span>
            <span className="text-muted">{it.detail}</span>
            <span className="text-faint">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SystemPulse({ growth, totals }) {
  const total7 = growth.slice(-7).reduce((a, b) => a + b, 0);
  const prev7  = growth.slice(-14, -7).reduce((a, b) => a + b, 0);
  const delta  = total7 - prev7;
  return (
    <aside className="crosshair border border-rule p-4 bg-surface/40 scanline">
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted">corpus pulse · 14d</div>
        <div className="mono text-[10px] tracking-[0.12em] text-faint">live</div>
      </div>
      <div className="flex items-end gap-5">
        <div>
          <div className="font-serif" style={{ fontSize: '34px', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {total7}
          </div>
          <div className="mono text-[10px] tracking-[0.12em] text-muted mt-1">
            entries · last 7d
            <span className={`ml-2 ${delta >= 0 ? 'text-accent' : 'text-faint'}`}>
              {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} vs prev
            </span>
          </div>
        </div>
        <div className="flex-1">
          <Sparkline data={growth} width={220} height={36} label="entries per day" />
          <div className="mono text-[9.5px] tracking-[0.1em] text-faint mt-1 flex justify-between">
            <span>14 days ago</span><span>today</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// chrome — top bar + left nav

const NAV = [
  { id: 'page',          label: 'page',         hint: 'public content' },
  { id: 'raw',           label: 'raw',          hint: 'inbox' },
  { id: 'wiki',          label: 'wiki',         hint: 'curated' },
  { id: 'conversations', label: 'conversations',hint: 'sessions' },
  { id: 'codes',         label: 'codes',        hint: 'access' },
  { id: 'connectors',    label: 'connectors',   hint: 'integrations' },
  { id: 'api',           label: 'api · mcp',    hint: 'tokens' },
  { id: 'preview',       label: 'preview',      hint: 'visitor view' },
];

function DemoBanner() {
  return (
    <div className="px-6 lg:px-8 py-2 bg-surface/70 border-b border-rule flex items-center justify-between gap-3 mono text-[10.5px] tracking-[0.14em] uppercase">
      <div className="flex items-baseline gap-3">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot" />
        <span className="text-accent">demo mode</span>
        <span className="text-faint">·</span>
        <span className="text-muted normal-case tracking-[0.04em]">you're viewing the admin without signing in · changes don't persist beyond this tab</span>
      </div>
      <a href="login.html" className="text-muted hover:text-ink transition-colors shrink-0">sign in / claim instance ↗</a>
    </div>
  );
}

function TopBar({ session, onSignOut }) {
  return (
    <header className="flex items-center px-6 lg:px-8 h-14 border-b border-rule shrink-0 gap-4">
      <div className="flex items-baseline gap-4 mono text-[11px] tracking-[0.14em] uppercase shrink-0">
        <span className="text-ink">standmeet</span>
        <span className="text-faint">/</span>
        <span className="text-muted">admin</span>
        <span className="text-faint">·</span>
        <span className="text-muted">{session?.handle || OWNER_ADMIN.handle}</span>
        <span className="inline-flex items-center gap-1.5 ml-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span>
          <span className="text-faint text-[9.5px] tracking-[0.18em]">live</span>
        </span>
      </div>

      <ActivityTicker items={ACTIVITY} />

      <div className="flex items-center gap-5 shrink-0">
        <span className="mono text-[10.5px] tracking-[0.12em] text-muted">
          <span className="text-ink">{OWNER_ADMIN.corpus_size.toLocaleString()}</span> entries
          <span className="text-faint mx-2">·</span>
          <span className="text-ink">{OWNER_ADMIN.storage_used_mb}</span> mb
        </span>
        <a href="index.html" className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">
          public ↗
        </a>
        <a href="gate.html" className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">
          gate ↗
        </a>
        {session && (
          <div className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em] pl-4 border-l border-rule">
            <span className="text-muted normal-case">{session.email}</span>
            <button
              onClick={onSignOut}
              className="text-faint hover:text-accent uppercase tracking-[0.14em] transition-colors"
            >
              sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Sidebar({ section, onChange }) {
  return (
    <nav className="w-[220px] shrink-0 border-r border-rule py-7 px-5 lg:px-6 flex flex-col">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-3">manage</div>
      <ul className="flex flex-col">
        {NAV.map((n) => {
          const active = section === n.id;
          return (
            <li key={n.id}>
              <button
                onClick={() => onChange(n.id)}
                className={`group w-full text-left flex items-baseline gap-3 py-2 transition-colors ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
              >
                <span className={`mono text-[11px] tracking-[0.06em] tabular-nums shrink-0 w-3 ${active ? 'text-accent' : 'text-faint'}`}>
                  {active ? '›' : ' '}
                </span>
                <span className="font-serif flex-1" style={{ fontSize: '17px', fontWeight: active ? 500 : 400, letterSpacing: '-0.005em' }}>
                  {n.label}
                </span>
                <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-faint">{n.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-6 border-t border-rule mono text-[10px] tracking-[0.12em] text-faint leading-[1.7]">
        <div><span className="text-muted">last ingest</span> {OWNER_ADMIN.last_ingest}</div>
        <div className="mt-1"><span className="text-muted">help</span> · <a className="hover:text-ink" href="#">/docs</a></div>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW · inbox of quick dumps

function RawDumpBox({ onAdd }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('claude');
  const [pendingMedia, setPendingMedia] = useState(null);
  const [drag, setDrag] = useState(false);

  const fileInputRef = useRef(null);

  const acceptFile = (file) => {
    if (!file) return;
    const isImg = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    setPendingMedia({
      kind: isImg ? 'image' : isAudio ? 'audio' : 'file',
      label: file.name,
      dims: isImg ? 'pending' : undefined,
      duration: isAudio ? '0:00' : undefined,
      size_kb: Math.round(file.size / 1024),
      wave: isAudio ? Array.from({length: 26}, () => 4 + Math.floor(Math.random() * 12)) : undefined,
    });
    if (source !== 'upload') setSource('upload');
  };

  const submit = () => {
    if (!text.trim() && !pendingMedia) return;
    onAdd({
      id: 'r-' + Date.now(),
      source, body: text.trim() || '(media only, no caption)',
      time: 'just now',
      media: pendingMedia || undefined,
      tags: [], status: 'unprocessed',
    });
    setText(''); setPendingMedia(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    acceptFile(file);
  };

  return (
    <div
      className={`dropzone bg-surface/60 rounded-sm p-4 mb-8 relative ${drag ? 'is-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      <div className="corners"><span className="c0" /><span className="c1" /><span className="c2" /><span className="c3" /></div>

      <div className="flex items-center justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted flex items-baseline gap-2">
          <span>quick dump</span>
          <span className="text-faint">·</span>
          <span className="text-faint">paste · drag · attach</span>
        </div>
        <div className="seg">
          {SOURCES.map((s) => (
            <button key={s} onClick={() => setSource(s)} className={source === s ? 'is-on' : ''}>{s}</button>
          ))}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a thought, a passage from a chat, a half-formed take. Or drop an image / audio / file onto this panel. Stays raw until you promote it."
        rows={3}
        className="w-full bg-transparent text-ink placeholder:text-faint reading"
        style={{ fontSize: '16px' }}
      />

      {pendingMedia && (
        <div className="mt-3 flex items-center gap-3">
          <FilePill media={pendingMedia} onRemove={() => setPendingMedia(null)} />
          <span className="mono text-[10px] text-faint tracking-[0.1em]">
            {pendingMedia.size_kb ? `${pendingMedia.size_kb} kb` : ''}{pendingMedia.dims ? ` · ${pendingMedia.dims}` : ''}{pendingMedia.duration ? ` · ${pendingMedia.duration}` : ''}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 mono text-[10px] text-faint tracking-[0.12em]">
          <button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            className="text-muted hover:text-ink uppercase tracking-[0.14em]"
          >
            ⌒ attach media
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*,application/pdf,text/*"
            onChange={(e) => acceptFile(e.target.files[0])}
            className="hidden"
          />
          <span>mcp endpoint or paste here · stays unindexed until promoted</span>
        </div>
        <Btn kind="solid" onClick={submit} disabled={!text.trim() && !pendingMedia}>
          dump ↵
        </Btn>
      </div>
    </div>
  );
}

function RawRow({ entry, onPromote, onArchive }) {
  const statusTone = {
    'unprocessed':    { label: 'unprocessed',    cls: 'text-muted' },
    'promoted':       { label: 'promoted',       cls: 'text-faint' },
    'flagged-private':{ label: 'flagged private',cls: 'text-accent' },
    'archived':       { label: 'archived',       cls: 'text-faint' },
  }[entry.status];
  const hasImg   = entry.media && entry.media.kind === 'image';
  const hasAudio = entry.media && entry.media.kind === 'audio';
  const hasFile  = entry.media && entry.media.kind === 'file';
  return (
    <article className="grid grid-cols-[80px_1fr_auto] gap-6 py-5 border-b border-rule/70">
      <div className="mono text-[10px] tracking-[0.14em] uppercase text-muted pt-1 leading-[1.5]">
        <div className="text-ink">{entry.source}</div>
        <div className="text-faint mt-0.5">{entry.time}</div>
      </div>
      <div className="min-w-0">
        <div className={`flex gap-4 ${hasImg ? 'items-start' : 'items-baseline'}`}>
          {hasImg && <MediaThumb media={entry.media} />}
          <div className="flex-1 min-w-0">
            <p className="reading text-ink" style={{ fontSize: '15.5px' }}>{entry.body}</p>
            {hasAudio && (
              <div className="mt-3">
                <AudioWaveform wave={entry.media.wave} played={0.0} duration={entry.media.duration} />
                <div className="mono text-[10px] tracking-[0.1em] text-faint mt-1.5">
                  {entry.media.label} · transcribing…
                </div>
              </div>
            )}
            {hasImg && (
              <div className="mono text-[10px] tracking-[0.1em] text-faint mt-2">
                {entry.media.label} · {entry.media.dims} · {entry.media.size_kb} kb
              </div>
            )}
            {hasFile && (
              <div className="mt-2">
                <FilePill media={entry.media} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
              {entry.tags.map((t) => <Chip key={t} tone={tagDot(t) === 'private' ? 'private' : 'neutral'}>{t}</Chip>)}
              <span className={`mono text-[10px] tracking-[0.14em] uppercase ml-1 ${statusTone.cls}`}>· {statusTone.label}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {entry.status === 'unprocessed' && (
          <>
            <Btn size="sm" kind="outline" onClick={() => onPromote(entry.id)}>promote ↗</Btn>
            <Btn size="sm" kind="ghost" onClick={() => onArchive(entry.id)}>archive</Btn>
          </>
        )}
        {entry.status === 'flagged-private' && (
          <>
            <Btn size="sm" kind="outline" onClick={() => onPromote(entry.id)}>promote private ↗</Btn>
            <Btn size="sm" kind="ghost" onClick={() => onArchive(entry.id)}>archive</Btn>
          </>
        )}
        {entry.status === 'promoted' && <span className="mono text-[10px] text-faint">in wiki</span>}
        {entry.status === 'archived'  && <span className="mono text-[10px] text-faint">archived</span>}
      </div>
    </article>
  );
}

function RawSection({ entries, setEntries }) {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => ({
    all: entries.length,
    unprocessed: entries.filter((e) => e.status === 'unprocessed').length,
    'flagged-private': entries.filter((e) => e.status === 'flagged-private').length,
    promoted: entries.filter((e) => e.status === 'promoted').length,
    archived: entries.filter((e) => e.status === 'archived').length,
  }), [entries]);
  const list = filter === 'all' ? entries : entries.filter((e) => e.status === filter);

  return (
    <div>
      <SectionHeader
        kicker="surface 1 · inbox"
        title="raw"
        count={counts.unprocessed + ' unprocessed'}
        action={
          <div className="flex items-center gap-1.5">
            {['all','unprocessed','flagged-private','promoted','archived'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`mono text-[10.5px] tracking-[0.12em] uppercase px-2 py-1 transition-colors ${filter===f?'text-ink border-b border-accent':'text-muted hover:text-ink'}`}
              >
                {f.replace('-', ' ')} <span className="text-faint ml-1 tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
        }
      />
      <SystemPulse growth={GROWTH_14D} />
      <div className="mt-8" />
      <RawDumpBox onAdd={(e) => setEntries((cur) => [e, ...cur])} />
      <div>
        {list.map((e) => (
          <RawRow
            key={e.id}
            entry={e}
            onPromote={(id) => setEntries((cur) => cur.map((x) => x.id === id ? { ...x, status: 'promoted' } : x))}
            onArchive={(id) => setEntries((cur) => cur.map((x) => x.id === id ? { ...x, status: 'archived' } : x))}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIKI · curated, retrievable corpus

function VisibilityBadge({ v }) {
  const m = {
    public:     { label: 'public',     cls: 'text-muted' },
    'on-request':{ label: 'on-request', cls: 'text-accent' },
    private:    { label: 'private',    cls: 'text-accent' },
  }[v] || { label: v, cls: 'text-muted' };
  return <span className={`mono text-[10px] tracking-[0.16em] uppercase ${m.cls}`}>● {m.label}</span>;
}

function WikiSection() {
  const [activeTag, setActiveTag] = useState(null);
  const list = activeTag ? WIKI_ENTRIES.filter((e) => e.tags.includes(activeTag)) : WIKI_ENTRIES;
  return (
    <div>
      <SectionHeader
        kicker="surface 1 · curated"
        title="wiki"
        count={WIKI_ENTRIES.length + ' entries'}
        action={<Btn kind="outline">＋ new entry</Btn>}
      />

      <div className="flex flex-wrap gap-1.5 mb-7">
        <Chip active={!activeTag} onClick={() => setActiveTag(null)}>all</Chip>
        {WIKI_TAGS.map((t) => (
          <Chip
            key={t}
            active={activeTag === t}
            tone={tagDot(t) === 'private' ? 'private' : 'neutral'}
            onClick={() => setActiveTag(activeTag === t ? null : t)}
          >
            {t}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-10 gap-y-8">
        {list.map((e) => (
          <article key={e.id} className="border-t border-rule pt-5">
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <h3 className="font-serif text-ink flex-1" style={{ fontSize: '20px', fontWeight: 400, letterSpacing: '-0.005em', lineHeight: 1.3 }}>
                {e.title}
              </h3>
              <VisibilityBadge v={e.visibility} />
            </div>
            <p className="reading text-muted mb-3" style={{ fontSize: '15px' }}>{e.excerpt}</p>
            <div className="flex items-baseline justify-between">
              <div className="flex flex-wrap gap-1.5">
                {e.tags.map((t) => <Chip key={t} tone={tagDot(t) === 'private' ? 'private' : 'neutral'}>{t}</Chip>)}
              </div>
              <div className="mono text-[10px] tracking-[0.12em] text-faint shrink-0">
                {e.sources} sources · {e.last_edited}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATIONS · sessions list with click-to-expand transcript

function ToolCallBlock({ tool, result }) {
  if (!result) return null;
  if (result.kind === 'calendar') {
    return (
      <div className="border border-rule bg-paper/60 mt-2 mb-1 rounded-sm">
        <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-rule/70">
          <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-accent">⌖ tool · {tool}</span>
          <span className="mono text-[9.5px] tracking-[0.1em] text-faint">openai connector</span>
        </div>
        <div className="px-3 py-2 grid grid-cols-1 gap-1">
          {result.slots.map((s, i) => (
            <div key={i} className="grid grid-cols-[120px_1fr_auto] gap-3 items-baseline py-1 border-b border-rule/40 last:border-0">
              <span className="mono text-[11px] tracking-[0.04em] text-ink">{s.day}</span>
              <span className="mono text-[11px] tracking-[0.04em] text-muted">{s.time}</span>
              <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-faint">offered</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (result.kind === 'booking') {
    return (
      <div className="border border-accent/50 bg-paper/60 mt-2 mb-1 rounded-sm">
        <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-accent/40">
          <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-accent">✓ booked · {tool}</span>
          <a href="#" className="mono text-[9.5px] tracking-[0.1em] text-muted hover:text-ink">{result.ics} ↓</a>
        </div>
      </div>
    );
  }
  if (result.kind === 'image') {
    return (
      <div className="mt-2 mb-1 flex items-start gap-3">
        <MediaThumb media={{ kind: 'image', dims: result.dims }} />
        <div className="mono text-[10px] tracking-[0.1em] text-faint pt-1">
          <div className="text-muted">{tool}</div>
          <div>{result.caption}</div>
        </div>
      </div>
    );
  }
  return null;
}

function ConvRow({ c, open, onToggle }) {
  return (
    <div className="border-b border-rule/70">
      <button onClick={onToggle} className="w-full grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 items-baseline py-4 text-left hover:bg-surface/40 transition-colors px-1">
        <div>
          <div className="font-serif text-ink" style={{ fontSize: '16px', fontWeight: 400 }}>{c.visitor}</div>
          <div className="mono text-[10px] tracking-[0.12em] text-faint mt-0.5">{c.last}</div>
        </div>
        <div className="mono text-[11px] tracking-[0.08em] text-muted">
          via <span className="text-ink">{c.code_label}</span>
          <span className="text-faint mx-1.5">·</span>
          <span className="text-faint">{c.code}</span>
        </div>
        <div className="mono text-[11px] tabular-nums text-muted">{c.turns} turns</div>
        {c.private_hits > 0
          ? <span className="mono text-[10px] tracking-[0.14em] uppercase text-accent">{c.private_hits} private hit{c.private_hits>1?'s':''}</span>
          : <span className="mono text-[10px] tracking-[0.14em] uppercase text-faint">—</span>}
        <span className={`mono text-[12px] text-muted transition-transform ${open ? 'rotate-90 text-accent' : ''}`}>→</span>
      </button>
      {open && c.transcript && (
        <div className="px-1 pt-3 pb-8 bg-surface/30 fadein">
          {c.transcript.map((t, i) => (
            <div key={i} className="grid grid-cols-[100px_1fr] gap-5 py-2.5 border-b border-rule/40 last:border-0">
              <div className={`mono text-[10px] tracking-[0.16em] uppercase ${t.who === 'ai' ? 'text-accent' : 'text-ink'}`}>
                {t.who === 'ai' ? "sijie's ai" : 'visitor'}
                {t.tool && <div className="text-faint normal-case tracking-[0.04em] text-[9.5px] mt-1">tool call</div>}
              </div>
              <div>
                <div className={`reading ${t.who === 'ai' ? 'text-ink' : 'text-ink font-serif italic'} ${t.flagged ? 'text-accent' : ''}`} style={{ fontSize: '15.5px' }}>
                  {t.text}
                </div>
                {t.tool && <ToolCallBlock tool={t.tool} result={t.result} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && !c.transcript && (
        <div className="px-1 py-6 bg-surface/30 fadein mono text-[11px] text-muted">
          full transcript loaded on click · placeholder for prototype
        </div>
      )}
    </div>
  );
}

function ConversationsSection() {
  const [openId, setOpenId] = useState('c-44');
  return (
    <div>
      <SectionHeader
        kicker="surface 1 · sessions"
        title="conversations"
        count={CONVERSATIONS.length + ' sessions'}
        action={
          <div className="flex items-center gap-4">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-muted">
              <span className="text-accent">●</span> {CONVERSATIONS.filter(c=>c.private_hits>0).length} sessions hit private topics
            </span>
            <Btn kind="ghost">export csv ↓</Btn>
          </div>
        }
      />
      <div className="grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 mono text-[10px] tracking-[0.18em] uppercase text-muted pb-3 px-1 border-b border-rule">
        <span>visitor</span><span>via code</span><span>turns</span><span>flags</span><span></span>
      </div>
      <div>
        {CONVERSATIONS.map((c) => (
          <ConvRow key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CODES · access codes (each code may have multiple members)

function useShareHost() {
  const [host, setHost] = useState(() => window.siteHost ? window.siteHost(window.loadPageContent()) : ('standmeet.com/' + OWNER_ADMIN.handle));
  useEffect(() => {
    const refresh = () => setHost(window.siteHost ? window.siteHost(window.loadPageContent()) : ('standmeet.com/' + OWNER_ADMIN.handle));
    const onStorage = (e) => { if (!e.key || e.key === 'standmeet-page-content') refresh(); };
    const onCustom = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('standmeet-page-saved', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('standmeet-page-saved', onCustom);
    };
  }, []);
  return host;
}

function CodeCard({ code, onEdit, onPreview, onShowQR }) {
  const visibleMembers = code.members.slice(0, 4);
  const host = useShareHost();
  const link = `${host}?c=${code.code}`;
  const fullLink = 'https://' + link;
  return (
    <article className="crosshair border border-rule bg-surface/30 p-5 rounded-sm">
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="flex items-baseline gap-3">
            <h3 className="font-serif text-ink" style={{ fontSize: '20px', fontWeight: 500, letterSpacing: '-0.01em' }}>{code.label}</h3>
            {code.status === 'expired'
              ? <span className="mono text-[10px] tracking-[0.16em] uppercase text-faint">expired</span>
              : <span className="mono text-[10px] tracking-[0.16em] uppercase text-accent">● active</span>}
          </div>
          <div className="mono text-[11px] tracking-[0.04em] text-muted mt-1">
            <span className="text-ink">{code.code}</span>
            <span className="text-faint mx-2">·</span>
            <span>{code.purpose}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Btn size="sm" kind="ghost" onClick={() => onPreview(code)}>preview ↗</Btn>
          <Btn size="sm" kind="outline" onClick={() => onEdit(code)}>edit</Btn>
        </div>
      </div>

      <div className="flex gap-6 mt-5 flex-wrap lg:flex-nowrap">
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <MetaPair label="members">
              <div className="flex flex-col gap-1">
                {visibleMembers.map((m, i) => (
                  <div key={i} className="flex items-baseline gap-3 flex-wrap">
                    <span className={`${m.anon ? 'italic text-muted' : ''} flex-1 min-w-0 truncate`} style={{ fontSize: '14.5px' }}>{m.name}</span>
                    <span className="mono text-[10px] text-faint tracking-[0.1em] shrink-0">{m.last}</span>
                  </div>
                ))}
                {code.members.length === 0 && <span className="text-muted" style={{ fontSize: '14.5px' }}>no one has used this yet</span>}
              </div>
            </MetaPair>
          </div>
          <div>
            <MetaPair label="access scope">
              <div className="flex flex-wrap gap-1.5">
                {code.scope.map((t) => <Chip key={t}>{t}</Chip>)}
                {code.excluded.map((t) => <Chip key={t} tone="private" title="excluded">× {t}</Chip>)}
              </div>
            </MetaPair>
            <MetaPair label="suggested questions" className="mt-4">
              <ul className="space-y-1" style={{ fontSize: '14.5px' }}>
                {code.suggested.slice(0, 3).map((q, i) => (
                  <li key={i} className="font-serif italic text-muted">"{q}"</li>
                ))}
                {code.suggested.length > 3 && (
                  <li className="mono text-[10px] tracking-[0.12em] text-faint">+ {code.suggested.length - 3} more</li>
                )}
              </ul>
            </MetaPair>
          </div>
        </div>

        {/* QR card */}
        <button
          onClick={() => onShowQR(code)}
          className="shrink-0 group flex flex-col items-center gap-2 p-2.5 border border-rule rounded-sm hover:border-ink transition-colors self-start"
          title="show large QR + share"
        >
          <QRCode value={fullLink} size={88} />
          <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-muted group-hover:text-ink">
            scan / share ↗
          </span>
        </button>
      </div>

      <div className="mt-5 pt-3 border-t border-rule/60 mono text-[10px] tracking-[0.12em] text-faint flex items-baseline justify-between">
        <span>{code.uses} uses · expires {code.expires}</span>
        <span>{link}</span>
      </div>
    </article>
  );
}

function CodesSection({ codes, setCodes, openCreate, openPreview, openQR }) {
  return (
    <div>
      <SectionHeader
        kicker="surface 1 · access"
        title="codes"
        count={codes.length + ' codes'}
        action={
          <div className="flex items-center gap-3">
            <span className="mono text-[10.5px] tracking-[0.12em] text-muted">
              {codes.reduce((a,c)=>a+c.members.length,0)} reviewers across {codes.filter(c=>c.status==='active').length} active codes
            </span>
            <Btn kind="solid" onClick={openCreate}>＋ new code</Btn>
          </div>
        }
      />

      <div className="reading text-muted mb-6" style={{ fontSize: '15px', maxWidth: '54em' }}>
        Each code gates a slice of your wiki for a known recipient — typically a hiring loop, an investor intro,
        or a single press call. Multiple people can share one code (e.g. an interview panel); when someone enters
        a code, the AI asks who they are and assigns them to the code's member list. Every code carries its own
        QR — click the QR on any card to enlarge and share.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {codes.map((c) => (
          <CodeCard key={c.id} code={c} onEdit={() => openCreate(c)} onPreview={openPreview} onShowQR={openQR} />
        ))}
      </div>
    </div>
  );
}

// ─── code create / edit modal ──────────────────────────────────────────────

function CodeCreateModal({ initial, onClose, onSave }) {
  const [label, setLabel] = useState(initial?.label || '');
  const [purpose, setPurpose] = useState(initial?.purpose || '');
  const host = useShareHost();
  const [scope, setScope] = useState(new Set(initial?.scope || ['thinking','work','lucerna']));
  const [excluded, setExcluded] = useState(new Set(initial?.excluded || ['private','fundraising']));
  const [suggested, setSuggested] = useState(initial?.suggested || [
    'Walk me through your background.',
    'What is Lucerna?',
  ]);
  const [members, setMembers] = useState(initial?.members?.map((m)=>m.name) || []);
  const [newMember, setNewMember] = useState('');
  const [expires, setExpires] = useState('30 days');

  const toggleTag = (setT, t) => setT((prev) => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const setExc = (t) => {
    // moving a tag to excluded should remove from scope
    setScope((prev) => { const n = new Set(prev); n.delete(t); return n; });
    toggleTag(setExcluded, t);
  };
  const setInc = (t) => {
    setExcluded((prev) => { const n = new Set(prev); n.delete(t); return n; });
    toggleTag(setScope, t);
  };

  const updateQ = (i, v) => setSuggested((s) => s.map((x, j) => j === i ? v : x));
  const addQ = () => setSuggested((s) => [...s, '']);
  const removeQ = (i) => setSuggested((s) => s.filter((_, j) => j !== i));

  const save = () => {
    const code = initial?.code || (label.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4).padEnd(4,'X') + '-' + Math.random().toString(36).slice(2,5).toUpperCase());
    onSave({
      id: initial?.id || ('k-' + Date.now()),
      code, label: label || 'untitled code', purpose,
      members: members.map((n) => ({ name: n, last: 'never' })),
      scope: [...scope], excluded: [...excluded],
      suggested: suggested.filter(Boolean),
      status: 'active', expires: 'in ' + expires, uses: initial?.uses || 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 fadein overflow-y-auto py-10" onClick={onClose}>
      <div className="bg-paper border border-rule rounded-sm w-full max-w-[760px] mx-4 my-auto rise" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-baseline justify-between px-7 py-5 border-b border-rule">
          <div>
            <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-1">{initial ? 'edit code' : 'new code'}</div>
            <div className="font-serif text-ink" style={{ fontSize: '22px', fontWeight: 400 }}>
              {initial ? initial.label : 'gate a slice of your wiki'}
            </div>
          </div>
          <button onClick={onClose} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink">close ✕</button>
        </div>

        <div className="px-7 py-6 space-y-7 max-h-[70vh] overflow-y-auto scroll-thin">
          {/* label + purpose */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">label</div>
              <input
                type="text" value={label} onChange={(e)=>setLabel(e.target.value)}
                placeholder="e.g. OpenAI eng loop"
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                style={{ fontSize: '16px' }}
              />
            </div>
            <div>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">purpose (private to you)</div>
              <input
                type="text" value={purpose} onChange={(e)=>setPurpose(e.target.value)}
                placeholder="e.g. staff eng interview screening"
                className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
                style={{ fontSize: '16px' }}
              />
            </div>
          </div>

          {/* scope */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">access scope</div>
              <div className="mono text-[10px] tracking-[0.12em] text-faint">
                <span className="text-ink">{scope.size}</span> included · <span className="text-accent">{excluded.size}</span> excluded
              </div>
            </div>
            <p className="reading text-muted mb-3" style={{ fontSize: '14px' }}>
              click a tag to include · click again to exclude · everything else is silent (AI says "not in corpus")
            </p>
            <div className="flex flex-wrap gap-1.5">
              {WIKI_TAGS.map((t) => {
                const inc = scope.has(t);
                const exc = excluded.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => inc ? setExc(t) : setInc(t)}
                    className={`chip transition-colors ${inc ? 'is-active' : exc ? 'is-private' : ''}`}
                    title={inc ? 'click to exclude' : exc ? 'click to include' : 'click to include'}
                  >
                    {inc ? '✓ ' : exc ? '× ' : ''}{t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* suggested questions */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">suggested questions</div>
              <button onClick={addQ} className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink">＋ add</button>
            </div>
            <p className="reading text-muted mb-3" style={{ fontSize: '14px' }}>
              shown to the visitor as starter prompts on their chat. these set the conversation's tone.
            </p>
            <div className="space-y-2">
              {suggested.map((q, i) => (
                <div key={i} className="flex items-baseline gap-3 border-b border-rule/60">
                  <span className="mono text-[10px] text-faint tabular-nums shrink-0 w-5 pt-1">{String(i+1).padStart(2,'0')}</span>
                  <input
                    type="text" value={q} onChange={(e)=>updateQ(i, e.target.value)}
                    placeholder="a question the visitor might ask"
                    className="flex-1 bg-transparent py-2 reading italic text-ink placeholder:text-faint"
                    style={{ fontSize: '15.5px' }}
                  />
                  <button onClick={()=>removeQ(i)} className="mono text-[10px] text-faint hover:text-accent shrink-0 pt-1">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* expected members */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">expected reviewers (optional)</div>
              <span className="mono text-[10px] tracking-[0.12em] text-faint">if known · they'll be offered as identity options</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {members.map((m, i) => (
                <span key={i} className="chip is-active">
                  {m}
                  <button onClick={()=>setMembers((mm)=>mm.filter((_,j)=>j!==i))} className="ml-1 text-paper/60 hover:text-paper">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-baseline gap-3 border-b border-rule">
              <input
                type="text" value={newMember} onChange={(e)=>setNewMember(e.target.value)}
                onKeyDown={(e)=>{ if (e.key==='Enter' && newMember.trim()) { setMembers((m)=>[...m,newMember.trim()]); setNewMember(''); } }}
                placeholder="e.g. David Chen · then press enter"
                className="flex-1 bg-transparent py-2 reading text-ink placeholder:text-faint"
                style={{ fontSize: '15px' }}
              />
              <button
                onClick={()=>{ if (newMember.trim()) { setMembers((m)=>[...m,newMember.trim()]); setNewMember(''); } }}
                className="mono text-[10px] tracking-[0.14em] uppercase text-muted hover:text-ink shrink-0"
              >add ↵</button>
            </div>
            <p className="reading text-faint mt-2" style={{ fontSize: '13px' }}>
              when someone enters this code, the AI asks "are you one of these people, or someone new?" — they
              pick or type their name. anyone not on this list gets logged as a new member.
            </p>
          </div>

          {/* expires */}
          <div>
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">expires in</div>
            <div className="seg">
              {['7 days','30 days','90 days','never'].map((e) => (
                <button key={e} onClick={()=>setExpires(e)} className={expires === e ? 'is-on' : ''}>{e}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-7 py-4 border-t border-rule bg-surface/40 gap-5">
          <div className="flex items-center gap-3 min-w-0">
            <QRCode value={'https://' + host + '?c=' + (initial?.code || ((label.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4) || 'XXXX').padEnd(4,'X') + '-•••'))} size={48} />
            <div className="mono text-[10px] tracking-[0.12em] text-faint min-w-0 truncate">
              <div className="text-muted">share link</div>
              <div className="truncate">{host}?c={initial?.code || <span className="text-muted">{(label.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4) || 'XXXX').padEnd(4,'X')}-•••</span>}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Btn kind="ghost" onClick={onClose}>cancel</Btn>
            <Btn kind="solid" onClick={save} disabled={!label.trim()}>
              {initial ? 'save changes' : 'create code & copy link'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── code QR modal — big QR + copy/print actions ───────────────────────────

function CodeQRModal({ code, onClose }) {
  const host = useShareHost();
  const link = `${host}?c=${code.code}`;
  const fullLink = 'https://' + link;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 fadein" onClick={onClose}>
      <div className="bg-paper border border-rule rounded-sm w-full max-w-[540px] mx-4 rise crosshair" onClick={(e)=>e.stopPropagation()}>
        <span className="ch-tl" /><span className="ch-br" />
        <div className="flex items-baseline justify-between px-7 py-5 border-b border-rule">
          <div>
            <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted mb-1">scan / share</div>
            <div className="font-serif text-ink" style={{ fontSize: '22px', fontWeight: 400 }}>
              {code.label}
            </div>
          </div>
          <button onClick={onClose} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink">close ✕</button>
        </div>

        <div className="px-7 py-8 flex flex-col items-center">
          <div className="p-4 border border-rule bg-paper">
            <QRCode value={fullLink} size={260} />
          </div>
          <div className="mono text-[11px] tracking-[0.04em] text-muted mt-5 text-center">
            <div className="text-ink">{code.code}</div>
            <div className="mt-1 text-faint">{link}</div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <Btn kind="outline" onClick={copy}>{copied ? 'copied ✓' : 'copy link'}</Btn>
            <Btn kind="outline" onClick={() => window.print()}>print qr ↗</Btn>
            <Btn kind="ghost" onClick={() => {
              const svg = document.querySelector('.print-target');
            }}>email to members</Btn>
          </div>

          <div className="mt-7 pt-5 border-t border-rule w-full mono text-[10px] tracking-[0.12em] text-faint leading-[1.7] text-center">
            scoped to: <span className="text-muted">{code.scope.join(' · ')}</span>
            {code.excluded.length > 0 && <><br/>excluded: <span className="text-accent">{code.excluded.join(' · ')}</span></>}
            <br/>
            <span className="text-faint">expires {code.expires} · {code.uses} uses</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── visitor identity modal preview (what the visitor sees on entering code) ─

function VisitorPreviewModal({ code, onClose }) {
  const host = useShareHost();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 fadein" onClick={onClose}>
      <div className="bg-paper border border-rule rounded-sm w-full max-w-[680px] mx-4 rise" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-baseline justify-between px-7 py-5 border-b border-rule">
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted">
            visitor preview · code <span className="text-ink">{code.code}</span>
          </div>
          <button onClick={onClose} className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink">close ✕</button>
        </div>
        <div className="px-7 py-8">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-3">
            sijie's ai · ready
          </div>
          <p className="reading text-ink" style={{ fontSize: '17px' }}>
            Welcome. You've come in on <span className="text-accent">{code.label}</span>. Before we start —
            is this you, or someone new?
          </p>

          <div className="mt-6">
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">expected on this code</div>
            <div className="grid grid-cols-1 gap-1.5">
              {code.members.filter((m)=>!m.anon).map((m, i) => (
                <button key={i} className="flex items-baseline justify-between text-left px-4 py-3 border border-rule hover:border-ink transition-colors rounded-sm">
                  <span className="font-serif text-ink" style={{ fontSize: '16px' }}>I'm <span className="font-medium">{m.name}</span></span>
                  <span className="mono text-[10px] tracking-[0.12em] text-faint">last seen {m.last}</span>
                </button>
              ))}
              {code.members.filter((m)=>!m.anon).length === 0 && (
                <div className="mono text-[11px] text-faint border border-dashed border-rule px-4 py-3 rounded-sm">
                  no expected reviewers configured · everyone enters as new
                </div>
              )}
            </div>
          </div>

          <div className="mt-6">
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">or — someone new</div>
            <div className="flex items-baseline gap-3 border border-rule rounded-sm px-4 py-3">
              <span className="text-accent font-serif" style={{ fontSize: '20px', lineHeight: 1 }}>›</span>
              <input
                type="text" placeholder="your name (used only to label the session for sijie)"
                className="flex-1 bg-transparent reading text-ink placeholder:text-faint"
                style={{ fontSize: '16px' }}
              />
              <button className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-accent">
                start ↵
              </button>
            </div>
          </div>

          <div className="mt-7 pt-4 border-t border-rule/70">
            <div className="grid grid-cols-[1fr_auto] gap-5 items-center">
              <div className="mono text-[10px] tracking-[0.12em] text-faint leading-[1.7]">
                this code gives access to: <span className="text-muted">{code.scope.join(' · ')}</span>
                {code.excluded.length > 0 && <><br/>excluded: <span className="text-accent">{code.excluded.join(' · ')}</span></>}
                <br/>
                <span className="text-faint">code · {code.code}</span>
              </div>
              <div className="shrink-0 p-1.5 border border-rule">
                <QRCode value={'https://' + host + '?c=' + code.code} size={72} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTORS

function ConnectorTile({ c, onToggle }) {
  return (
    <article className="border border-rule p-5 rounded-sm bg-surface/30 flex flex-col">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-serif text-ink" style={{ fontSize: '19px', fontWeight: 500 }}>{c.name}</h3>
        {c.connected
          ? <span className="mono text-[10px] tracking-[0.16em] uppercase text-accent">● connected</span>
          : <span className="mono text-[10px] tracking-[0.16em] uppercase text-faint">○ disconnected</span>}
      </div>
      <p className="reading text-muted mb-4" style={{ fontSize: '14.5px' }}>{c.note}</p>
      <div className="mt-auto pt-3 border-t border-rule/60 flex items-baseline justify-between">
        <div className="mono text-[10.5px] tracking-[0.06em] text-muted">
          {c.account || <span className="text-faint">no account linked</span>}
          {c.last_event && <><br/><span className="text-faint">{c.last_event}</span></>}
        </div>
        <Btn size="sm" kind={c.connected ? 'ghost' : 'outline'} onClick={() => onToggle(c.id)}>
          {c.connected ? 'manage' : 'connect ↗'}
        </Btn>
      </div>
    </article>
  );
}

function ConnectorsSection() {
  const [conns, setConns] = useState(CONNECTORS);
  return (
    <div>
      <SectionHeader
        kicker="surface 1 · integrations"
        title="connectors"
        count={conns.filter((c)=>c.connected).length + ' of ' + conns.length + ' connected'}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {conns.map((c) => (
          <ConnectorTile
            key={c.id}
            c={c}
            onToggle={(id) => setConns((cur) => cur.map((x) => x.id === id ? { ...x, connected: !x.connected } : x))}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW · pointer back to the public surface

function PreviewSection({ openPreview, codes }) {
  return (
    <div>
      <SectionHeader
        kicker="surface 1 · external view"
        title="preview as visitor"
        action={<a href="index.html" className="mono text-[11px] tracking-[0.14em] uppercase text-muted hover:text-ink">open public page ↗</a>}
      />
      <p className="reading text-muted mb-7" style={{ fontSize: '16px', maxWidth: '54em' }}>
        Click a code below to see what someone using that code lands on — the identity prompt,
        the scope hint, and the chat with their tailored suggested questions.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {codes.filter((c)=>c.status==='active').map((c) => (
          <button key={c.id} onClick={()=>openPreview(c)} className="border border-rule p-5 text-left rounded-sm bg-surface/30 hover:border-ink transition-colors">
            <div className="flex items-baseline justify-between">
              <span className="font-serif text-ink" style={{ fontSize: '18px', fontWeight: 500 }}>{c.label}</span>
              <span className="mono text-[10px] tracking-[0.14em] uppercase text-muted">preview ↗</span>
            </div>
            <div className="mono text-[10.5px] tracking-[0.04em] text-faint mt-1">{c.code}</div>
            <div className="reading text-muted mt-2" style={{ fontSize: '14px' }}>{c.purpose}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// API · MCP — tokens + MCP client setup

const TOKEN_SCOPES = [
  { id: 'read',     label: 'read',     blurb: 'retrieve from wiki/raw' },
  { id: 'write',    label: 'write',    blurb: 'add new raw entries' },
  { id: 'promote',  label: 'promote',  blurb: 'move raw → wiki' },
  { id: 'codes',    label: 'codes',    blurb: 'manage access codes' },
];

const DEFAULT_TOKENS = [
  {
    id: 't-1', name: 'Claude Desktop', secret: 'sm_live_5kJ7d3v9aQR2cXBfYpMwH8tNL4uVe',
    scopes: ['read', 'write', 'promote'],
    created: '4 days ago', last_used: '2 hours ago', uses_30d: 412,
  },
  {
    id: 't-2', name: 'cursor agent', secret: 'sm_live_xK9pQwRtY8mV3jBnAsLcEhUf2dN6o',
    scopes: ['read', 'write'],
    created: '11 days ago', last_used: '3 days ago', uses_30d: 87,
  },
  {
    id: 't-3', name: 'voice memo script', secret: 'sm_live_aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT',
    scopes: ['write'],
    created: '2 weeks ago', last_used: '6 hours ago', uses_30d: 23,
  },
];

const MCP_CLIENTS = [
  {
    id: 'claude-desktop', label: 'Claude Desktop',
    path: '~/Library/Application Support/Claude/claude_desktop_config.json',
    snippet: (key) => `{
  "mcpServers": {
    "standmeet": {
      "command": "npx",
      "args": ["-y", "@standmeet/mcp-client@latest"],
      "env": {
        "STANDMEET_HOST": "{HOST}",
        "STANDMEET_API_KEY": "${key}"
      }
    }
  }
}`,
  },
  {
    id: 'cursor', label: 'Cursor',
    path: '~/.cursor/mcp.json',
    snippet: (key) => `{
  "standmeet": {
    "command": "npx",
    "args": ["-y", "@standmeet/mcp-client@latest"],
    "env": {
      "STANDMEET_HOST": "{HOST}",
      "STANDMEET_API_KEY": "${key}"
    }
  }
}`,
  },
  {
    id: 'openai-codex', label: 'OpenAI / Codex CLI',
    path: '~/.codex/mcp_servers.toml',
    snippet: (key) => `[mcp.standmeet]
command = "npx"
args    = ["-y", "@standmeet/mcp-client@latest"]
[mcp.standmeet.env]
STANDMEET_HOST    = "{HOST}"
STANDMEET_API_KEY = "${key}"`,
  },
  {
    id: 'http', label: 'Raw HTTP',
    path: 'POST {HOST}/api/v1/raw',
    snippet: (key) => `curl -X POST {HOST}/api/v1/raw \\
  -H "authorization: Bearer ${key}" \\
  -H "content-type: application/json" \\
  -d '{
    "source": "claude",
    "body":   "the thought you want to remember",
    "tags":   ["thinking"]
  }'`,
  },
];

function maskSecret(s) {
  if (!s) return '';
  return s.slice(0, 8) + '…' + s.slice(-4);
}

function CopyButton({ getText, label = 'copy', className = '' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        const t = typeof getText === 'function' ? getText() : getText;
        if (navigator.clipboard) navigator.clipboard.writeText(t);
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      }}
      className={`mono text-[10.5px] tracking-[0.14em] uppercase transition-colors ${copied ? 'text-accent' : 'text-muted hover:text-ink'} ${className}`}
    >
      {copied ? 'copied ✓' : label}
    </button>
  );
}

function TokenRow({ tok, onRevoke, justCreated }) {
  const [reveal, setReveal] = useState(!!justCreated);
  return (
    <article className={`border ${justCreated ? 'border-accent' : 'border-rule'} rounded-sm p-4 bg-surface/40 mb-3`}>
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-2">
        <div>
          <div className="font-serif text-ink" style={{ fontSize: '17px', fontWeight: 500, letterSpacing: '-0.005em' }}>
            {tok.name}
          </div>
          <div className="mono text-[10.5px] tracking-[0.06em] text-faint mt-0.5">
            created {tok.created} · last used {tok.last_used} · {tok.uses_30d} calls last 30d
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tok.scopes.map((s) => <Chip key={s}>{s}</Chip>)}
        </div>
      </div>

      {justCreated && (
        <div className="mono text-[10.5px] tracking-[0.14em] uppercase text-accent mb-2">
          ● new · only shown once · copy now
        </div>
      )}

      <div className="flex items-baseline gap-3 border-t border-rule/70 pt-3 mt-2">
        <span className="mono text-[10px] tracking-[0.18em] uppercase text-muted shrink-0">secret</span>
        <code className={`mono flex-1 min-w-0 truncate text-[13px] ${reveal ? 'text-ink' : 'text-muted'}`}>
          {reveal ? tok.secret : maskSecret(tok.secret)}
        </code>
        <button
          onClick={() => setReveal((r) => !r)}
          className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink shrink-0"
        >
          {reveal ? 'hide' : 'reveal'}
        </button>
        <CopyButton getText={tok.secret} />
        <button
          onClick={() => onRevoke(tok.id)}
          className="mono text-[10.5px] tracking-[0.14em] uppercase text-faint hover:text-accent shrink-0"
        >
          revoke
        </button>
      </div>
    </article>
  );
}

function NewTokenInline({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(new Set(['read', 'write']));
  const toggle = (s) => setScopes((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });
  const generate = () => {
    if (!name.trim() || scopes.size === 0) return;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = 'sm_live_';
    for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)];
    onCreate({
      id: 't-' + Date.now(),
      name: name.trim(),
      secret: s,
      scopes: [...scopes],
      created: 'just now',
      last_used: 'never',
      uses_30d: 0,
    });
  };
  return (
    <div className="border-2 border-dashed border-accent/60 p-4 rounded-sm mb-4 fadein bg-paper">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-accent mb-3">new api token</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">label</div>
          <input
            type="text" value={name} onChange={(e)=>setName(e.target.value)}
            placeholder="e.g. Claude Desktop on laptop"
            className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
            style={{ fontSize: '15.5px' }}
            autoFocus
          />
        </div>
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">scopes</div>
          <div className="flex flex-wrap gap-1.5">
            {TOKEN_SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={`chip ${scopes.has(s.id) ? 'is-active' : ''}`}
                title={s.blurb}
              >
                {scopes.has(s.id) ? '✓ ' : ''}{s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4">
        <span className="mono text-[10px] tracking-[0.06em] text-faint">
          secret is shown once after creation · cannot be retrieved later
        </span>
        <div className="flex items-center gap-3">
          <Btn kind="ghost" onClick={onCancel}>cancel</Btn>
          <Btn kind="solid" onClick={generate} disabled={!name.trim() || scopes.size === 0}>
            generate token ↵
          </Btn>
        </div>
      </div>
    </div>
  );
}

function MCPClientPanel({ tokens, host }) {
  const [clientId, setClientId] = useState(MCP_CLIENTS[0].id);
  const [tokenId, setTokenId]   = useState(tokens[0]?.id || null);
  const client = MCP_CLIENTS.find((c) => c.id === clientId) || MCP_CLIENTS[0];
  const token  = tokens.find((t) => t.id === tokenId) || tokens[0];
  const useToken = token ? token.secret : 'sm_live_<your-token>';
  const snippet = client.snippet(useToken).replace(/\{HOST\}/g, host);
  const path    = client.path.replace(/\{HOST\}/g, host);

  return (
    <div className="crosshair border border-rule rounded-sm bg-surface/30 p-5">
      <span className="ch-tl" /><span className="ch-br" />

      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-ink">mcp setup</h3>
          <span className="mono text-[10.5px] tracking-[0.06em] text-faint">
            paste this into your AI client to push entries directly into your corpus
          </span>
        </div>
      </div>

      {/* client tabs */}
      <div className="flex flex-wrap items-baseline gap-1 mb-4 border-b border-rule">
        {MCP_CLIENTS.map((c) => (
          <button
            key={c.id}
            onClick={() => setClientId(c.id)}
            className={`mono text-[10.5px] tracking-[0.12em] uppercase px-3 py-2 transition-colors ${c.id === clientId ? 'text-ink border-b border-accent -mb-px' : 'text-muted hover:text-ink'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* path + token picker */}
      <div className="flex items-baseline gap-4 flex-wrap mb-3">
        <div className="flex-1 min-w-0">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1">config path</div>
          <div className="mono text-[12.5px] text-ink truncate">{path}</div>
        </div>
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1">use token</div>
          <select
            value={tokenId || ''}
            onChange={(e) => setTokenId(e.target.value)}
            className="bg-transparent border-b border-rule mono text-[12px] py-1 pr-6 text-ink focus:border-ink"
          >
            {tokens.length === 0 && <option value="">no tokens yet · create one first</option>}
            {tokens.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* snippet */}
      <div className="relative">
        <pre className="mono text-[12.5px] leading-[1.55] text-ink bg-paper border border-rule rounded-sm p-4 overflow-x-auto whitespace-pre">
{snippet}
        </pre>
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <CopyButton getText={() => snippet} className="bg-paper/80 px-2 py-1 border border-rule rounded-sm" />
        </div>
      </div>

      <div className="mt-4 mono text-[10px] tracking-[0.06em] text-faint leading-[1.7]">
        after pasting, restart your client. the standmeet tool will appear with capabilities like{' '}
        <span className="text-muted">push_thought</span>,{' '}
        <span className="text-muted">attach_media</span>,{' '}
        <span className="text-muted">tag_entry</span>,{' '}
        <span className="text-muted">search_corpus</span>.
      </div>
    </div>
  );
}

function MCPDownloadPanel() {
  const platforms = [
    { id: 'npm',   label: 'npm', cmd: 'npm install -g @standmeet/mcp-client', size: '482 kB' },
    { id: 'mac',   label: 'macOS · universal', cmd: 'standmeet-mcp_1.4.0_darwin.zip', size: '11.4 MB' },
    { id: 'linux', label: 'Linux · x64',       cmd: 'standmeet-mcp_1.4.0_linux-x64.tar.gz', size: '12.1 MB' },
    { id: 'win',   label: 'Windows · x64',     cmd: 'standmeet-mcp_1.4.0_windows.zip',      size: '13.7 MB' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
      {platforms.map((p) => (
        <a
          key={p.id}
          href="#"
          className="group border border-rule rounded-sm p-3.5 bg-surface/30 hover:border-ink transition-colors flex items-baseline justify-between gap-4"
        >
          <div className="min-w-0">
            <div className="mono text-[10.5px] tracking-[0.06em] text-ink truncate">{p.cmd}</div>
            <div className="mono text-[9.5px] tracking-[0.12em] uppercase text-faint mt-1">{p.label} · {p.size}</div>
          </div>
          <span className="mono text-[10px] tracking-[0.16em] uppercase text-muted group-hover:text-accent shrink-0">
            {p.id === 'npm' ? 'copy ↗' : 'download ↗'}
          </span>
        </a>
      ))}
    </div>
  );
}

function ApiSection() {
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [creating, setCreating] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState(null);
  const host = useShareHost();
  const httpHost = 'https://' + host.replace(/\/.*$/, ''); // strip handle path for API base

  const onCreate = (tok) => {
    setTokens((cur) => [tok, ...cur]);
    setJustCreatedId(tok.id);
    setCreating(false);
    setTimeout(() => setJustCreatedId(null), 30_000); // un-highlight after 30s
  };
  const onRevoke = (id) => {
    if (!confirm('Revoke this token? Any AI client using it will lose access immediately.')) return;
    setTokens((cur) => cur.filter((t) => t.id !== id));
  };

  return (
    <div>
      <SectionHeader
        kicker="surface 1 · programmatic access"
        title="api · mcp"
        count={tokens.length + ' tokens'}
        action={
          <div className="flex items-baseline gap-3">
            <span className="mono text-[10.5px] tracking-[0.06em] text-muted">
              base url · <span className="text-ink">{httpHost}/api/v1</span>
            </span>
            <Btn kind="solid" onClick={() => setCreating(true)} disabled={creating}>＋ new token</Btn>
          </div>
        }
      />

      <p className="reading text-muted mb-7" style={{ fontSize: '15px', maxWidth: '54em' }}>
        Tokens let AI clients (Claude, Cursor, OpenAI, custom scripts) push raw entries into your corpus and
        — at higher scopes — promote, search, or manage codes. Pair a token with the MCP client config below
        and your AI tool gains a <span className="mono text-[13px] text-ink">push_thought</span> tool you can
        call mid-conversation.
      </p>

      {/* tokens */}
      <div className="mb-10">
        <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-ink mb-3 pb-2 border-b border-rule">api tokens</h3>
        {creating && <NewTokenInline onCreate={onCreate} onCancel={() => setCreating(false)} />}
        {tokens.length === 0 && !creating && (
          <div className="mono text-[11px] text-faint border border-dashed border-rule px-4 py-6 rounded-sm text-center">
            no tokens yet · create one to wire up your first AI client
          </div>
        )}
        {tokens.map((t) => (
          <TokenRow key={t.id} tok={t} onRevoke={onRevoke} justCreated={t.id === justCreatedId} />
        ))}
      </div>

      {/* MCP setup */}
      <div className="mb-10">
        <MCPClientPanel tokens={tokens} host={httpHost} />
      </div>

      {/* MCP client download */}
      <div>
        <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-rule">
          <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-ink">install the mcp client</h3>
          <span className="mono text-[10.5px] tracking-[0.06em] text-faint">v1.4.0 · MIT</span>
        </div>
        <p className="reading text-muted" style={{ fontSize: '14.5px' }}>
          The MCP client is a thin wrapper around your StandMeet API — talks to your AI tool over stdio, talks
          to your instance over HTTPS. Most people use the npm version; standalone binaries are there if you
          don't want Node.
        </p>
        <MCPDownloadPanel />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EditField({ label, value, onChange, placeholder, multiline, monoHint }) {
  return (
    <div>
      {label && (
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5 flex items-baseline gap-2">
          <span>{label}</span>
          {monoHint && <span className="text-faint normal-case tracking-[0.06em]">· {monoHint}</span>}
        </div>
      )}
      {multiline ? (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={multiline === true ? 3 : multiline}
          className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint resize-none"
          style={{ fontSize: '15.5px', lineHeight: 1.5 }}
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent border-b border-rule focus:border-ink py-2 reading text-ink placeholder:text-faint"
          style={{ fontSize: '15.5px' }}
        />
      )}
    </div>
  );
}

function ListEditor({ label, items, onChange, render, addLabel = '＋ add', renderHint, emptyHint }) {
  const add = () => onChange([...items, render.empty()]);
  const update = (i, patch) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">{label}</div>
        <div className="flex items-baseline gap-4">
          {renderHint && <span className="mono text-[10px] tracking-[0.1em] text-faint">{renderHint}</span>}
          <button onClick={add} className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink">{addLabel}</button>
        </div>
      </div>
      {items.length === 0 && emptyHint && (
        <div className="mono text-[11px] text-faint border border-dashed border-rule px-4 py-3 rounded-sm">
          {emptyHint}
        </div>
      )}
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="border border-rule rounded-sm p-4 bg-surface/40 relative">
            <div className="flex items-baseline justify-between mb-2">
              <span className="mono text-[9.5px] tracking-[0.18em] uppercase text-faint tabular-nums">{String(i+1).padStart(2,'0')}</span>
              <div className="flex items-center gap-2 mono text-[10px] tracking-[0.1em] text-muted">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="hover:text-ink disabled:opacity-30">↑</button>
                <button onClick={() => move(i, 1)}  disabled={i === items.length - 1} className="hover:text-ink disabled:opacity-30">↓</button>
                <button onClick={() => remove(i)} className="text-faint hover:text-accent ml-1">remove</button>
              </div>
            </div>
            {render.row(item, (patch) => update(i, patch))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StringListEditor({ label, items, onChange, placeholder, addLabel, renderHint }) {
  const add = () => onChange([...items, '']);
  const update = (i, v) => onChange(items.map((x, j) => j === i ? v : x));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">{label}</div>
        <div className="flex items-baseline gap-4">
          {renderHint && <span className="mono text-[10px] tracking-[0.1em] text-faint">{renderHint}</span>}
          <button onClick={add} className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink">
            {addLabel || '＋ add'}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((v, i) => (
          <div key={i} className="flex items-baseline gap-3 border-b border-rule/50 py-1">
            <span className="mono text-[10px] text-faint tabular-nums shrink-0 w-5 pt-1">{String(i+1).padStart(2,'0')}</span>
            <input
              type="text"
              value={v}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent py-2 reading text-ink placeholder:text-faint"
              style={{ fontSize: '15px' }}
            />
            <button onClick={() => remove(i)} className="mono text-[10px] text-faint hover:text-accent shrink-0 pt-1">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaveBar({ dirty, lastSaved, onSave, onRevert }) {
  return (
    <div className="sticky top-0 z-10 -mx-8 lg:-mx-12 px-8 lg:px-12 py-3 bg-paper/85 backdrop-blur border-b border-rule flex items-center justify-between mb-8">
      <div className="flex items-center gap-3 mono text-[10.5px] tracking-[0.14em] uppercase">
        {dirty
          ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-accent live-dot"></span><span className="text-accent">unsaved changes</span></>
          : <><span className="inline-block w-1.5 h-1.5 rounded-full bg-muted/60"></span><span className="text-muted">in sync</span></>}
        {lastSaved && !dirty && <span className="text-faint normal-case tracking-[0.04em]">· last saved {lastSaved}</span>}
      </div>
      <div className="flex items-center gap-3">
        <a href="index.html" target="_blank" className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-ink transition-colors">
          open public page ↗
        </a>
        {dirty && (
          <button onClick={onRevert} className="mono text-[10.5px] tracking-[0.14em] uppercase text-muted hover:text-accent transition-colors">
            revert
          </button>
        )}
        <button
          onClick={onSave}
          disabled={!dirty}
          className="mono text-[11px] tracking-[0.16em] uppercase bg-ink text-paper px-4 py-2 hover:bg-accent transition-colors disabled:opacity-30"
        >
          save & publish
        </button>
      </div>
    </div>
  );
}

function Block({ title, blurb, children }) {
  return (
    <section className="border-t border-rule pt-10 mt-10 first:border-0 first:pt-0 first:mt-0">
      <div className="mb-7 flex items-baseline gap-4 flex-wrap">
        <h2 className="font-serif text-ink" style={{ fontSize: '22px', fontWeight: 500, letterSpacing: '-0.012em' }}>
          {title}
        </h2>
        {blurb && <p className="reading text-muted flex-1 min-w-[20em]" style={{ fontSize: '14px', maxWidth: '46em' }}>{blurb}</p>}
      </div>
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function DomainEditor({ handle, domain, status, onChangeDomain, onChangeStatus }) {
  const sanitized = (domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const valid = sanitized.length > 3 && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(sanitized);
  const defaultHost = 'standmeet.com/' + handle;
  const effectiveHost = (sanitized && status === 'verified') ? sanitized : defaultHost;

  const verify = () => {
    if (!valid) return;
    onChangeStatus('pending');
    // mock — pretend DNS check completes
    setTimeout(() => onChangeStatus('verified'), 1100);
  };
  const reset = () => { onChangeDomain(''); onChangeStatus('unset'); };

  const StatusBadge = () => {
    if (!sanitized) return <span className="mono text-[10px] tracking-[0.16em] uppercase text-faint">○ unset · using default</span>;
    if (status === 'verified') return <span className="mono text-[10px] tracking-[0.16em] uppercase text-accent">● verified · live</span>;
    if (status === 'pending')  return <span className="mono text-[10px] tracking-[0.16em] uppercase text-muted">◐ checking dns…</span>;
    return <span className="mono text-[10px] tracking-[0.16em] uppercase text-faint">○ not verified</span>;
  };

  return (
    <div className="space-y-5">
      {/* default vs custom · two cards side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`border ${status === 'verified' && sanitized ? 'border-rule' : 'border-ink'} p-4 rounded-sm bg-surface/40`}>
          <div className="flex items-baseline justify-between mb-2">
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">default</div>
            {(!sanitized || status !== 'verified') && <span className="mono text-[10px] tracking-[0.16em] uppercase text-accent">● in use</span>}
          </div>
          <div className="font-serif text-ink" style={{ fontSize: '18px', fontWeight: 500, letterSpacing: '-0.005em' }}>
            standmeet.com/<span className="text-accent">{handle}</span>
          </div>
          <div className="mono text-[10.5px] tracking-[0.04em] text-faint mt-1">no setup · always available</div>
        </div>

        <div className={`border ${status === 'verified' && sanitized ? 'border-ink' : 'border-rule'} p-4 rounded-sm bg-surface/40`}>
          <div className="flex items-baseline justify-between mb-2">
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted">custom domain</div>
            <StatusBadge />
          </div>
          <div className="flex items-baseline gap-2 border-b border-rule pb-1">
            <span className="mono text-faint shrink-0">https://</span>
            <input
              type="text"
              value={domain || ''}
              onChange={(e) => {
                const v = e.target.value;
                onChangeDomain(v);
                // typing invalidates a prior verification
                if (status === 'verified') onChangeStatus('unset');
              }}
              placeholder="yourdomain.com"
              className="flex-1 min-w-0 bg-transparent py-1.5 reading text-ink placeholder:text-faint"
              style={{ fontSize: '17px', fontWeight: 500, letterSpacing: '-0.005em' }}
              spellCheck="false"
              autoComplete="off"
            />
            {sanitized && (
              <button onClick={reset} className="mono text-[10px] tracking-[0.12em] text-faint hover:text-accent shrink-0">clear</button>
            )}
          </div>
          <div className="mono text-[10.5px] tracking-[0.04em] mt-2 flex items-baseline justify-between gap-3 flex-wrap">
            <span className={valid ? 'text-muted' : 'text-faint'}>
              {valid ? 'looks like a valid host · verify dns to go live' : sanitized ? 'not a valid host yet' : 'e.g. sijiewang.com, talk.sijiewang.com'}
            </span>
            {valid && status !== 'verified' && (
              <button
                onClick={verify}
                disabled={status === 'pending'}
                className="mono text-[10px] tracking-[0.16em] uppercase text-paper bg-ink px-2.5 py-1 hover:bg-accent transition-colors disabled:opacity-50 shrink-0"
              >
                {status === 'pending' ? 'checking…' : 'verify dns ↗'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* dns instructions, surfaced once user types a valid host */}
      {valid && (
        <div className="border border-rule rounded-sm bg-paper p-4 fadein">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2">dns record · point here</div>
          <div className="grid grid-cols-[80px_120px_1fr_auto] gap-3 items-baseline mono text-[12px] py-1 border-b border-rule">
            <span className="text-faint tracking-[0.16em] uppercase text-[10px]">type</span>
            <span className="text-faint tracking-[0.16em] uppercase text-[10px]">name</span>
            <span className="text-faint tracking-[0.16em] uppercase text-[10px]">value</span>
            <span></span>
          </div>
          <div className="grid grid-cols-[80px_120px_1fr_auto] gap-3 items-baseline mono text-[12.5px] py-2">
            <span className="text-ink">CNAME</span>
            <span className="text-ink">{sanitized.split('.').length > 2 ? sanitized.split('.')[0] : '@'}</span>
            <span className="text-ink truncate">edge.standmeet.com</span>
            <button
              onClick={() => navigator.clipboard && navigator.clipboard.writeText('edge.standmeet.com')}
              className="mono text-[10px] tracking-[0.14em] uppercase text-muted hover:text-ink"
            >copy</button>
          </div>
          <div className="mono text-[10px] tracking-[0.04em] text-faint mt-2 leading-[1.6]">
            propagation usually takes 1–10 minutes · you can keep editing while it's checking.
          </div>
        </div>
      )}

      {/* preview of effective share-URL */}
      <div className="mono text-[10.5px] tracking-[0.12em] text-faint flex items-baseline justify-between flex-wrap gap-2">
        <span>
          effective share host · <span className="text-ink">{effectiveHost}</span>
          <span className="text-faint mx-2">·</span>
          used by code share links, QRs, the gate footer, and the public page&apos;s footer.
        </span>
      </div>
    </div>
  );
}

function BYOAIEditor({ enabled, providers, blurb, onChange }) {
  const ALL_PROVIDERS = [
    { id: 'claude', label: 'Claude (Anthropic)' },
    { id: 'openai', label: 'OpenAI / ChatGPT' },
    { id: 'gemini', label: 'Gemini (Google)' },
  ];
  const toggleProvider = (id) => {
    const next = new Set(providers || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    // require at least one
    if (next.size === 0) next.add(id);
    onChange({ byoai_providers: [...next] });
  };

  return (
    <div className="space-y-5">
      {/* master toggle */}
      <div className={`flex items-baseline justify-between gap-4 border ${enabled ? 'border-ink' : 'border-rule'} rounded-sm p-4 bg-surface/40`}>
        <div className="min-w-0">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5 flex items-baseline gap-2">
            <span>byoai mode</span>
            <span className={enabled ? 'text-accent' : 'text-faint'}>{enabled ? '● ON' : '○ OFF'}</span>
          </div>
          <p className="reading text-muted" style={{ fontSize: '14.5px', maxWidth: '46em' }}>
            When on, the gate page shows a "bring your own AI" option below the code entry. Off keeps the gate
            strictly code-only — visitors without a code can only leave a note.
          </p>
        </div>
        <button
          onClick={() => onChange({ byoai_enabled: !enabled })}
          className={`mono text-[11px] tracking-[0.16em] uppercase px-3.5 py-2 transition-colors shrink-0 ${enabled ? 'bg-ink text-paper hover:bg-accent' : 'border border-ink text-ink hover:bg-ink hover:text-paper'}`}
        >
          {enabled ? 'turn off' : 'turn on'}
        </button>
      </div>

      {enabled && (
        <>
          <div>
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted mb-2 flex items-baseline gap-2">
              <span>accepted providers</span>
              <span className="text-faint normal-case tracking-[0.06em]">· visitor picks one at the gate</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_PROVIDERS.map((p) => {
                const on = (providers || []).includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProvider(p.id)}
                    className={`chip ${on ? 'is-active' : ''}`}
                  >
                    {on ? '✓ ' : ''}{p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <EditField
            label="public-scope blurb · shown next to the api key input"
            monoHint="set expectations clearly · 2 sentences max"
            value={blurb}
            onChange={(v) => onChange({ byoai_public_blurb: v })}
            multiline={3}
          />

          <div className="mono text-[10px] tracking-[0.06em] text-faint leading-[1.7]">
            note · "public scope" currently means everything <em>not</em> marked private in your wiki.
            future versions will let you draw a tighter scope per-visitor segment.
          </div>
        </>
      )}
    </div>
  );
}

function PageSection() {
  const [content, setContent]   = useState(() => window.loadPageContent());
  const [original, setOriginal] = useState(() => window.loadPageContent());
  const [lastSaved, setLastSaved] = useState(null);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(original), [content, original]);

  const update = (patch) => setContent((c) => ({ ...c, ...patch }));
  const updateHero    = (patch) => update({ hero:    { ...content.hero,    ...patch } });
  const updateWhere   = (patch) => update({ where:   { ...content.where,   ...patch } });
  const updateContact = (patch) => update({ contact: { ...content.contact, ...patch } });
  const updateOwner   = (patch) => update({ owner:   { ...content.owner,   ...patch } });

  const save = () => {
    window.savePageContent(content);
    setOriginal(content);
    setLastSaved('just now');
    // also nudge any other open tab + same-tab listeners (storage event doesn't fire in the writing tab)
    try { window.dispatchEvent(new StorageEvent('storage', { key: 'standmeet-page-content' })); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('standmeet-page-saved')); } catch (e) {}
  };
  const revert = () => setContent(original);

  // insights renderer
  const insightRender = {
    empty: () => ({ id: 'i-' + Date.now(), thesis: '', context: '', body: '' }),
    row: (item, patch) => (
      <div className="space-y-3">
        <EditField label="thesis · one bold sentence" value={item.thesis} onChange={(v) => patch({ thesis: v })} placeholder="The one-line claim someone could screenshot." multiline={2} />
        <EditField label="context · where it came up"  value={item.context} onChange={(v) => patch({ context: v })} placeholder="e.g. from a discussion on hiring" />
        <EditField label="expanded · click to read more"          value={item.body}    onChange={(v) => patch({ body: v })}    placeholder="The longer version behind the thesis. 2–3 sentences max." multiline={4} />
      </div>
    ),
  };

  // projects renderer
  const projectRender = {
    empty: () => ({ id: 'p-' + Date.now(), name: '', tagline: '', lines: [''], url: '' }),
    row: (item, patch) => (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <EditField label="name"    value={item.name}    onChange={(v) => patch({ name: v })}    placeholder="e.g. Lucerna" />
          <EditField label="tagline" value={item.tagline} onChange={(v) => patch({ tagline: v })} placeholder="one short descriptor" />
        </div>
        <StringListEditor
          label="status lines · honest details"
          items={item.lines}
          onChange={(lines) => patch({ lines })}
          placeholder="e.g. ~12 new users/day. D30 retention 6%."
        />
        <EditField label="url · optional" value={item.url || ''} onChange={(v) => patch({ url: v })} placeholder="e.g. lucerna.dev (no protocol)" />
      </div>
    ),
  };

  return (
    <div>
      <SectionHeader
        kicker="surface 1 · public content"
        title="page"
        action={
          <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-faint">
            edits sync to <a href="index.html" target="_blank" className="text-muted hover:text-ink">{window.siteHost(content)} ↗</a>
          </span>
        }
      />

      <p className="reading text-muted mb-6" style={{ fontSize: '15px', maxWidth: '54em' }}>
        Author the five blocks visitors land on. Hero is the prose paragraph + chat input. Below that:
        insights (bold theses they can browse), projects (typography-only list), where you are (employment posture),
        and how to talk to you (chat / email / screening). Changes save to local storage and reflect on the public page.
      </p>

      <SaveBar dirty={dirty} lastSaved={lastSaved} onSave={save} onRevert={revert} />

      {/* site · domain settings */}
      <Block title="site" blurb="Where this lives on the web. Use a custom domain (e.g. sijiewang.com) or leave blank to keep the default standmeet.com path. Custom domains need a DNS record before they're live.">
        <DomainEditor
          handle={content.owner.handle}
          domain={content.owner.domain}
          status={content.owner.domain_status}
          onChangeDomain={(domain) => updateOwner({ domain })}
          onChangeStatus={(domain_status) => updateOwner({ domain_status })}
        />
      </Block>

      {/* BYOAI mode */}
      <Block title="byoai mode" blurb="Bring-Your-Own-AI: visitors without an invite code can chat with your public corpus using their own API key. They pay for inference, you pay for retrieval. Private topics still require a code.">
        <BYOAIEditor
          enabled={content.owner.byoai_enabled !== false}
          providers={content.owner.byoai_providers || ['claude', 'openai']}
          blurb={content.owner.byoai_public_blurb || ''}
          onChange={(patch) => updateOwner(patch)}
        />
      </Block>

      {/* hero */}
      <Block title="hero" blurb="What lands first: identity + a serif prose paragraph that reveals your worldview in 1–3 sentences, then the chat input with example prompts beneath.">
        <div className="grid grid-cols-2 gap-5">
          <EditField label="full name"    value={content.owner.full}     onChange={(v) => updateOwner({ full: v })}     placeholder="e.g. sijie wang" />
          <EditField label="location"     value={content.owner.location} onChange={(v) => updateOwner({ location: v })} placeholder="city + region" />
        </div>
        <EditField
          label="prose · 1–3 sentences · reveal your worldview"
          monoHint="avoid: job title, skill list, 'passionate about'"
          value={content.hero.prose}
          onChange={(v) => updateHero({ prose: v })}
          multiline={5}
        />
        <StringListEditor
          label="example prompts · shown below the chat input"
          renderHint="aim for 3–4 · the ones that reveal what you think about"
          items={content.hero.examples}
          onChange={(examples) => updateHero({ examples })}
          placeholder="e.g. What do you think about AI replacing engineers?"
        />
      </Block>

      {/* insights */}
      <Block title="things I've been thinking about" blurb="The differentiator. Each entry is a one-line thesis (in serif, bold-ish), the context it came from (italic mono), and an expandable body. Visitors browse by idea — not by date.">
        <ListEditor
          label="insights"
          items={content.insights}
          onChange={(insights) => update({ insights })}
          render={insightRender}
          renderHint="best at 4–6 · each should reveal a specific worldview"
        />
      </Block>

      {/* projects */}
      <Block title="what I'm building" blurb="Honest projects, typography only. Name, one-line tagline, and 1–3 status lines (real numbers + real status — including 'not public yet'). URL only if there's a public site.">
        <ListEditor
          label="projects"
          items={content.projects}
          onChange={(projects) => update({ projects })}
          render={projectRender}
        />
      </Block>

      {/* where */}
      <Block title="where I am" blurb="Location, employment posture, and the specific filter for what you're open to. Specificity replaces 'open to opportunities' vagueness. Closes with the 'not desperate' line.">
        <EditField label="location line" value={content.where.location_line} onChange={(v) => updateWhere({ location_line: v })} placeholder="e.g. Based in Markham, Ontario. Canadian PR." />
        <EditField label="status · 2–3 sentence prose" value={content.where.status_prose} onChange={(v) => updateWhere({ status_prose: v })} multiline={3} />
        <StringListEditor
          label="what you're looking for · the filter"
          items={content.where.looking_for}
          onChange={(looking_for) => updateWhere({ looking_for })}
          placeholder="e.g. founding engineer or staff IC role"
          renderHint="each line is a separate filter criterion · be specific"
        />
        <EditField label="closing · the 'not desperate' line" value={content.where.closing} onChange={(v) => updateWhere({ closing: v })} placeholder="e.g. Otherwise — just here to think out loud." />
      </Block>

      {/* contact */}
      <Block title="how to talk to me" blurb="The screening rules, said honestly. What chat handles, what email is for, what recruiter outreach should look like, what's open for casual idea conversation.">
        <EditField label="email" value={content.contact.email} onChange={(v) => updateContact({ email: v })} placeholder="hello@…" />
        <EditField label="chat line · points back to the input above" value={content.contact.chat_line} onChange={(v) => updateContact({ chat_line: v })} multiline={2} />
        <EditField label="recruiter rules" value={content.contact.recruiter_prose} onChange={(v) => updateContact({ recruiter_prose: v })} multiline={3} />
        <EditField label="casual conversation rules" value={content.contact.casual_prose} onChange={(v) => updateContact({ casual_prose: v })} multiline={3} />
      </Block>

      <SaveBar dirty={dirty} lastSaved={lastSaved} onSave={save} onRevert={revert} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// app

function App() {
  // self-host auth — read session/instance from localStorage. If no session,
  // we render in DEMO mode (with a banner pointing to login.html) instead of
  // auto-redirecting, so the admin page is always reviewable standalone.
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('standmeet-auth') || 'null'); } catch (e) { return null; }
  });
  const demoMode = !session;

  const signOut = () => {
    try { localStorage.removeItem('standmeet-auth'); } catch (e) {}
    setSession(null);
  };

  const [section, setSection] = useState('page');
  const [rawEntries, setRawEntries] = useState(RAW_ENTRIES);
  const [codes, setCodes] = useState(CODES);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [previewCode, setPreviewCode] = useState(null);
  const [qrCode, setQrCode] = useState(null);

  const openCreate = (existing) => {
    setEditing(existing || null);
    setCreateOpen(true);
  };
  const saveCode = (c) => {
    if (editing) {
      setCodes((cur) => cur.map((x) => x.id === c.id ? c : x));
    } else {
      setCodes((cur) => [c, ...cur]);
    }
    setCreateOpen(false);
    setEditing(null);
  };

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <DemoBanner />
        <TopBar session={{ email: 'demo@standmeet.local', handle: OWNER_ADMIN.handle }} onSignOut={() => {}} />
        <div className="flex-1 flex">
          <Sidebar section={section} onChange={setSection} />
          <main className="flex-1 px-8 lg:px-12 py-8 overflow-x-hidden">
            <div className="max-w-[1100px]">
              {section === 'page'          && <PageSection />}
              {section === 'raw'           && <RawSection entries={rawEntries} setEntries={setRawEntries} />}
              {section === 'wiki'          && <WikiSection />}
              {section === 'conversations' && <ConversationsSection />}
              {section === 'codes'         && <CodesSection codes={codes} setCodes={setCodes} openCreate={openCreate} openPreview={setPreviewCode} openQR={setQrCode} />}
              {section === 'connectors'    && <ConnectorsSection />}
              {section === 'api'           && <ApiSection />}
              {section === 'preview'       && <PreviewSection codes={codes} openPreview={setPreviewCode} />}
            </div>
          </main>
        </div>

        {createOpen && (
          <CodeCreateModal
            initial={editing}
            onClose={() => { setCreateOpen(false); setEditing(null); }}
            onSave={saveCode}
          />
        )}
        {previewCode && (
          <VisitorPreviewModal code={previewCode} onClose={() => setPreviewCode(null)} />
        )}
        {qrCode && (
          <CodeQRModal code={qrCode} onClose={() => setQrCode(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar session={session} onSignOut={signOut} />
      <div className="flex-1 flex">
        <Sidebar section={section} onChange={setSection} />
        <main className="flex-1 px-8 lg:px-12 py-8 overflow-x-hidden">
          <div className="max-w-[1100px]">
            {section === 'page'          && <PageSection />}
            {section === 'raw'           && <RawSection entries={rawEntries} setEntries={setRawEntries} />}
            {section === 'wiki'          && <WikiSection />}
            {section === 'conversations' && <ConversationsSection />}
            {section === 'codes'         && <CodesSection codes={codes} setCodes={setCodes} openCreate={openCreate} openPreview={setPreviewCode} openQR={setQrCode} />}
            {section === 'connectors'    && <ConnectorsSection />}
            {section === 'api'           && <ApiSection />}
            {section === 'preview'       && <PreviewSection codes={codes} openPreview={setPreviewCode} />}
          </div>
        </main>
      </div>

      {createOpen && (
        <CodeCreateModal
          initial={editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
          onSave={saveCode}
        />
      )}
      {previewCode && (
        <VisitorPreviewModal code={previewCode} onClose={() => setPreviewCode(null)} />
      )}
      {qrCode && (
        <CodeQRModal code={qrCode} onClose={() => setQrCode(null)} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
