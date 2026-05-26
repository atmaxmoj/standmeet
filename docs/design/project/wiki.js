/* global React, ReactDOM, SM, VD */

(function () {

const { Chip, SmallCaps, LiveDot, Btn, Crosshair, Banner, SpeakerLabel, StickyComposer } = SM;
const { OWNER, WIKI } = VD;

function useQuery() {
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  return {
    slug: params.get('slug') || params.get('s') || 'eval-is-the-product',
    code: params.get('c'),
    byoai: params.get('byoai') === '1',
    visitor: params.get('v'),
  };
}

function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      const v = localStorage.getItem('standmeet-dark');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    return false;
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('standmeet-dark', dark ? '1' : '0'); } catch (e) {}
  }, [dark]);
  return [dark, setDark];
}

function TopBar({ dark, onToggleDark, q }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'18px 32px 14px', borderBottom:'1px solid var(--rule)'
    }}>
      <div className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', display:'flex', alignItems:'baseline', gap:12 }}>
        <a href="index.html" style={{ color:'var(--ink)', textDecoration:'none' }}>standmeet</a>
        <span style={{ color:'var(--faint)' }}>/</span>
        <a href="index.html" style={{ color:'var(--muted)', textDecoration:'none' }}>{OWNER.handle}</a>
        <span style={{ color:'var(--faint)' }}>·</span>
        <span style={{ color:'var(--accent)' }}>wiki</span>
        {(q.code || q.byoai) && (
          <span style={{ marginLeft:10, display:'inline-flex', alignItems:'center', gap:6 }}>
            <LiveDot />
            <span style={{ fontSize:10, color:'var(--faint)', letterSpacing:'0.16em' }}>
              {q.byoai ? 'byoai · public scope' : 'unlocked · ' + q.code}
            </span>
          </span>
        )}
      </div>
      <nav style={{ display:'flex', gap:24 }}>
        <a href="blog.html" className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', textDecoration:'none' }}>writing</a>
        <a href="index.html" className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', textDecoration:'none' }}>chat</a>
        <button onClick={onToggleDark} className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', background:'transparent', border:0, cursor:'pointer' }}>
          {dark ? 'light' : 'dark'}
        </button>
      </nav>
    </header>
  );
}

function Cover({ entry, locked }) {
  const hue = (entry.seo && entry.seo.og_hue) || 'amber';
  const lines = entry.title.split(/\.\s+|:\s+/);
  return (
    <div className={`og-cover hue-${hue}`} style={locked ? { filter:'grayscale(0.6)' } : null}>
      <span className="tag">wiki · {entry.tags[0] || 'corpus'}</span>
      <span className="no">{entry.last_edited.toUpperCase()}</span>
      <span className="h">{lines[0] || entry.title}</span>
      {lines[1] && <span className="s">{lines.slice(1).join('. ')}</span>}
      {locked && (
        <div className="lock-overlay">
          <span className="mono" style={{ fontSize:12, letterSpacing:'0.22em', textTransform:'uppercase', color:'var(--accent)' }}>private · code-gated</span>
        </div>
      )}
    </div>
  );
}

function ArticleBody({ entry }) {
  return (
    <div className="article-body reading" style={{ color:'var(--ink)' }}>
      {entry.body.map((blk, i) => {
        if (blk.kind === 'h')    return <h2 key={i}>{blk.text}</h2>;
        if (blk.kind === 'pull') return <blockquote key={i}>{blk.text}</blockquote>;
        return <p key={i}>{blk.text}</p>;
      })}
    </div>
  );
}

function LockedView({ entry, onAsk }) {
  return (
    <div style={{ maxWidth:720, margin:'80px auto 80px', padding:'0 24px', textAlign:'center' }}>
      <SmallCaps>private wiki entry</SmallCaps>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(36px,5vw,56px)', fontWeight:380, letterSpacing:'-0.018em', lineHeight:1.05, marginTop:8 }}>
        {entry.title}<span style={{ color:'var(--accent)' }}>.</span>
      </h1>
      <p className="reading" style={{ fontSize:18, color:'var(--muted)', maxWidth:'34em', margin:'24px auto 0' }}>
        {entry.locked_body}
      </p>
      <div style={{ marginTop:32, display:'flex', justifyContent:'center', gap:16, flexWrap:'wrap' }}>
        <a href="gate.html#request" className="sm-btn sm-btn-accent">request a code ↗</a>
        <Btn kind="outline" onClick={onAsk}>ask the ai about it</Btn>
      </div>
    </div>
  );
}

