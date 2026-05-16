/* page-content.js
 *
 * The authoritative content model for sijie's public StandMeet page.
 * Edited in admin → /page. Read on the public page (index.html).
 *
 * For the prototype: admin's edits live in React state, not persisted.
 * In production this would round-trip through a backend write endpoint.
 *
 * Exposes window.PAGE_CONTENT — both index.html and admin.html load this file
 * before their own scripts so the same defaults are visible everywhere.
 */

const PAGE_CONTENT = {
  owner: {
    handle:   'sijie',
    full:     'sijie wang',
    location: 'Markham, Ontario',
    last_updated: '3 days ago',
    corpus_size: 1247,
    // optional custom domain. when set + verified, replaces the standmeet.com/<handle>
    // path in all share-URLs (codes, QRs, gate footer). leave blank to use the default.
    domain:   '',
    domain_status: 'unset', // 'unset' | 'pending' | 'verified'
    // BYOAI: lets visitors without an invite code chat using their own API key,
    // restricted to the public scope of the corpus. owner pays for storage/RAG;
    // visitor pays for inference. when disabled, the gate page only offers code
    // entry + request-access.
    byoai_enabled: true,
    byoai_providers: ['claude', 'openai'],
    byoai_public_blurb: "You'll get the public slice of my corpus — work, projects, public takes. Private topics (e.g. fundraising, why I left a role) are gated; ask for an invite code if you need those.",
  },

  // hero · serif prose paragraph + inline examples beneath the chat input
  hero: {
    prose: "I'm Sijie. I build indie products, write code with AI but fight its defaults, learn German through Kafka, and think software architecture is about to follow organizations into a new shape.",
    examples: [
      "What do you think about AI replacing engineers?",
      "How do you choose what to build as an indie founder?",
      "Why did you leave Hong Kong?",
      "What's wrong with vibe coding?",
    ],
  },

  // section A — curated insights, each is a one-line thesis + context attribution + optional expansion
  insights: [
    {
      id: 'i-1',
      thesis: "AI coding doesn't make engineers faster — it makes codebases sicker.",
      context: 'from a conversation about indie tooling',
      body: "Velocity feels real because typing is faster. But the codebase accumulates the surface area of every prompt you sent — none of it pruned, none of it pinned to a hierarchy of ideas. Six months later you have a project that looks like a transcript, not a system.",
    },
    {
      id: 'i-2',
      thesis: "Software architecture mirrors organization. AI changes organization. So architecture will change.",
      context: 'a 5-year prediction',
      body: "Microservices were Amazon's org chart in YAML. The next architecture is whatever shape teams take once AI absorbs the bottom half of the engineering pyramid. My bet: fewer services, much larger blast radius per repo, more long-lived AI agents owning subsystems the way a team used to.",
    },
    {
      id: 'i-3',
      thesis: "You can't measure expertise by years. You measure it by feedback × time × willingness to update.",
      context: 'from a discussion on hiring',
      body: "Two engineers with the same 10 years can be a decade apart in real depth. The one who shipped, watched, and admitted being wrong has compounded; the one who managed up for 10 years hasn't. The number itself tells you nothing.",
    },
    {
      id: 'i-4',
      thesis: "The hiring market loses people whose value doesn't fit standard buckets. That's why StandMeet exists.",
      context: 'the founding observation',
      body: "I'm not the engineer you find by filtering for 'staff IC, 8+ years, ex-FAANG'. I'm closer than that for what I can do, further than that on paper. StandMeet is the page that gets to argue back.",
    },
  ],

  // section B — projects, typography-only
  projects: [
    {
      id: 'p-lucerna', name: 'Lucerna',
      tagline: 'reading-first language learning',
      lines: [
        'Indie. ~12 new users/day. D30 retention 6%, which is healthy for the strategy.',
        "I'm migrating it from monorepo to a 6-service architecture, solo.",
      ],
      url: 'lucerna.dev',
    },
    {
      id: 'p-flexmesh', name: 'FlexMesh',
      tagline: 'routing for Canadian delivery drivers',
      lines: [
        '$29/driver/month. Has paying users.',
        'Built for fleet of 1, indexed by ChatGPT.',
      ],
      url: 'flexmesh.ca',
    },
    {
      id: 'p-youteacher', name: 'YouTeacher',
      tagline: 'ESL recruitment for China',
      lines: [
        'Partnership with Pete. 151K LOC across 12 microservices, built in 2 months.',
        'Not public yet.',
      ],
      url: null,
    },
    {
      id: 'p-standmeet', name: 'StandMeet',
      tagline: "what you're reading right now",
      lines: [
        'The corpus this site is built on grows from every AI conversation I curate forward.',
      ],
      url: null,
    },
  ],

  // section C — where I am
  where: {
    location_line: 'Based in Markham, Ontario. Canadian PR.',
    status_prose: "Last 2 years I've been indie. I'm starting to look at employment again, but selectively — I'm specifically looking for tech-driven companies where staff IC is a real path, not where it ends at senior.",
    looking_for: [
      'founding engineer or staff IC role',
      'Series A+ AI startup or similar',
      'long enough runway, real revenue',
      '< 30 people, technical founder',
    ],
    closing: "Otherwise — just here to think out loud.",
  },

  // section D — how to talk to me
  contact: {
    email: 'hello@sijiewang.com',
    chat_line: 'Ask via the chat above. It knows my views on most things and will answer in my voice.',
    recruiter_prose: "If you're a recruiter or hiring manager, consider sending what role + company first, so we can both decide if a call makes sense. Generic outreach I rarely respond to.",
    casual_prose: "If you just want to chat about ideas — indie building, German, modal logic, Kafka, anything else here — I usually have time.",
  },
};

// localStorage sync — admin edits write here; public page reads (with fallback to defaults).
// Tiny shim so we don't pull in a real state lib.
const STORAGE_KEY = 'standmeet-page-content';

function loadPageContent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PAGE_CONTENT;
    const parsed = JSON.parse(raw);
    // shallow-merge with defaults so new fields don't break older saves
    return {
      ...PAGE_CONTENT,
      ...parsed,
      owner:    { ...PAGE_CONTENT.owner,    ...(parsed.owner    || {}) },
      hero:     { ...PAGE_CONTENT.hero,     ...(parsed.hero     || {}) },
      where:    { ...PAGE_CONTENT.where,    ...(parsed.where    || {}) },
      contact:  { ...PAGE_CONTENT.contact,  ...(parsed.contact  || {}) },
      insights: parsed.insights || PAGE_CONTENT.insights,
      projects: parsed.projects || PAGE_CONTENT.projects,
    };
  } catch (e) { return PAGE_CONTENT; }
}

function savePageContent(c) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) {}
}

window.PAGE_CONTENT_DEFAULTS = PAGE_CONTENT;
window.loadPageContent = loadPageContent;
window.savePageContent = savePageContent;

// shared helper: where does this owner live on the web?
// returns the bare "host" (without scheme) used in every share URL.
function siteHost(content) {
  const c = content || PAGE_CONTENT;
  const d = (c.owner && c.owner.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (d && c.owner.domain_status === 'verified') return d;
  return 'standmeet.com/' + (c.owner && c.owner.handle || 'sijie');
}
function shareUrl(content, params) {
  const host = siteHost(content);
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return 'https://' + host + qs;
}
window.siteHost = siteHost;
window.shareUrl = shareUrl;
