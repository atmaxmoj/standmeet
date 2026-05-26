/* global React */

/* sm-components.js — canonical React component library for StandMeet
 *
 * Loaded after React via Babel. Exposes a single namespace `window.SM` carrying
 * every reusable atom / molecule / organism. Each surface (admin / blog / etc)
 * imports this file and pulls what it needs:
 *
 *     const { Chip, Pill, Btn, TopBar, Composer } = window.SM;
 *
 * The visual styling lives in sm-tokens.css. This file is structure + behavior.
 */

const { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } = React;
const $ = React.createElement;

/* ───────────────────────────── ATOMS ──────────────────────────────── */

function Chip({ children, tone = 'neutral', active = false, onClick, className = '' }) {
  const cls =
    'sm-chip' +
    (tone === 'private' ? ' is-private' : '') +
    (active ? ' is-active' : '') +
    (onClick ? ' is-clickable' : '') +
    (className ? ' ' + className : '');
  return $('span', { className: cls, onClick, role: onClick ? 'button' : undefined }, children);
}

function Pill({ children, tone = 'neutral', dot = true, className = '' }) {
  const cls = 'sm-pill ' + (tone !== 'neutral' ? 'is-' + tone : '') + ' ' + className;
  return $('span', { className: cls.trim() }, [
    dot && $('span', { key: 'd', className: 'sm-dot' }),
    $('span', { key: 't' }, children),
  ]);
}

function SmallCaps({ children, extraSpaced = false, className = '' }) {
  return $('span', { className: (extraSpaced ? 'smallcaps-x' : 'smallcaps') + ' ' + className }, children);
}

function LiveDot({ className = '' }) {
  return $('span', { className: 'sm-live-dot ' + className });
}

function Kbd({ children }) {
  return $('span', { className: 'sm-kbd' }, children);
}

function Btn({ children, onClick, kind = 'ghost', size = 'md', disabled, type = 'button', className = '' }) {
  const base = 'sm-btn sm-btn-' + kind + (size === 'sm' ? ' sm-btn-sm' : size === 'lg' ? ' sm-btn-lg' : '');
  return $('button', { type, disabled, onClick, className: base + ' ' + className }, children);
}

function Field({ label, hint, required, children }) {
  return $('label', { className: 'sm-field' }, [
    label && $('span', { key: 'l', className: 'sm-field-label' }, [
      $('span', { key: 't' }, label),
      required && $('span', { key: 'r', style: { color: 'var(--accent)' } }, '*'),
      hint && $('span', { key: 'h', className: 'sm-field-hint' }, '· ' + hint),
    ]),
    $('span', { key: 'c' }, children),
  ]);
}

function Input(props) {
  const { mono, className = '', ...rest } = props;
  return $('input', { type: 'text', autoComplete: 'off', spellCheck: 'false', ...rest, className: 'sm-field-input ' + (mono ? 'sm-mono ' : '') + className });
}

function Textarea(props) {
  const { className = '', rows = 3, ...rest } = props;
  return $('textarea', { rows, ...rest, className: 'sm-field-input ' + className, style: { resize: 'vertical', minHeight: 60, ...rest.style } });
}

function Segmented({ value, options, onChange }) {
  return $('div', { className: 'sm-seg' },
    options.map((o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : o.label;
      return $('button', { key: v, onClick: () => onChange(v), className: value === v ? 'is-on' : '' }, l);
    })
  );
}

function Crosshair({ scanline, children, className = '', style }) {
  return $('div', { className: 'sm-crosshair ' + (scanline ? 'sm-scanline ' : '') + className, style },
    [$('span', { key: 't', className: 'sm-cx-tl' }), $('span', { key: 'b', className: 'sm-cx-br' }), children]
  );
}

