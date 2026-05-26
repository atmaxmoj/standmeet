/* global React, ReactDOM, SM */
/* useState / useEffect / useRef / useMemo already destructured by sm-components.js
   (babel-standalone shares top-level scope across <script type="text/babel"> tags). */

const {
  Chip, Pill, SmallCaps, LiveDot, Kbd, Btn, Field, Input, Textarea, Segmented,
  Crosshair, Banner, Thinking, SpeakerLabel, Citations, Quota, MaskedSecret, CopyBtn,
  Sparkline, ImageThumb, FilePill, QRCode, ActivityTicker, TopBar, StickyComposer,
  Modal, Section,
} = SM;

const SECTIONS = [
  { id: 'foundation',  label: 'foundation',  hint: '01 · color · type · spacing' },
  { id: 'atoms',       label: 'atoms',       hint: '02 · chip · pill · btn · kbd' },
  { id: 'forms',       label: 'forms',       hint: '03 · field · segmented · textarea' },
  { id: 'feedback',    label: 'feedback',    hint: '04 · live · thinking · progress · quota' },
  { id: 'chat',        label: 'chat',        hint: '05 · speaker · citations · composer' },
  { id: 'data',        label: 'data',        hint: '06 · sparkline · thumb · masked · qr' },
  { id: 'frames',      label: 'frames',      hint: '07 · crosshair · banner · modal · ticker' },
  { id: 'organisms',   label: 'organisms',   hint: '08 · topbar · section · sticky composer' },
];

const PALETTE = [
  { name: 'paper',   role: 'page bg',          var: '--paper',   bg: 'var(--paper)',   border: true },
  { name: 'surface', role: 'raised',           var: '--surface', bg: 'var(--surface)', border: true },
  { name: 'raised',  role: 'deeper raised',    var: '--raised',  bg: 'var(--raised)',  border: true },
  { name: 'ink',     role: 'body text',        var: '--ink',     bg: 'var(--ink)',     text: 'var(--paper)' },
  { name: 'muted',   role: 'secondary',        var: '--muted',   bg: 'var(--muted)',   text: 'var(--paper)' },
  { name: 'faint',   role: 'tertiary',         var: '--faint',   bg: 'var(--faint)',   text: 'var(--ink)' },
  { name: 'rule',    role: 'divider',          var: '--rule',    bg: 'var(--rule)',    text: 'var(--ink)' },
  { name: 'accent',  role: 'vermillion · primary', var: '--accent', bg: 'var(--accent)', text: 'var(--paper)' },
  { name: 'amber',   role: 'cover · highlight', var: '--amber',   bg: 'var(--amber)',   text: 'var(--paper)' },
  { name: 'violet',  role: 'private · on-request', var: '--violet', bg: 'var(--violet)', text: 'var(--paper)' },
  { name: 'acid',    role: 'fresh · health',   var: '--acid',    bg: 'var(--acid)',    text: 'var(--paper)' },
];

const TYPE_SCALE = [
  { label: 'display-xl',  font: 'serif', size: 72, weight: 380, tracking: '-0.022em', sample: 'Writing.' },
  { label: 'display-l',   font: 'serif', size: 48, weight: 400, tracking: '-0.018em', sample: 'Ask sijie.' },
  { label: 'h-m',         font: 'serif', size: 30, weight: 400, tracking: '-0.012em', sample: 'What you actually do' },
  { label: 'h-s',         font: 'serif', size: 22, weight: 500, tracking: '-0.012em', sample: 'evaluation is the product' },
  { label: 'body-xl',     font: 'serif', size: 21, weight: 380, tracking: '-0.003em', sample: 'Most ML teams treat their evaluation suite as a finished thing.' },
  { label: 'body-l',      font: 'serif', size: 18, weight: 380, tracking: '-0.003em', sample: 'A note that helps you see the rest.' },
  { label: 'body',        font: 'serif', size: 16, weight: 380, tracking: '-0.003em', sample: 'Default reading size for ui copy.' },
  { label: 'mono-13',     font: 'mono',  size: 13, weight: 400, tracking: '0.04em',   sample: 'sm_live_5kJ7d3v9aQR2cXBfYpMwH8tNL4uVe' },
  { label: 'mono-11 · label', font: 'mono', size: 11, weight: 400, tracking: '0.14em', sample: 'ASK · LIVE · DRAWN FROM',  upper: true },
  { label: 'mono-10 · smallcaps', font: 'mono', size: 10, weight: 400, tracking: '0.18em', sample: 'BROWSE BY TAG', upper: true },
];

