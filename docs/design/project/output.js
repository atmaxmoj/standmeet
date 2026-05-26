/* global React, ReactDOM, SM, VD */

(function () {

const { Chip, SmallCaps, LiveDot, Btn, Crosshair, Banner } = SM;
const { OWNER, OUTPUTS } = VD;

function useQuery() {
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  return {
    slug: params.get('slug') || params.get('s') || 'the-eval-rubric',
    code: params.get('c'), byoai: params.get('byoai') === '1',
  };
}

function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try { const v = localStorage.getItem('standmeet-dark'); if (v === '1') return true; if (v === '0') return false; } catch (e) {}
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
    <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 32px 14px', borderBottom:'1px solid var(--rule)' }}>
      <div className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', display:'flex', alignItems:'baseline', gap:12 }}>
        <a href="index.html" style={{ color:'var(--ink)', textDecoration:'none' }}>standmeet</a>
        <span style={{ color:'var(--faint)' }}>/</span>
        <a href="index.html" style={{ color:'var(--muted)', textDecoration:'none' }}>{OWNER.handle}</a>
        <span style={{ color:'var(--faint)' }}>·</span>
        <span style={{ color:'var(--accent)' }}>output</span>
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
        <button onClick={onToggleDark} className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', background:'transparent', border:0, cursor:'pointer' }}>{dark ? 'light' : 'dark'}</button>
      </nav>
    </header>
  );
}

function Hero({ output, locked }) {
  const hue = output.cover_hue || 'amber';
  return (
    <div className={`o-hero hue-${hue}`} style={locked ? { filter:'grayscale(0.6)' } : null}>
      <span className="tag">output · {output.format}</span>
      <span className="meta">{output.published_at}</span>
      <span className="no">no. {output.slug}</span>
      <span className="h">{output.title}</span>
      <span className="s">{output.tagline}</span>
      {locked && (
        <div className="lock-overlay">
          <span className="mono" style={{ fontSize:12, letterSpacing:'0.22em', textTransform:'uppercase', color:'var(--accent)' }}>● unlisted · code-gated</span>
        </div>
      )}
    </div>
  );
}

function PdfPreviewCard({ output }) {
  return (
    <div className="pdf-card">
      <div className="ph">{output.title}</div>
      <div className="pk" style={{ marginTop:4 }}>sijie wang · {output.published_at} · standmeet.com/{OWNER.handle}</div>
      <hr/>
      <div style={{ marginTop:6, fontWeight:500, fontSize:9.5 }}>01 · faithfulness</div>
      <div style={{ marginTop:2, color:'var(--muted)' }}>
        For every claim in the answer, can you trace it back to an entry in the corpus? Not "is it true in general" — is it supported by what the corpus actually says?
      </div>
      <div style={{ marginTop:8, fontWeight:500, fontSize:9.5 }}>02 · attribution</div>
      <div style={{ marginTop:2, color:'var(--muted)' }}>
        When the answer is faithful, can the system point to which entry supports which claim?
      </div>
      <div style={{ marginTop:8, fontWeight:500, fontSize:9.5 }}>03 · refusal-when-absent</div>
      <div style={{ marginTop:2, color:'var(--muted)' }}>
        When the corpus doesn't carry the answer, does the system say so? Or does it fabricate?
      </div>
      <div className="pn">1 / {output.pages || 4}</div>
    </div>
  );
}

function ArticleBody({ output }) {
  return (
    <div className="o-body reading" style={{ color:'var(--ink)' }}>
      {output.body.map((blk, i) => {
        if (blk.kind === 'h')    return <h2 key={i}>{blk.text}</h2>;
        if (blk.kind === 'pull') return <blockquote key={i}>{blk.text}</blockquote>;
        return <p key={i}>{blk.text}</p>;
      })}
    </div>
  );
}