function Banner({ tone = 'accent', children, right }) {
  const cls = 'sm-banner' + (tone === 'violet' ? ' sm-banner-violet' : '');
  return $('div', { className: cls },
    [
      $('div', { key: 'l', style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' } }, children),
      right && $('div', { key: 'r', style: { display: 'flex', alignItems: 'baseline', gap: 12 } }, right),
    ]
  );
}

function Thinking({ label = 'retrieving' }) {
  return $('div', { className: 'mono', style: { color: 'var(--muted)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginTop: 8 } }, [
    label + ' ',
    $('span', { key: 1, className: 'sm-dot' }, '·'),
    $('span', { key: 2, className: 'sm-dot' }, '·'),
    $('span', { key: 3, className: 'sm-dot' }, '·'),
  ]);
}

/* ── SessionStrip · pinned under topbar on every visitor surface ──── */
/* Subscribes to window.SMSession + the sm-session-changed event so the
 * gauge updates live when the visitor asks something on any other page
 * (same tab) or another tab (storage event). Self-contained: no props. */

function SessionStrip() {
  const [s, setS] = useState(() => (window.SMSession ? window.SMSession.current() : null));
  useEffect(() => {
    const refresh = () => setS(window.SMSession ? window.SMSession.current() : null);
    window.addEventListener('sm-session-changed', refresh);
    window.addEventListener('storage', (e) => { if (!e.key || e.key === 'standmeet-session') refresh(); });
    return () => {
      window.removeEventListener('sm-session-changed', refresh);
    };
  }, []);

  if (!s || (!s.code && !s.byoai)) return null;

  const pct = s.max > 0 ? Math.min(100, (s.used / s.max) * 100) : 0;
  const warn = s.max > 0 && pct >= 80;
  const cls = 'sm-session-strip' + (s.byoai ? ' is-byoai' : '') + (warn ? ' is-warn' : '');

  return $('div', { className: cls }, [
    $('div', { key: 'l', className: 'left' }, [
      $('span', { key: 'd', className: 'sm-live-dot' }),
      s.byoai
        ? $('span', { key: 'm', className: 'ai-mode' }, 'byoai · ' + s.byoaiProvider)
        : $('span', { key: 'm', className: 'label' }, s.label || 'invited'),
      $('span', { key: 's', style: { color: 'var(--faint)' } }, '·'),
      $('span', { key: 'c', style: { color: 'var(--muted)' } }, s.byoai ? 'public scope' : 'code · ' + s.code),
      s.visitor && $('span', { key: 's2', style: { color: 'var(--faint)' } }, '·'),
      s.visitor && $('span', { key: 'v', className: 'meta' }, 'you · ' + s.visitor),
    ]),
    $('div', { key: 'r', className: 'right' }, [
      s.max > 0 && $('span', { key: 'g', className: 'gauge', title: 'session quota' }, [
        $('span', { key: 't', className: 'gauge-text' }, [
          $('span', { key: 'u', style: { color: warn ? 'var(--accent)' : 'var(--ink)' } }, String(s.used)),
          ' / ',
          $('span', { key: 'M' }, String(s.max)),
          $('span', { key: 'l', style: { color: 'var(--faint)', marginLeft: 6, letterSpacing: '0.04em', textTransform: 'lowercase' } }, 'turns'),
        ]),
        $('span', { key: 'b', className: 'gauge-bar' },
          $('span', { className: 'gauge-fill', style: { width: pct + '%', display: 'block' } })
        ),
      ]),
      s.byoai && $('span', { key: 'g2', className: 'gauge-text', style: { color: 'var(--violet)' } }, 'visitor-paid · unlimited'),
      $('span', { key: 'sep', style: { color: 'var(--faint)' } }, '·'),
      warn && !s.byoai && $('a', { key: 'rq', href: 'gate.html#request', className: 'link', style: { color: 'var(--accent)' } }, 'request more ↗'),
      $('a', { key: 'x', href: '?', className: 'link exit' }, 'exit session'),
    ]),
  ]);
}

/* ───────────────────────────── MOLECULES ──────────────────────────── */

function SpeakerLabel({ role, meta }) {
  const cls = 'sm-speaker';
  const who =
    role === 'ai'     ? $('span', { key: 'w', className: 'sm-speaker-ai' }, "sijie's ai")
    : role === 'system' ? $('span', { key: 'w', className: 'sm-speaker-system' }, "system")
    : role === 'tool' ? $('span', { key: 'w', className: 'sm-speaker-ai' }, '⌖ tool')
    : $('span', { key: 'w', className: 'sm-speaker-who' }, role || 'you');
  return $('div', { className: cls }, [
    who,
    meta && $('span', { key: 'm', className: 'sm-speaker-meta' }, '· ' + meta),
  ]);
}

function Citations({ items }) {
  if (!items || !items.length) return null;
  return $('div', { className: 'sm-citations-list', style: { marginTop: 16 } }, [
    $(SmallCaps, { key: 'h' }, 'drawn from'),
    $('ul', { key: 'u', style: { listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 3 } },
      items.map((c, i) => $('li', { key: i, className: 'sm-citation' }, [
        $('span', { key: 'd', className: 'sm-citation-date' }, c.date),
        $('span', { key: 't', className: 'sm-citation-title' }, c.title),
      ]))
    ),
  ]);
}

function Quota({ used, max, label = 'quota' }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const warn = pct >= 80;
  return $('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
    $('div', { key: 'h', className: 'sm-gauge' + (warn ? ' is-warn' : '') }, [
      $('span', { key: 'l' }, label),
      $('span', { key: 'v', className: 'sm-gauge-value' }, used + ' / ' + max),
    ]),
    $('div', { key: 'p', className: 'sm-progress' },
      $('div', { className: 'sm-progress-fill', style: { width: pct + '%', background: warn ? 'var(--accent)' : 'var(--ink)' } })
    ),
  ]);
}

function MaskedSecret({ value, revealed, onReveal, onCopy }) {
  const masked = value.slice(0, 10) + '·'.repeat(18) + value.slice(-4);
  return $('div', { className: 'sm-secret-row' }, [
    $('code', { key: 's', className: 'sm-secret-mask' }, revealed ? value : masked),
    $('button', { key: 'r', className: 'sm-btn sm-btn-ghost sm-btn-sm', onClick: onReveal }, revealed ? 'hide' : 'reveal'),
    onCopy && $('button', { key: 'c', className: 'sm-btn sm-btn-ghost sm-btn-sm', onClick: onCopy }, 'copy'),
  ]);
}

function CopyBtn({ text, label = 'copy', size = 'sm' }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  };
  return $(Btn, { kind: copied ? 'accent' : 'ghost', size, onClick }, copied ? 'copied ✓' : label);
}

function Sparkline({ data, width = 120, height = 28, color }) {
  const max = Math.max(1, ...data);
  return $('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 1, width, height } },
    data.map((v, i) => $('div', {
      key: i,
      style: {
        flex: 1,
        height: (v / max) * 100 + '%',
        background: color || 'var(--ink)',
        opacity: 0.78,
      },
    }))
  );
}

function ImageThumb({ kind = 'image', label, dims, sizeKb }) {
  return $(Crosshair, { className: 'sm-thumb' },
    label && $('span', { className: 'sm-thumb-tag' }, label + (dims ? ' · ' + dims : '') + (sizeKb ? ' · ' + sizeKb + ' kb' : ''))
  );
}

function FilePill({ media, onRemove }) {
  const icon = media.kind === 'image' ? '⬚' : media.kind === 'audio' ? '◉' : '▤';
  return $('span', { className: 'sm-chip is-private' }, [
    $('span', { key: 'i', style: { fontSize: 11 } }, icon),
    $('span', { key: 'l', style: { textTransform: 'lowercase' } }, media.label),
    onRemove && $('button', {
      key: 'r', onClick: onRemove,
      style: { marginLeft: 4, color: 'var(--muted)', background: 'transparent', border: 0, cursor: 'pointer' },
    }, '×'),
  ]);
}

/* ─────────────────────────── QR CODE ──────────────────────────────── */

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
    } catch (e) { return null; }
  }, [value]);

  if (!data) {
    return $('div', {
      className: 'mono',
      style: { width: size, height: size, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 9, border: '1px solid var(--rule)' },
    }, 'qr…');
  }

  const { n, grid } = data;
  const total = n + quiet * 2;
  const cell = size / total;
  const offset = quiet * cell;
  const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r][c]) continue;
      cells.push({ r, c, finder: isFinder(r, c) });
    }
  }

  return $('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, shapeRendering: 'crispEdges', style: { display: 'block' } }, [
    $('rect', { key: 'bg', width: size, height: size, fill: 'var(--paper)' }),
    ...cells.map(({ r, c, finder }, i) => $('rect', {
      key: i,
      x: offset + c * cell,
      y: offset + r * cell,
      width: cell + 0.4,
      height: cell + 0.4,
      fill: finder ? 'var(--accent)' : 'var(--ink)',
    })),
  ]);
}