const TICKER = [
  { t: '14:38', evt: 'ingest', detail: 'claude · 3 entries' },
  { t: '14:22', evt: 'visitor', detail: 'OAEN-3K2 · David Chen · 7 turns' },
  { t: '13:54', evt: 'private-hit', detail: 'A16Z-9V1 asked about runway' },
  { t: '13:11', evt: 'promote', detail: 'r-298 → wiki' },
  { t: '12:40', evt: 'job', detail: 'greenhouse · 14 new openings' },
];

const CITATIONS = [
  { date: '2025.04.22', title: 'on AI replacing engineers' },
  { date: '2024.11.03', title: 'the translation layer' },
];

const PROMPTS = [
  'Walk me through your background.',
  'What did you actually own at your last role?',
];

function Card({ title, kicker, spec, children, full }) {
  return (
    <div className="ds-panel" style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <div>
          {kicker && <div className="smallcaps mb-1">{kicker}</div>}
          <h3 style={{ fontFamily: 'Newsreader, serif', fontSize: 20, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{title}</h3>
        </div>
        {spec && <div className="ds-spec">{spec}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Foundation() {
  return (
    <Section kicker="01 · foundation" title="foundation" count="palette · type · spacing">
      <div className="ds-grid">
        <Card kicker="palette" title="11 named colors" spec="defined as CSS custom properties · auto-flip on .dark" full>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {PALETTE.map((c) => (
              <div key={c.name} className="swatch" style={{ background: c.bg, color: c.text || 'var(--ink)', border: c.border ? '1px solid var(--rule)' : 'none' }}>
                <div>{c.name}</div>
                <div className="v" style={{ color: c.text ? 'rgba(255,255,255,0.7)' : 'var(--muted)' }}>{c.var} · {c.role}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card kicker="type" title="two-family scale" spec="Newsreader + JetBrains Mono · weights 380–500" full>
          {TYPE_SCALE.map((t) => (
            <div key={t.label} className="type-row">
              <div className="lab">{t.label}</div>
              <div style={{ fontFamily: t.font === 'mono' ? "'JetBrains Mono',monospace" : "'Newsreader',serif", fontSize: t.size, fontWeight: t.weight, letterSpacing: t.tracking, textTransform: t.upper ? 'uppercase' : 'none', lineHeight: 1.2, color: 'var(--ink)' }}>
                {t.sample}
              </div>
              <div className="num">{t.size}px · {t.weight}</div>
            </div>
          ))}
        </Card>

        <Card kicker="spacing" title="rhythm" spec="4px base · 8 / 12 / 16 / 24 / 32 / 48 / 80">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            {[4, 8, 12, 16, 24, 32, 48, 80].map((s) => (
              <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: s, height: s, background: 'var(--ink)', borderRadius: 1 }} />
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>{s}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card kicker="rules" title="hairlines" spec="all dividers use --rule · 1px">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ height: 1, background: 'var(--rule)' }} />
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>1px solid var(--rule)</div>
            <div style={{ height: 1, background: 'var(--rule)', opacity: 0.6 }} />
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>rule-soft · 60% opacity</div>
            <div style={{ height: 0, borderTop: '1px dashed var(--rule)' }} />
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em' }}>1px dashed · leader lines, dropzone</div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Atoms() {
  return (
    <Section kicker="02 · atoms" title="atoms" count="chip · pill · btn · kbd · live">
      <div className="grid-2">
        <Card kicker="chip" title="<Chip>" spec='for tags · scope · file kind · 10px mono · cycles include/exclude/silent'>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Chip>thinking</Chip>
            <Chip>lucerna</Chip>
            <Chip active>eval</Chip>
            <Chip tone="private">private</Chip>
            <Chip tone="private" active>× fundraising</Chip>
            <Chip onClick={() => {}}>onClick · hover ink</Chip>
          </div>
          <div className="ds-spec">props: tone "neutral" | "private" · active · onClick</div>
        </Card>

        <Card kicker="pill" title="<Pill>" spec='for status · accent / violet / amber · rounded'>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Pill tone="accent">live · ready</Pill>
            <Pill tone="violet">private · layered</Pill>
            <Pill tone="amber">draft · staged</Pill>
            <Pill>neutral · default</Pill>
          </div>
          <div className="ds-spec">props: tone "neutral" | "accent" | "violet" | "amber" · dot</div>
        </Card>

        <Card kicker="btn" title="<Btn>" spec='4 kinds × 3 sizes · all mono uppercase · always show intent'>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
            <Btn>ghost</Btn>
            <Btn kind="outline">outline</Btn>
            <Btn kind="solid">solid · primary</Btn>
            <Btn kind="accent">accent · alarm</Btn>
            <Btn kind="danger">danger · destruct</Btn>
            <Btn disabled>disabled</Btn>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 items-baseline">
            <Btn size="sm" kind="outline">sm · 10.5px</Btn>
            <Btn kind="outline">md · 11px</Btn>
            <Btn size="lg" kind="solid">lg · 12px</Btn>
          </div>
          <div className="ds-spec">kind: ghost · outline · solid · accent · danger</div>
        </Card>

        <Card kicker="live · kbd" title="status atoms" spec='cmd hints + heartbeat'>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline' }}>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <LiveDot /> live · pulsing
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Kbd>/</Kbd> ask
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Kbd>esc</Kbd> dismiss
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Kbd>⌘</Kbd>+<Kbd>k</Kbd> command bar
            </span>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Forms() {
  const [seg, setSeg] = useState('regular');
  const [scope, setScope] = useState({ thinking: true, lucerna: true, fundraising: 'exclude' });
  return (
    <Section kicker="03 · forms" title="forms" count="field · segmented · 3-state scope">
      <div className="grid-2">
        <Card kicker="field" title="<Field> + <Input>" spec='mono label · serif body input · bottom-rule emphasis'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="label · plain text">
              <Input defaultValue="" placeholder="placeholder text" />
            </Field>
            <Field label="label · with hint" hint="used for code lookup">
              <Input mono defaultValue="OAEN-3K2" />
            </Field>
            <Field label="long body" hint="multi-line">
              <Textarea defaultValue="This is a multi-line textarea using the same bottom-rule treatment. Resize is vertical only." />
            </Field>
            <Field label="password · masked" required>
              <Input type="password" defaultValue="hunter2hunter2" />
            </Field>
          </div>
        </Card>

        <Card kicker="segmented" title="<Segmented>" spec='2–4 mutually-exclusive options · solid ink on'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="density">
              <Segmented value={seg} options={['tight', 'regular', 'relaxed']} onChange={setSeg} />
            </Field>
            <Field label="expires">
              <Segmented value="30 days" options={['7 days', '30 days', '90 days', 'never']} onChange={() => {}} />
            </Field>
            <Field label="theme">
              <Segmented value="light" options={['light', 'dark']} onChange={() => {}} />
            </Field>
          </div>
        </Card>

        <Card kicker="3-state scope" title="include / exclude / silent" spec="click to include · again to exclude · third click silent. used in access-code scope and BYOAI editor.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Chip active onClick={() => {}}>✓ thinking</Chip>
            <Chip active onClick={() => {}}>✓ lucerna</Chip>
            <Chip onClick={() => {}}>work</Chip>
            <Chip onClick={() => {}}>product</Chip>
            <Chip tone="private" active onClick={() => {}}>× fundraising</Chip>
            <Chip tone="private" active onClick={() => {}}>× private</Chip>
            <Chip onClick={() => {}}>career</Chip>
          </div>
          <div className="ds-spec">filled ink = included · vermillion = excluded · outline = silent</div>
        </Card>

        <Card kicker="dropzone" title="paste · drag · attach" spec="dashed border + crosshair corners + file pill on drop">
          <div style={{ border: '1px dashed var(--rule)', padding: 16, position: 'relative' }}>
            <span style={{ position: 'absolute', top: -1, left: -1, width: 10, height: 10, borderTop: '1px solid var(--accent)', borderLeft: '1px solid var(--accent)' }} />
            <span style={{ position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderTop: '1px solid var(--accent)', borderRight: '1px solid var(--accent)' }} />
            <span style={{ position: 'absolute', bottom: -1, left: -1, width: 10, height: 10, borderBottom: '1px solid var(--accent)', borderLeft: '1px solid var(--accent)' }} />
            <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderBottom: '1px solid var(--accent)', borderRight: '1px solid var(--accent)' }} />
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>quick dump · paste · drag · attach</div>
            <Textarea rows={2} placeholder="paste a thought, or drop an image / audio file..." defaultValue="" style={{ marginTop: 10 }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 10 }}>
              <FilePill media={{ kind: 'image', label: 'IMG_8821.jpg' }} onRemove={() => {}} />
              <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.1em' }}>1840 kb · 3024×4032</span>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Feedback() {
  return (
    <Section kicker="04 · feedback" title="feedback" count="loading · progress · quota">
      <div className="grid-2">
        <Card kicker="loading" title="<Thinking>" spec="3-dot wave · used during RAG retrieval">
          <Thinking />
          <div style={{ marginTop: 18 }}>
            <Thinking label="warming up your model" />
          </div>
          <div className="ds-spec">use any label · default 'retrieving'</div>
        </Card>

        <Card kicker="progress" title="<Quota>" spec="ink fill turns vermillion at ≥80%">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Quota used={12} max={50} label="turns · OAEN-3K2" />
            <Quota used={9} max={10} label="sessions · OAEN-3K2" />
            <Quota used={47} max={50} label="turns · A16Z-9V1" />
          </div>
        </Card>

        <Card kicker="banners" title="<Banner>" spec="accent · violet · accent-soft for byoai / coded / system warnings" full>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Banner tone="accent" right={[<a key="x" href="#" style={{ color: 'var(--faint)' }}>exit byoai</a>]}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <LiveDot /> byoai mode
              </span>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <span style={{ color: 'var(--muted)' }}>model · claude</span>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <span style={{ color: 'var(--muted)' }}>public scope</span>
            </Banner>
            <Banner tone="accent" right={[<a key="x" href="#" style={{ color: 'var(--faint)' }}>exit session</a>]}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <LiveDot /> openai eng loop
              </span>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <span style={{ color: 'var(--muted)' }}>code · OAEN-3K2</span>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <span style={{ color: 'var(--muted)' }}>you · <span style={{ color: 'var(--ink)', textTransform: 'none', letterSpacing: '0.04em' }}>David Chen</span></span>
            </Banner>
            <Banner tone="violet">
              <span style={{ color: 'var(--violet)' }}>● demo mode</span>
              <span style={{ color: 'var(--faint)' }}>·</span>
              <span style={{ color: 'var(--muted)', textTransform: 'none', letterSpacing: '0.04em' }}>not signed in · changes don't persist</span>
            </Banner>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Chat() {
  return (
    <Section kicker="05 · chat" title="chat" count="speaker · citations · composer · tool">
      <div className="grid-2">
        <Card kicker="speakers" title="<SpeakerLabel>" spec="four roles · mono 10.5px uppercase">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SpeakerLabel role="you" meta="14:32 · from menu" />
            <SpeakerLabel role="ai" meta="ready" />
            <SpeakerLabel role="system" meta="instance v1.4.0" />
            <SpeakerLabel role="tool" meta="calendar.find_slots" />
          </div>
        </Card>

        <Card kicker="citations" title="<Citations>" spec="dated source list under any AI answer">
          <Citations items={CITATIONS} />
        </Card>

        <Card kicker="tool call" title="ToolCall block" spec="rendered inline in the transcript when the AI invokes a connector" full>
          <SpeakerLabel role="tool" meta="calendar.find_slots" />
          <div style={{ marginTop: 8, border: '1px solid var(--rule)', borderRadius: 3, background: 'color-mix(in oklab, var(--paper) 60%, transparent)' }}>
            <div className="mono" style={{ padding: '6px 12px', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              <span>⌖ tool · calendar.find_slots</span>
              <span style={{ color: 'var(--faint)' }}>openai connector</span>
            </div>
            <div className="mono" style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '0.04em' }}>
              {[
                { d: 'Tue · May 19', t: '10:30–11:00 PT' },
                { d: 'Wed · May 20', t: '14:00–14:30 PT' },
                { d: 'Thu · May 21', t: '09:00–09:30 PT' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 12, padding: '4px 0', borderBottom: i < 2 ? '1px solid color-mix(in oklab, var(--rule) 50%, transparent)' : 'none', color: 'var(--ink)' }}>
                  <span>{s.d}</span>
                  <span style={{ color: 'var(--muted)' }}>{s.t}</span>
                  <span style={{ color: 'var(--faint)', fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase' }}>offered</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, border: '1px solid var(--accent)', opacity: 0.85, borderRadius: 3 }}>
            <div className="mono" style={{ padding: '6px 12px', borderBottom: '1px solid color-mix(in oklab, var(--accent) 40%, var(--rule))', display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              <span>✓ booked · calendar.book</span>
              <span style={{ color: 'var(--muted)', textTransform: 'lowercase', letterSpacing: '0.06em' }}>sijie-david-may20.ics ↓</span>
            </div>
          </div>
        </Card>

        <Card kicker="composer" title="<StickyComposer>" spec="bottom-pinned · accent ›' cursor · prompt chips above" full>
          <StickyComposer
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="ask sijie's ai…"
            prompts={PROMPTS}
            onPickPrompt={() => {}}
          />
        </Card>
      </div>
    </Section>
  );
}

function Data() {
  const [revealed, setRevealed] = useState(false);
  return (
    <Section kicker="06 · data" title="data" count="sparkline · thumb · qr · secret">
      <div className="grid-2">
        <Card kicker="sparkline" title="<Sparkline>" spec="ink columns · used for ingest rate / corpus growth">
          <Sparkline data={[4, 7, 2, 6, 11, 3, 8, 5, 9, 12, 6, 14, 9, 17]} width={220} height={48} />
          <div className="mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
            <span>−14d</span><span>today · 17</span>
          </div>
        </Card>

        <Card kicker="qr" title="<QRCode>" spec="finder squares vermillion · paper bg · scaleable">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
            <QRCode value="https://standmeet.com/sijie?c=OAEN-3K2" size={160} />
            <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.7, color: 'var(--muted)', letterSpacing: '0.04em' }}>
              <div style={{ color: 'var(--ink)' }}>OAEN-3K2</div>
              <div style={{ color: 'var(--faint)' }}>standmeet.com/sijie?c=OAEN-3K2</div>
              <div style={{ marginTop: 8 }}>
                <CopyBtn text="https://standmeet.com/sijie?c=OAEN-3K2" />
              </div>
            </div>
          </div>
        </Card>

        <Card kicker="secret" title="<MaskedSecret>" spec="for api tokens · masked by default · only revealed once after create" full>
          <MaskedSecret
            value="sm_live_5kJ7d3v9aQR2cXBfYpMwH8tNL4uVe"
            revealed={revealed}
            onReveal={() => setRevealed(!revealed)}
            onCopy={() => {}}
          />
          <div className="ds-spec">props: value · revealed · onReveal · onCopy</div>
        </Card>

        <Card kicker="media" title="<ImageThumb> · <FilePill>" spec="diagonal hatch placeholder · always shows kind tag">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <ImageThumb kind="image" label="IMG" dims="3024×4032" sizeKb={1840} />
            <ImageThumb kind="file" label="PDF" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FilePill media={{ kind: 'image', label: 'whiteboard-eval-rubric.png' }} />
              <FilePill media={{ kind: 'audio', label: 'memo-2026-05-15.m4a' }} />
              <FilePill media={{ kind: 'file', label: 'deck-investor-q2.pdf' }} />
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Frames() {
  const [modal, setModal] = useState(false);
  return (
    <Section kicker="07 · frames" title="frames" count="crosshair · ticker · modal">
      <div className="grid-2">
        <Card kicker="crosshair" title="<Crosshair>" spec="adds vermillion corner ticks · used on api / code / setup panels">
          <Crosshair scanline style={{ border: '1px solid var(--rule)', padding: 16, background: 'color-mix(in oklab, var(--surface) 60%, transparent)' }}>
            <SmallCaps>▶ corpus pulse · 14d</SmallCaps>
            <div style={{ marginTop: 8, fontFamily: 'Newsreader, serif', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em' }}>83</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginTop: 4 }}>entries · last 7d · ↑ 14 vs prev</div>
          </Crosshair>
        </Card>

        <Card kicker="ticker" title="<ActivityTicker>" spec="topbar inline marquee · pauses on hover">
          <div style={{ border: '1px solid var(--rule)', padding: '12px 14px', overflow: 'hidden', display: 'flex', alignItems: 'center', height: 44, background: 'color-mix(in oklab, var(--paper) 80%, transparent)' }}>
            <ActivityTicker items={TICKER} />
          </div>
          <div className="ds-spec">events: ingest · visitor · private-hit · promote · connector · job</div>
        </Card>

        <Card kicker="modal" title="<Modal>" spec="ESC to close · click-outside dismiss · max-h 70vh body scroll" full>
          <Btn kind="solid" onClick={() => setModal(true)}>open the modal</Btn>
          <Modal
            open={modal}
            onClose={() => setModal(false)}
            kicker="example · style study"
            title="What a modal looks like."
            footer={[
              <Btn key="c" kind="ghost" onClick={() => setModal(false)}>cancel</Btn>,
              <Btn key="s" kind="solid" onClick={() => setModal(false)}>confirm</Btn>,
            ]}
          >
            <p className="reading" style={{ fontSize: 16 }}>
              Body copy lives here. Newsreader serif, 16–18px, generous line-height. Long content scrolls within the modal body, never the page beneath.
            </p>
            <div style={{ marginTop: 16 }}>
              <Field label="example field">
                <Input placeholder="type something…" />
              </Field>
            </div>
          </Modal>
        </Card>
      </div>
    </Section>
  );
}

function Organisms() {
  return (
    <Section kicker="08 · organisms" title="organisms" count="topbar · section · sticky composer">
      <div className="ds-grid">
        <Card kicker="topbar" title="<TopBar>" spec="left brand · live · ticker · right user/actions" full>
          <TopBar
            left={[
              <span key="b" className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}>standmeet</span>,
              <span key="s" className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>/</span>,
              <span key="h" className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>admin · sijie</span>,
              <span key="l" style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <LiveDot />
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>LIVE</span>
              </span>,
            ]}
            ticker={TICKER}
            right={[
              <span key="m" className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.04em' }}>
                <span style={{ color: 'var(--ink)' }}>1,247</span> entries · <span style={{ color: 'var(--ink)' }}>84</span> mb
              </span>,
              <a key="p" href="#" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>public ↗</a>,
              <a key="g" href="#" className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>gate ↗</a>,
              <span key="o" className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.04em', paddingLeft: 16, borderLeft: '1px solid var(--rule)' }}>sijie@standmeet.com</span>,
              <button key="s" className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', letterSpacing: '0.14em', textTransform: 'uppercase', background: 'transparent', border: 0, cursor: 'pointer' }}>sign out</button>,
            ]}
          />
        </Card>

        <Card kicker="section" title="<Section>" spec="kicker · large serif title · count · right action" full>
          <Section
            kicker="surface 1 · sample"
            title="raw"
            count="12 unprocessed"
            action={<Btn kind="solid">＋ new entry</Btn>}
          >
            <p className="reading" style={{ fontSize: 15, color: 'var(--muted)' }}>
              Section bodies start here. This pattern is used for every admin tab plus the visitor archive views.
            </p>
          </Section>
        </Card>
      </div>
    </Section>
  );
}

const RENDERERS = {
  foundation: Foundation,
  atoms: Atoms,
  forms: Forms,
  feedback: Feedback,
  chat: Chat,
  data: Data,
  frames: Frames,
  organisms: Organisms,
};

function App() {
  const [section, setSection] = useState('foundation');
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const Renderer = RENDERERS[section];

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        left={[
          <a key="b" href="index.html" className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}>standmeet</a>,
          <span key="s" className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>/</span>,
          <span key="d" className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>design system</span>,
          <span key="l" style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <LiveDot />
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>v1.0</span>
          </span>,
        ]}
        right={[
          <a key="a" href="admin.html" className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>admin ↗</a>,
          <a key="b" href="blog.html" className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>blog ↗</a>,
          <button key="t" onClick={() => setDark((d) => !d)} className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase', background: 'transparent', border: 0, cursor: 'pointer' }}>
            {dark ? 'light' : 'dark'}
          </button>,
        ]}
      />

      <div className="flex-1 flex">
        <nav style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--rule)', padding: '32px 24px', position: 'sticky', top: 56, alignSelf: 'flex-start', height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
          <div className="smallcaps mb-3">browse</div>
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              onClick={(e) => { e.preventDefault(); setSection(s.id); }}
              href={'#' + s.id}
              className={'ds-nav-link ' + (section === s.id ? 'active' : '')}
            >
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
              <div style={{ marginLeft: 24, marginTop: 2, fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>{s.hint.replace(/^\d+\s·\s/, '')}</div>
            </a>
          ))}

          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
            <div className="smallcaps mb-3">manifest</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.04em', lineHeight: 1.7 }}>
              <div>· sm-tokens.css</div>
              <div>· sm-components.js</div>
              <div>· 11 colors</div>
              <div>· 2 type families</div>
              <div>· 24 components</div>
            </div>
          </div>
        </nav>

        <main className="flex-1 px-12 py-10" style={{ maxWidth: 1100 }}>
          <Renderer />

          <footer style={{ marginTop: 80, paddingTop: 24, borderTop: '1px solid var(--rule)' }} className="mono">
            <div style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.06em', lineHeight: 1.8 }}>
              imported by every surface as <span style={{ color: 'var(--ink)' }}>sm-tokens.css</span> + <span style={{ color: 'var(--ink)' }}>sm-components.js</span> ·
              changes here propagate to admin / blog / gate / login / index automatically.
            </div>
            <div style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 8 }}>
              standmeet · self-hosted retrieval for personal corpora · all components MIT
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
