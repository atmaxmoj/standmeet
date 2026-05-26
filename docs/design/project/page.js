/* global React, ReactDOM, SM, VD */

(function () {

const { Chip, SmallCaps, LiveDot, Btn, Crosshair } = SM;
const { OWNER, PAGES } = VD;

function useQuery() {
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  return {
    slug: params.get('slug') || params.get('s') || 'press',
    code: params.get('c'),
    byoai: params.get('byoai') === '1',
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

function TopBar({ dark, onToggleDark, q, page }) {
  return (
    <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 32px 14px', borderBottom:'1px solid var(--rule)' }}>
      <div className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', display:'flex', alignItems:'baseline', gap:12 }}>
        <a href="index.html" style={{ color:'var(--ink)', textDecoration:'none' }}>standmeet</a>
        <span style={{ color:'var(--faint)' }}>/</span>
        <a href="index.html" style={{ color:'var(--muted)', textDecoration:'none' }}>{OWNER.handle}</a>
        <span style={{ color:'var(--faint)' }}>·</span>
        <span style={{ color:'var(--accent)' }}>{page ? page.slug : 'page'}</span>
      </div>
      <nav style={{ display:'flex', gap:24 }}>
        <a href="blog.html" className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', textDecoration:'none' }}>writing</a>
        <a href="index.html" className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', textDecoration:'none' }}>chat</a>
        <button onClick={onToggleDark} className="mono" style={{ fontSize:11, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)', background:'transparent', border:0, cursor:'pointer' }}>{dark ? 'light' : 'dark'}</button>
      </nav>
    </header>
  );
}

/* ── templates ─────────────────────────────────────────────────── */

function PressKitTemplate({ page }) {
  const d = page.data;
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:48, maxWidth:1080, margin:'0 auto', padding:'48px 24px 80px' }}>
      <div>
        <div className="headshot" />
        <div className="mono" style={{ fontSize:10, color:'var(--faint)', letterSpacing:'0.06em', marginTop:8 }}>{d.headshot_caption}</div>
      </div>
      <div>
        <div className="smallcaps" style={{ marginBottom:8 }}>press kit · download / quote</div>
        <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(48px,6vw,72px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:1, margin:0 }}>
          {OWNER.full}<span style={{ color:'var(--accent)' }}>.</span>
        </h1>
        <p className="reading" style={{ fontSize:19, color:'var(--muted)', marginTop:14, maxWidth:'30em' }}>
          A short anchor for press, podcast hosts, and event organizers. Bio variants below; lift any verbatim.
        </p>

        <section style={{ marginTop:36 }}>
          <SmallCaps>bio · pick a length</SmallCaps>
          <div style={{ display:'flex', flexDirection:'column', gap:14, marginTop:12 }}>
            {d.bios.map((b) => (
              <div key={b.length} className="bio-card" data-len={b.length}>
                <p className="reading" style={{ fontSize:16, color:'var(--ink)', margin:0, lineHeight:1.55, paddingRight:b.length === 'long' ? 0 : 80 }}>{b.text}</p>
                <div style={{ marginTop:10, display:'flex', justifyContent:'flex-end' }}>
                  <Btn kind="ghost" size="sm">copy</Btn>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop:36 }}>
          <SmallCaps>assets</SmallCaps>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10, marginTop:10 }}>
            {d.assets.map((a, i) => (
              <a key={i} href="#" style={{ textDecoration:'none', display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'10px 14px', border:'1px solid var(--rule)', borderRadius:3 }}>
                <div>
                  <div className="mono" style={{ fontSize:11.5, color:'var(--ink)', letterSpacing:'0.04em' }}>{a.label}</div>
                  <div className="mono" style={{ fontSize:9.5, color:'var(--faint)', marginTop:2 }}>{a.size}</div>
                </div>
                <span className="mono" style={{ fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)' }}>↓</span>
              </a>
            ))}
          </div>
        </section>

        <section style={{ marginTop:36, display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
          <div>
            <SmallCaps>links</SmallCaps>
            <ul style={{ listStyle:'none', padding:0, margin:'10px 0 0', display:'flex', flexDirection:'column', gap:6 }}>
              {d.links.map((l, i) => (
                <li key={i}>
                  <a href={l.url} className="mono" style={{ fontSize:12, color:'var(--accent)', textDecoration:'none', borderBottom:'1px solid color-mix(in oklab, var(--accent) 35%, transparent)' }}>{l.label} →</a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SmallCaps>contact</SmallCaps>
            <div style={{ marginTop:10, fontFamily:"'Newsreader',serif", fontSize:15, lineHeight:1.6 }}>
              <div><span style={{ color:'var(--muted)' }}>booking · </span><span style={{ color:'var(--ink)' }}>{d.contact.booking}</span></div>
              <div><span style={{ color:'var(--muted)' }}>agent · </span><span style={{ color:'var(--ink)' }}>{d.contact.agent}</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ListWithProseTemplate({ page }) {
  const d = page.data;
  return (
    <div style={{ maxWidth:760, margin:'0 auto', padding:'56px 24px 80px' }}>
      <SmallCaps>{page.slug}</SmallCaps>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(48px,6vw,72px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:0.98, marginTop:14 }}>
        {page.title}<span style={{ color:'var(--accent)' }}>.</span>
      </h1>
      <p style={{ fontFamily:"'Newsreader',serif", fontSize:21, lineHeight:1.55, color:'var(--muted)', marginTop:18, maxWidth:'34em' }}>
        {d.prose}
      </p>

      <div style={{ marginTop:48, display:'flex', flexDirection:'column', gap:40 }}>
        {d.lists.map((l) => (
          <section key={l.title}>
            <SmallCaps>{l.title}</SmallCaps>
            <div style={{ marginTop:10 }}>
              {l.items.map((it, i) => (
                <div key={i} className="talk-row">
                  <div className="mono" style={{ fontSize:11, color:'var(--muted)', letterSpacing:'0.06em' }}>{it.date}</div>
                  <div>
                    <div style={{ fontFamily:"'Newsreader',serif", fontSize:18, color:'var(--ink)' }}>{it.title}</div>
                    <div className="mono" style={{ fontSize:10.5, color:'var(--faint)', marginTop:4, letterSpacing:'0.06em' }}>{it.where}</div>
                  </div>
                  <div className="mono" style={{ fontSize:10, color: it.kind === 'public' ? 'var(--accent)' : 'var(--faint)', letterSpacing:'0.16em', textTransform:'uppercase' }}>
                    ● {it.kind}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MenuTemplate({ page }) {
  const d = page.data;
  return (
    <div style={{ maxWidth:880, margin:'0 auto', padding:'56px 24px 80px' }}>
      <SmallCaps>{page.slug}</SmallCaps>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(48px,6.5vw,80px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:0.98, marginTop:14 }}>
        {page.title}<span style={{ color:'var(--accent)' }}>.</span>
      </h1>
      <p style={{ fontFamily:"'Newsreader',serif", fontSize:21, lineHeight:1.55, color:'var(--muted)', marginTop:18, maxWidth:'36em' }}>
        {d.intro}
      </p>

      <div style={{ marginTop:48 }}>
        {d.items.map((it) => (
          <article key={it.no} className="menu-row">
            <div className="n">{it.no}</div>
            <div>
              <h3>{it.title}<span style={{ color:'var(--accent)' }}>.</span></h3>
              <p>{it.body}</p>
            </div>
          </article>
        ))}
      </div>

      <div style={{ marginTop:64, paddingTop:32, borderTop:'1px solid var(--rule)', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
        <div>
          <SmallCaps>start a conversation</SmallCaps>
          <p className="reading" style={{ fontSize:16, color:'var(--muted)', marginTop:6, maxWidth:'28em' }}>
            The fastest path is a code-request through the gate with the specific question.
          </p>
        </div>
        <a href="gate.html#request" className="sm-btn sm-btn-solid sm-btn-lg">request a code ↗</a>
      </div>
    </div>
  );
}

function AutoNowTemplate({ page }) {
  const d = page.data;
  return (
    <div style={{ maxWidth:760, margin:'0 auto', padding:'56px 24px 80px' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:24 }}>
        <SmallCaps>/now</SmallCaps>
        <div className="mono" style={{ fontSize:10, color:'var(--muted)', letterSpacing:'0.06em' }}>
          regenerated weekly · last updated {d.updated}
        </div>
      </div>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(48px,6vw,72px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:0.98 }}>
        What I'm doing now<span style={{ color:'var(--accent)' }}>.</span>
      </h1>

      <div className="reading" style={{ marginTop:32, fontSize:21, lineHeight:1.65, color:'var(--ink)' }}>
        {d.paragraphs.map((p, i) => <p key={i} style={{ marginBottom: i < d.paragraphs.length - 1 ? '1.4em' : 0 }}>{p}</p>)}
      </div>

      <Crosshair className="ad-card" style={{ marginTop:48, padding:'14px 18px' }}>
        <SmallCaps>how this page works</SmallCaps>
        <p className="reading" style={{ fontSize:14, color:'var(--muted)', marginTop:8, lineHeight:1.6 }}>
          A small AI digest of the latest <span style={{ color:'var(--ink)' }}>{d.pulled_from.length}</span> raw entries
          in sijie's corpus, paraphrased in his voice. Refreshed weekly. Sijie reviews each rebuild before it
          replaces the live version.
        </p>
        <div className="mono" style={{ fontSize:9.5, color:'var(--faint)', letterSpacing:'0.06em', marginTop:8 }}>
          drawn from · {d.pulled_from.map((p) => <span key={p} style={{ color:'var(--muted)', marginRight:8 }}>{p}</span>)}
        </div>
      </Crosshair>
    </div>
  );
}

function GatedView({ page }) {
  return (
    <div style={{ maxWidth:680, margin:'80px auto', padding:'0 24px', textAlign:'center' }}>
      <SmallCaps>gated page</SmallCaps>
      <h1 style={{ fontFamily:"'Newsreader',serif", fontSize:'clamp(40px,5.4vw,62px)', fontWeight:380, letterSpacing:'-0.022em', lineHeight:1.04, marginTop:10 }}>
        {page.title}<span style={{ color:'var(--accent)' }}>.</span>
      </h1>
      <p className="reading" style={{ fontSize:18, color:'var(--muted)', maxWidth:'34em', margin:'20px auto 0' }}>
        {page.blurb}
      </p>
      <p className="reading" style={{ fontSize:15, color:'var(--faint)', marginTop:14 }}>
        Sijie scopes this page to a small number of codes (advisor / investor). Enter a valid code or request access.
      </p>
      <div style={{ marginTop:32, display:'flex', justifyContent:'center', gap:14, flexWrap:'wrap' }}>
        <a href="gate.html" className="sm-btn sm-btn-outline">enter a code</a>
        <a href="gate.html#request" className="sm-btn sm-btn-accent">request access ↗</a>
      </div>
    </div>
  );
}

/* ── app ───────────────────────────────────────────────────────── */

function App() {
  const q = useQuery();
  const [dark, setDark] = useTheme();
  const page = PAGES.find((p) => p.slug === q.slug);

  if (!page) {
    return (
      <div>
        <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} />
        <div style={{ padding:'120px 24px', textAlign:'center' }}>
          <div style={{ fontFamily:"'Newsreader',serif", fontSize:40 }}>not found<span style={{ color:'var(--accent)' }}>.</span></div>
          <p className="reading" style={{ fontSize:16, color:'var(--muted)', marginTop:12 }}>
            no page matches <span className="mono">/p/{q.slug}</span>.
          </p>
          <a href="index.html" className="sm-btn sm-btn-outline" style={{ marginTop:24, display:'inline-block' }}>← home</a>
        </div>
      </div>
    );
  }

  const locked = page.visibility === 'gated' && !q.code;

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <TopBar dark={dark} onToggleDark={()=>setDark((d)=>!d)} q={q} page={page} />
      {window.SM && window.SM.SessionStrip && <window.SM.SessionStrip />}

      <main style={{ flex:1 }}>
        {locked ? <GatedView page={page} /> :
         page.template === 'press-kit'      ? <PressKitTemplate page={page} /> :
         page.template === 'list-with-prose' ? <ListWithProseTemplate page={page} /> :
         page.template === 'menu'             ? <MenuTemplate page={page} /> :
         page.template === 'auto-now'         ? <AutoNowTemplate page={page} /> :
         <div style={{ padding:'120px 24px', textAlign:'center' }}>
           <div style={{ fontFamily:"'Newsreader',serif", fontSize:36 }}>template not implemented<span style={{ color:'var(--accent)' }}>.</span></div>
           <p className="mono" style={{ color:'var(--muted)', marginTop:8 }}>{page.template}</p>
         </div>
        }
      </main>

      <footer style={{ borderTop:'1px solid var(--rule)', padding:'18px 32px', display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:8 }}>
        <div className="mono" style={{ fontSize:10.5, color:'var(--muted)', letterSpacing:'0.06em' }}>
          standmeet.com/{OWNER.handle}/p/{page.slug}
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