/* ───────────────────────── ORGANISMS ──────────────────────────────── */

function ActivityTicker({ items }) {
  if (!items || !items.length) return null;
  const doubled = [...items, ...items];
  const evtColor = (e) => ({
    'ingest':       'var(--ink)',
    'visitor':      'var(--ink)',
    'private-hit':  'var(--accent)',
    'promote':      'var(--muted)',
    'connector':    'var(--muted)',
    'job':          'var(--violet)',
  }[e] || 'var(--muted)');
  return $('div', { className: 'sm-ticker-host', style: { flex: 1, minWidth: 0, overflow: 'hidden', margin: '0 24px', maskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)' } },
    $('div', { className: 'sm-ticker-track', style: { display: 'inline-flex', gap: 28, animation: 'sm-ticker 60s linear infinite' } },
      doubled.map((it, i) => $('span', {
        key: i,
        className: 'mono',
        style: { display: 'inline-flex', alignItems: 'baseline', gap: 8, fontSize: 10.5, letterSpacing: '0.04em', whiteSpace: 'nowrap' },
      }, [
        $('span', { key: 't', style: { color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' } }, it.t),
        $('span', { key: 'e', style: { color: evtColor(it.evt), textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 9.5 } }, it.evt),
        $('span', { key: 'd', style: { color: 'var(--muted)' } }, it.detail),
        $('span', { key: 's', style: { color: 'var(--faint)' } }, '·'),
      ]))
    )
  );
}

function TopBar({ left, ticker, right, className = '' }) {
  return $('header', {
    className: className,
    style: {
      display: 'flex', alignItems: 'center', padding: '0 24px', height: 56,
      borderBottom: '1px solid var(--rule)',
      gap: 16,
      flexShrink: 0,
      background: 'color-mix(in oklab, var(--paper) 92%, transparent)',
      backdropFilter: 'blur(8px)',
      position: 'sticky', top: 0, zIndex: 40,
    },
  }, [
    $('div', { key: 'l', style: { display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 } }, left),
    ticker && $(ActivityTicker, { key: 't', items: ticker }),
    !ticker && $('div', { key: 'sp', style: { flex: 1 } }),
    $('div', { key: 'r', style: { display: 'flex', alignItems: 'baseline', gap: 20, flexShrink: 0 } }, right),
  ]);
}

function StickyComposer({ value, onChange, onSubmit, placeholder = 'ask…', disabled, prompts, onPickPrompt }) {
  return $('div', { className: 'sm-composer' }, [
    prompts && prompts.length > 0 && $('div', {
      key: 'p',
      style: { display: 'flex', flexWrap: 'wrap', gap: '6px 4px', marginBottom: 12 },
    }, [
      $('span', { key: 'L', className: 'mono', style: { fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)', marginRight: 12, paddingTop: 2 } }, 'try'),
      ...prompts.map((p, i) => $('button', {
        key: i,
        onClick: () => onPickPrompt(p),
        disabled,
        style: { background: 'transparent', border: 0, fontFamily: "'Newsreader',serif", fontStyle: 'italic', color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.4, textAlign: 'left', cursor: 'pointer' },
      }, '"' + p + '"' + (i < prompts.length - 1 ? '  /' : ''))),
    ]),
    $('form', {
      key: 'f',
      onSubmit: (e) => { e.preventDefault(); if (!disabled && value.trim()) onSubmit(value.trim()); },
    },
      $('div', { className: 'sm-composer-form' }, [
        $('span', { key: 'p', className: 'sm-composer-prompt' }, '›'),
        $('input', {
          key: 'i', type: 'text',
          className: 'sm-composer-input',
          value, onChange: (e) => onChange(e.target.value),
          placeholder, disabled,
          autoComplete: 'off', spellCheck: 'false',
        }),
        $('button', {
          key: 's', type: 'submit', disabled: disabled || !value.trim(),
          className: 'sm-btn sm-btn-ghost',
          style: { flexShrink: 0 },
        }, ['ask ', $('span', { key: 'k', style: { fontSize: 14 } }, '↵')]),
      ])
    ),
  ]);
}

function Modal({ open, onClose, title, kicker, children, footer, maxWidth = 680 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return $('div', {
    className: 'sm-fadein',
    onClick: onClose,
    style: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', background: 'color-mix(in oklab, var(--ink) 30%, transparent)' },
  },
    $('div', {
      className: 'sm-rise',
      onClick: (e) => e.stopPropagation(),
      style: { background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 3, width: '100%', maxWidth, margin: 'auto' },
    }, [
      $('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '20px 28px', borderBottom: '1px solid var(--rule)' } }, [
        $('div', { key: 't' }, [
          kicker && $('div', { key: 'k', className: 'smallcaps', style: { marginBottom: 4 } }, kicker),
          $('div', { key: 'T', style: { fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 400 } }, title),
        ]),
        $('button', { key: 'c', onClick: onClose, className: 'sm-btn sm-btn-ghost' }, 'close ✕'),
      ]),
      $('div', { key: 'b', style: { padding: '24px 28px', maxHeight: '70vh', overflowY: 'auto' } }, children),
      footer && $('div', { key: 'f', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px', borderTop: '1px solid var(--rule)', background: 'color-mix(in oklab, var(--surface) 60%, transparent)' } }, footer),
    ])
  );
}

function Section({ kicker, title, count, action, children }) {
  return $('section', null, [
    $('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid var(--rule)', paddingBottom: 16, marginBottom: 24 } }, [
      $('div', { key: 'l' }, [
        kicker && $('div', { key: 'k', className: 'smallcaps', style: { marginBottom: 6 } }, kicker),
        $('h1', { key: 't', style: { fontFamily: "'Newsreader',serif", fontSize: 32, fontWeight: 400, letterSpacing: 'var(--tk-snug)', lineHeight: 1, margin: 0 } }, [
          title,
          count != null && $('span', { key: 'c', className: 'mono', style: { color: 'var(--faint)', marginLeft: 12, fontSize: 14, letterSpacing: '0.1em' } }, '· ' + count),
        ]),
      ]),
      action && $('div', { key: 'r' }, action),
    ]),
    $('div', { key: 'b' }, children),
  ]);
}

/* ───────────────────────── EXPORT ─────────────────────────────────── */

window.SM = {
  Chip, Pill, SmallCaps, LiveDot, Kbd, Btn, Field, Input, Textarea, Segmented,
  Crosshair, Banner, Thinking, SessionStrip, SpeakerLabel, Citations, Quota, MaskedSecret, CopyBtn,
  Sparkline, ImageThumb, FilePill, QRCode, ActivityTicker, TopBar, StickyComposer,
  Modal, Section,
};