function LeadCaptureForm({ output }) {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const submit = (e) => { e.preventDefault(); if (!email.trim()) return; setSent(true); };
  if (sent) {
    return (
      <Crosshair className="ad-card" style={{ padding:'18px 20px' }}>
        <SmallCaps>sent</SmallCaps>
        <p className="reading" style={{ fontSize:16, color:'var(--ink)', marginTop:8 }}>
          The PDF is on its way to <span style={{ color:'var(--accent)' }}>{email}</span>.
        </p>
        <p className="reading" style={{ fontSize:13.5, color:'var(--muted)', marginTop:6 }}>
          You'll also get a quiet ping next time sijie publishes a new output. No newsletter; only when there's actually something new.
        </p>
      </Crosshair>
    );
  }
  return (
    <Crosshair className="ad-card" style={{ padding:'18px 20px' }}>
      <SmallCaps>get the full pdf</SmallCaps>
      <p className="reading" style={{ fontSize:16, color:'var(--ink)', marginTop:8 }}>{output.leads_pitch}</p>
      <form onSubmit={submit} style={{ marginTop:14, display:'flex', alignItems:'baseline', gap:14, borderTop:'1px solid var(--ink)', borderBottom:'1px solid var(--ink)', padding:'10px 4px' }}>
        <span style={{ color:'var(--accent)', fontFamily:"'Newsreader',serif", fontSize:24, lineHeight:1 }}>›</span>
        <input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="your email" style={{ flex:1, minWidth:0, background:'transparent', border:0, fontFamily:"'Newsreader',serif", fontSize:18, color:'var(--ink)' }} />
        <button type="submit" disabled={!email.trim()} className="mono" style={{ fontSize:11, letterSpacing:'0.18em', textTransform:'uppercase', background:'transparent', border:0, cursor:'pointer', color: email.trim() ? 'var(--muted)' : 'var(--faint)' }}>
          send pdf <span style={{ fontSize:14 }}>↵</span>
        </button>
      </form>
      <div className="mono" style={{ fontSize:9.5, color:'var(--faint)', marginTop:8, letterSpacing:'0.06em' }}>
        sijie sees the email · no list-rental · unsubscribe is one click in the PDF footer.
      </div>
    </Crosshair>
  );
}

function Locked({ output }) {
  return (
    <div style={{ maxWidth:680, margin:'80px auto', padding:'0 24px', textAlign:'center' }}>
      <SmallCaps>unlisted · code required</SmallCaps>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(36px,5vw,56px)', fontWeight:380, letterSpacing:'-0.018em', lineHeight:1.05, marginTop:8 }}>
        {output.title}<span style={{ color:'var(--accent)' }}>.</span>
      </h1>
      <p className="reading" style={{ fontSize:18, color:'var(--muted)', maxWidth:'34em', margin:'24px auto 0' }}>
        {output.locked_body}
      </p>
      <div style={{ marginTop:32, display:'flex', justifyContent:'center', gap:14, flexWrap:'wrap' }}>
        <a href="gate.html#request" className="sm-btn sm-btn-accent">request access ↗</a>
        <a href="gate.html" className="sm-btn sm-btn-outline">enter a code</a>
      </div>
    </div>
  );
}