function RelatedRail({ slugs, title = 'read next' }) {
  if (!slugs || !slugs.length) return null;
  const items = slugs.map((s) => WIKI.find((w) => w.slug === s)).filter(Boolean);
  if (!items.length) return null;
  return (
    <aside style={{ marginTop:64, paddingTop:32, borderTop:'1px solid var(--rule)' }}>
      <SmallCaps>{title}</SmallCaps>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:32, marginTop:18 }}>
        {items.map((r) => (
          <a key={r.slug} href={'wiki.html?slug=' + r.slug} style={{ textDecoration:'none', color:'inherit' }}>
            <div className="smallcaps" style={{ marginBottom:4 }}>{r.last_edited} · {r.sources} sources</div>
            <div style={{ fontFamily:"'Newsreader',serif", fontSize:20, fontWeight:400, letterSpacing:'-0.005em' }}>{r.title}</div>
            <p className="reading" style={{ fontSize:15, color:'var(--muted)', marginTop:6 }}>{r.excerpt}</p>
            <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:4 }}>
              {r.tags.map((t) => <Chip key={t} tone={t === 'private' ? 'private' : 'neutral'}>{t}</Chip>)}
            </div>
          </a>
        ))}
      </div>
    </aside>
  );
}

function App() {
  const q = useQuery();
  const [dark, setDark] = useTheme();
  const entry = WIKI.find((w) => w.slug === q.slug);
  const [input, setInput] = React.useState('');

  if (!entry) {
    return (
      <div>
        <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
        <div style={{ padding:'120px 24px', textAlign:'center' }}>
          <div style={{ fontFamily:"'Newsreader',serif", fontSize:40 }}>not found<span style={{ color:'var(--accent)' }}>.</span></div>
          <p className="reading" style={{ fontSize:16, color:'var(--muted)', marginTop:12 }}>
            no entry matches <span className="mono">{q.slug}</span>.
          </p>
          <a href="blog.html" className="sm-btn sm-btn-outline" style={{ marginTop:24, display:'inline-block' }}>← all writing</a>
        </div>
      </div>
    );
  }

  const locked = entry.visibility === 'on-request' && !q.code;

  const askAboutThis = (qText) => {
    const text = (qText || input).trim();
    if (!text) return;
    const params = new URLSearchParams(window.location.search);
    params.set('q', text);
    params.set('from', 'wiki/' + entry.slug);
    params.delete('slug');
    window.location.href = 'index.html?' + params.toString();
  };

  if (locked) {
    return (
      <div>
        <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
        <LockedView entry={entry} onAsk={() => askAboutThis(`Why is "${entry.title}" gated, and what’s the public-version answer?`)} />
      </div>
    );
  }

  const starters = [
    `What’s the practical takeaway from "${entry.title.toLowerCase()}"?`,
    `Where does this show up in sijie’s current work?`,
    `Has he changed his mind on any of this?`,
  ];

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
      {window.SM && window.SM.SessionStrip && <window.SM.SessionStrip />}

      <main style={{ flex:1, maxWidth:920, margin:'0 auto', padding:'40px 24px 0', width:'100%' }}>
        {/* breadcrumb */}
        <div style={{ marginBottom:24, display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div className="smallcaps">
            <a href="blog.html" style={{ color:'var(--muted)', textDecoration:'none' }}>← writing</a>
            <span style={{ color:'var(--faint)', margin:'0 8px' }}>/</span>
            <span style={{ color:'var(--ink)' }}>wiki · {entry.slug}</span>
          </div>
          <div className="mono" style={{ fontSize:10.5, color:'var(--muted)', letterSpacing:'0.06em' }}>
            {entry.last_edited} · {entry.sources} sources cited
          </div>
        </div>

        <Cover entry={entry} />

        {/* metadata strip */}
        <header style={{ marginTop:32, marginBottom:36 }}>
          <div className="smallcaps" style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap', marginBottom:12 }}>
            <span>{entry.last_edited}</span>
            <span style={{ color:'var(--faint)' }}>·</span>
            <span>{entry.sources} corpus sources</span>
            <span style={{ color:'var(--faint)' }}>·</span>
            <span>by <span style={{ color:'var(--ink)' }}>{OWNER.full}</span></span>
            {entry.tags.map((t) => (
              <a key={t} href={'blog.html?tag=' + t} style={{ marginLeft:6, textDecoration:'none' }}>
                <Chip tone={t === 'private' ? 'private' : 'neutral'}>#{t}</Chip>
              </a>
            ))}
          </div>
          <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(36px, 5vw, 56px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:1.04, textWrap:'pretty' }}>
            {entry.title}
          </h1>
          <p style={{ fontFamily:"'Newsreader',serif", fontStyle:'italic', fontSize:22, color:'var(--muted)', lineHeight:1.45, fontWeight:380, marginTop:16, maxWidth:'34em', textWrap:'pretty' }}>
            {entry.excerpt}
          </p>
        </header>

        {/* body */}
        <div style={{ maxWidth:680, margin:'0 auto' }}>
          <ArticleBody entry={entry} />
        </div>

        {/* related + backlinks */}
        <div style={{ maxWidth:760, margin:'0 auto' }}>
          <RelatedRail slugs={entry.related} title="read next" />
          {entry.backlinks && entry.backlinks.length > 0 && (
            <RelatedRail slugs={entry.backlinks} title="cited by" />
          )}
        </div>

        {/* SEO/structured-data hint for trust */}
        <div style={{ maxWidth:760, margin:'48px auto 0', padding:'14px 18px', border:'1px solid var(--rule)', borderRadius:3, background:'color-mix(in oklab, var(--surface) 50%, transparent)' }}>
          <div className="smallcaps" style={{ marginBottom:6 }}>about this entry</div>
          <p className="reading" style={{ fontSize:13.5, color:'var(--muted)', margin:0 }}>
            One of {OWNER.full}’s {WIKI.length}+ wiki entries. The AI on this site is grounded in the same corpus, so you
            can ask follow-ups below and get answers in his voice with citations back to entries like this one.
          </p>
        </div>
      </main>

      {/* sticky ask bar */}
      <div className="ask-strip">
        <div style={{ maxWidth:760, margin:'0 auto', padding:'14px 24px' }}>
          <div className="smallcaps" style={{ marginBottom:8, display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
            <span style={{ color:'var(--ink)' }}>ask the ai about this</span>
            <span style={{ color:'var(--faint)' }}>·</span>
            <span>grounded in the same corpus</span>
          </div>
          <form onSubmit={(e)=>{ e.preventDefault(); askAboutThis(); }} style={{ borderTop:'1px solid var(--ink)', borderBottom:'1px solid var(--ink)', display:'flex', alignItems:'baseline', gap:14, padding:'10px 4px' }}>
            <span style={{ color:'var(--accent)', fontFamily:"'Newsreader',serif", fontSize:24, lineHeight:1 }}>›</span>
            <input
              type="text" value={input} onChange={(e)=>setInput(e.target.value)}
              placeholder={`follow-up question about "${entry.title.toLowerCase()}"…`}
              style={{ flex:1, minWidth:0, background:'transparent', border:0, fontFamily:"'Newsreader',serif", fontSize:20, color:'var(--ink)', fontStyle: input ? 'normal' : 'italic' }}
            />
            <button type="submit" disabled={!input.trim()} className="mono" style={{ fontSize:11, letterSpacing:'0.18em', textTransform:'uppercase', background:'transparent', border:0, cursor:'pointer', color: input.trim() ? 'var(--muted)' : 'var(--faint)' }}>
              ask <span style={{ fontSize:14 }}>↵</span>
            </button>
          </form>
          <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:'4px 4px', alignItems:'baseline' }}>
            <span className="mono" style={{ fontSize:10, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--faint)', marginRight:12 }}>try</span>
            {starters.map((s, i) => (
              <button key={i} onClick={() => askAboutThis(s)} style={{ background:'transparent', border:0, fontFamily:"'Newsreader',serif", fontStyle:'italic', color:'var(--muted)', fontSize:14.5, cursor:'pointer', textAlign:'left' }}>
                "{s}"{i < starters.length-1 && <span style={{ color:'var(--faint)', fontStyle:'normal', margin:'0 6px' }}>/</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

})();
