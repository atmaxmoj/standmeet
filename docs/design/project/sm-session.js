/* sm-session.js
 *
 * Shared visitor-session state — one source of truth for the access code,
 * the chosen visitor name, the per-session quota, and the BYOAI mode flag.
 *
 * Mounted on window.SMSession so every visitor surface (index / blog /
 * wiki / output / page) can read+write the same thing without each one
 * re-implementing storage. Surfaces also listen to the "storage" event
 * so an action in one tab updates the others live.
 *
 * Mock quotas live in CODE_QUOTAS below — in production this is a
 * server-side lookup on session start and a server-side increment on each
 * AI turn. The shape is what surfaces consume.
 */

(function () {

const SESSION_KEY = 'standmeet-session';

/* default quotas per known code · used until the backend says otherwise */
const CODE_QUOTAS = {
  'OAEN-3K2': { used: 11, max: 50, label: 'OpenAI eng loop' },
  'A16Z-9V1': { used: 24, max: 30, label: 'a16z partner intro' },
  'STRA-5T8': { used: 5,  max: 20, label: 'Stripe advisor chat' },
};

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    code:    params.get('c'),
    visitor: params.get('v'),
    byoai:   params.get('byoai') === '1',
    byoaiProvider: params.get('p') || 'claude',
  };
}

function load() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch (e) { return null; }
}

function save(s) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    // notify in-tab listeners — `storage` event only fires cross-tab
    window.dispatchEvent(new CustomEvent('sm-session-changed', { detail: s }));
  } catch (e) {}
}

function clear() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  window.dispatchEvent(new CustomEvent('sm-session-changed', { detail: null }));
}

/* derive a current session from the URL — fall back to stored if URL doesn't
   carry a code (e.g. visitor navigated to /wiki/foo without keeping ?c=...). */
function current() {
  const url = readUrl();
  const stored = load();
  // URL wins if it carries a code or byoai flag; otherwise reuse stored
  if (url.code || url.byoai) {
    const base = CODE_QUOTAS[url.code] || (url.byoai ? { used: 0, max: 0, label: 'BYOAI · ' + url.byoaiProvider } : null);
    const merged = {
      code:    url.code || null,
      visitor: url.visitor || (stored && stored.visitor) || null,
      byoai:   url.byoai,
      byoaiProvider: url.byoaiProvider,
      label:   base ? base.label : null,
      used:    base ? (stored && stored.code === url.code ? stored.used : base.used) : 0,
      max:     base ? base.max : 0,
      started_at: (stored && stored.code === url.code) ? stored.started_at : Date.now(),
    };
    if (!stored || stored.code !== merged.code || stored.byoai !== merged.byoai) save(merged);
    return merged;
  }
  return stored;
}

/* increment the per-session quota — surfaces call this on each AI turn */
function consume(n = 1) {
  const cur = current();
  if (!cur) return null;
  const next = { ...cur, used: cur.used + n };
  save(next);
  return next;
}

/* sign visitor into the session (after the gate name-picker resolves) */
function setVisitor(name) {
  const cur = current() || {};
  const next = { ...cur, visitor: name };
  save(next);
  return next;
}

window.SMSession = { current, consume, setVisitor, clear, load, save, CODE_QUOTAS };

})();