function App() {
  const q = useQuery();
  const [dark, setDark] = useTheme();
  const output = OUTPUTS.find((o) => o.slug === q.slug);

  if (!output) {
    return (
      <div>
        <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
        <div style={{ padding:'120px 24px', textAlign:'center' }}>
          <div style={{ fontFamily:"'Newsreader',serif", fontSize:40 }}>not found<span style={{ color:'var(--accent)' }}>.</span></div>
          <a href="blog.html" className="sm-btn sm-btn-outline" style={{ marginTop:24, display:'inline-block' }}>← all writing</a>
        </div>
      </div>
    );
  }

  const locked = (output.tier === 'unlisted' || output.tier === 'private') && !q.code;

  if (locked) {
    return (
      <div>
        <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
        <Locked output={output} />
      </div>
    );
  }

  const isPdf = output.format && output.format.includes('pdf');
  const isWeb = output.format === 'web' || output.format === 'pdf+web';

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
      {window.SM && window.SM.SessionStrip && <window.SM.SessionStrip />}

      <main style={{ flex:1, maxWidth:1080, margin:'0 auto', padding:'40px 24px 64px', width:'100%' }}>
        <div className="smallcaps" style={{ marginBottom:24 }}>
          <a href="blog.html" style={{ color:'var(--muted)', textDecoration:'none' }}>← writing</a>
          <span style={{ color:'var(--faint)', margin:'0 8px' }}>/</span>
          <span style={{ color:'var(--ink)' }}>output · {output.slug}</span>
        </div>

        <Hero output={output} />

        {/* meta strip + tier + CTA */}
        <header style={{ marginTop:28, display:'grid', gridTemplateColumns:'1fr auto', gap:24, alignItems:'baseline', paddingBottom:24, borderBottom:'1px solid var(--rule)' }}>
          <div>
            <div className="smallcaps" style={{ marginBottom:8, display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
              <span>{output.published_at}</span>
              <span style={{ color:'var(--faint)' }}>·</span>
              {output.pages && <><span>{output.pages} pages</span><span style={{ color:'var(--faint)' }}>·</span></>}
              <span>by <span style={{ color:'var(--ink)' }}>{OWNER.full}</span></span>
              <span className={'tier-pill ' + output.tier} style={{ marginLeft:6 }}>● {output.tier}</span>
            </div>
            <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(40px,5.4vw,62px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:1.04, marginTop:6 }}>
              {output.title}
            </h1>
            <p style={{ fontFamily:"'Newsreader',serif", fontStyle:'italic', fontSize:22, color:'var(--muted)', lineHeight:1.45, marginTop:14, maxWidth:'34em' }}>
              {output.tagline}
            </p>
          </div>
          {isPdf && (
            <div style={{ display:'flex', flexDirection:'column', gap:10, alignItems:'flex-end' }}>
              <Btn kind="solid" size="lg">download pdf · {Math.round(output.download_kb / 100) / 10 || 1.8} mb ↓</Btn>
              <span className="mono" style={{ fontSize:10, color:'var(--faint)', letterSpacing:'0.06em' }}>
                free · email required for new releases
              </span>
            </div>
          )}
        </header>

        {/* two-column · pdf preview + excerpt */}
        {isPdf && (
          <section style={{ marginTop:36, display:'grid', gridTemplateColumns:'340px 1fr', gap:48, alignItems:'flex-start' }}>
            <PdfPreviewCard output={output} />
            <div>
              <SmallCaps>what's inside</SmallCaps>
              <p className="reading" style={{ fontSize:18, color:'var(--ink)', marginTop:8, lineHeight:1.55 }}>{output.excerpt}</p>
              <div style={{ marginTop:24 }}>
                <LeadCaptureForm output={output} />
              </div>
            </div>
          </section>
        )}

        {/* web essay body */}
        {isWeb && output.body && output.body.length > 0 && (
          <section style={{ marginTop:48, maxWidth:680, margin:'48px auto 0' }}>
            <ArticleBody output={output} />
          </section>
        )}

        {/* related outputs */}
        {output.related && output.related.length > 0 && (
          <aside style={{ marginTop:80, paddingTop:32, borderTop:'1px solid var(--rule)', maxWidth:880, marginLeft:'auto', marginRight:'auto' }}>
            <SmallCaps>more like this</SmallCaps>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:24, marginTop:18 }}>
              {output.related.map((s) => {
                const r = OUTPUTS.find((o) => o.slug === s);
                if (!r) return null;
                return (
                  <a key={r.slug} href={'output.html?slug=' + r.slug} style={{ textDecoration:'none', color:'inherit' }}>
                    <div className={`o-hero hue-${r.cover_hue}`} style={{ aspectRatio:'16/9' }}>
                      <span className="tag">{r.format}</span>
                      <span className="meta">{r.published_at}</span>
                      <span className="h">{r.title}</span>
                      <span className="s">{r.tagline.slice(0,60)}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </aside>
        )}

        {/* footer · ask the AI */}
        <section style={{ marginTop:80, paddingTop:32, borderTop:'1px solid var(--rule)', maxWidth:760, margin:'80px auto 0' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:24, alignItems:'baseline' }}>
            <div>
              <SmallCaps>or talk it through</SmallCaps>
              <h3 style={{ fontFamily:"'Newsreader',serif", fontSize:28, fontWeight:400, letterSpacing:'-0.012em', lineHeight:1.15, marginTop:6 }}>
                Ask sijie's AI about this<span style={{ color:'var(--accent)' }}>.</span>
              </h3>
              <p className="reading" style={{ fontSize:16, color:'var(--muted)', marginTop:8 }}>
                Grounded in the same corpus this output came from. The AI can dig deeper, give counter-examples, or point to related work.
              </p>
            </div>
            <a href="index.html" className="sm-btn sm-btn-outline">open the chat →</a>
          </div>
        </section>
      </main>

      <footer style={{ borderTop:'1px solid var(--rule)', padding:'20px 32px', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div className="mono" style={{ fontSize:10.5, color:'var(--muted)', letterSpacing:'0.06em' }}>
          standmeet.com/{OWNER.handle}/output/{output.slug}
        </div>
        <div className="mono" style={{ fontSize:10.5, color:'var(--faint)', letterSpacing:'0.06em' }}>
          {OWNER.full} · {OWNER.location} · {OWNER.email}
        </div>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

})();
