// Mock data for the StandMeet owner admin (Surface 1).
// Realistic-enough volumes so the layout exercises across density edges.

const OWNER_ADMIN = {
  handle: 'sijie',
  full:   'sijie wang',
  email:  'sijie@standmeet.com',
  corpus_size: 1247,
  last_ingest: '3 days ago',
  storage_used_mb: 84,
};

const SOURCES = ['claude', 'chatgpt', 'cursor', 'gemini', 'upload'];

// activity ticker — recent system events surfaced in the topbar
const ACTIVITY = [
  { t: '14:38', evt: 'ingest', detail: 'claude · 3 entries' },
  { t: '14:22', evt: 'visitor', detail: 'OAEN-3K2 · David Chen · 7 turns' },
  { t: '13:54', evt: 'private-hit', detail: 'A16Z-9V1 asked about runway' },
  { t: '13:11', evt: 'promote', detail: 'r-298 → wiki' },
  { t: '12:40', evt: 'ingest', detail: 'cursor · 1 entry' },
  { t: '11:42', evt: 'ingest', detail: 'claude · 2 entries + 1 image' },
  { t: '11:18', evt: 'visitor', detail: 'STRA-5T8 · Erin Bates · 5 turns' },
  { t: '10:02', evt: 'connector', detail: 'github sync · 3 updated' },
];

// corpus growth sparkline — last 14 days, entries added per day
const GROWTH_14D = [4, 7, 2, 6, 11, 3, 8, 5, 9, 12, 6, 14, 9, 17];

const RAW_ENTRIES = [
  {
    id: 'r-303', source: 'upload', time: 'today · 14:18',
    body: 'Whiteboard from the K. call — the eval rubric we keep arguing about. Three columns: faithfulness / attribution / refusal-when-absent. Reshoot next week with the typed version.',
    media: { kind: 'image', label: 'IMG_8821.jpg', dims: '3024×4032', size_kb: 1840 },
    tags: ['lucerna', 'eval'], status: 'unprocessed',
  },
  {
    id: 'r-302', source: 'claude', time: 'today · 12:55',
    body: 'Voice memo while walking — quick take on why "agentic" is the wrong word and what we should be saying instead.',
    media: { kind: 'audio', label: 'memo-2026-05-15.m4a', duration: '02:41', wave: [3,5,8,4,6,9,12,7,5,10,14,9,6,4,11,15,10,6,8,5,12,16,8,4,7,11,5,3] },
    tags: ['thinking', 'product'], status: 'unprocessed',
  },
  {
    id: 'r-301', source: 'claude', time: 'today · 11:42',
    body: 'The reason I keep saying "second brain" is wrong: it implies an organ that quietly stores. The actual want is a third interlocutor — something that talks back with your own past as material.',
    tags: ['thinking', 'lucerna'], status: 'unprocessed',
  },
  {
    id: 'r-300', source: 'cursor', time: 'today · 09:18',
    body: 'Spent the morning realizing our retrieval eval was rewarding fluency, not faithfulness. Rebuilding the rubric — faithfulness, attribution, refusal-when-absent are the three columns.',
    tags: ['lucerna', 'eval'], status: 'unprocessed',
  },
  {
    id: 'r-299', source: 'chatgpt', time: 'yesterday · 22:30',
    body: 'On the question of why I left: the honest version is that the team I cared about had been functionally dissolved for nine months and I was performing engineering while doing politics. The interesting version is that I should have left six months earlier.',
    tags: ['career', 'private'], status: 'flagged-private',
  },
  {
    id: 'r-298', source: 'claude', time: 'yesterday · 16:11',
    body: 'Take: every "AI-native" product I see in 2026 is doing the equivalent of bolting an electric motor onto a horse carriage. The actual reorganization happens when you redesign what the user is doing, not just the surface they do it on.',
    tags: ['thinking', 'product'], status: 'promoted',
  },
  {
    id: 'r-297', source: 'chatgpt', time: 'yesterday · 14:02',
    body: 'Note for future self: when someone asks "are you fundraising" the right answer is almost never the literal answer. They’re asking whether the company is alive enough to bother befriending. The literal answer is downstream of that.',
    tags: ['fundraising', 'private'], status: 'flagged-private',
  },
  {
    id: 'r-296', source: 'claude', time: '3 days ago',
    body: 'Lucerna onboarding doc draft — came out of the call with K. The first principle: retrieval quality is downstream of eval quality, which is downstream of the question of what counts as "the right answer" for a personal corpus. We have to define that ourselves.',
    tags: ['lucerna', 'eval'], status: 'unprocessed',
  },
  {
    id: 'r-295', source: 'gemini', time: '4 days ago',
    body: 'Useful framing from the call with M.: my company is in the substrate business, not the product business. Substrate businesses get away with worse UX as long as the primitive is right. We are not allowed to get away with worse UX much longer.',
    tags: ['lucerna', 'strategy'], status: 'unprocessed',
  },
  {
    id: 'r-294', source: 'cursor', time: '5 days ago',
    body: 'Quick check-in I should write up: the eval we built for "personal corpus" retrieval is genuinely 6–12 months ahead of what I see in open-source. That is the thing investors should be asking about, not the model.',
    tags: ['lucerna', 'eval', 'fundraising'], status: 'unprocessed',
  },
];

const WIKI_ENTRIES = [
  {
    id: 'w-12', title: 'on AI replacing engineers',
    excerpt: 'The question assumes engineering is what we currently call engineering. It isn’t. Most of what I do is reading other people’s intentions and translating them into systems that won’t surprise anyone six months later.',
    tags: ['thinking', 'ai'], last_edited: '2 days ago', sources: 3, visibility: 'public',
  },
  {
    id: 'w-11', title: 'what Lucerna is, honestly',
    excerpt: 'We tell people we build retrieval systems for personal corpora. Closer to the truth: we’re trying to make it possible to think with your past self again.',
    tags: ['lucerna', 'product'], last_edited: '6 days ago', sources: 5, visibility: 'public',
  },
  {
    id: 'w-10', title: 'why I left my last role',
    excerpt: 'The team I cared about had been functionally dissolved for nine months. I was performing engineering while doing politics. I should have left six months earlier.',
    tags: ['career', 'private'], last_edited: '8 hours ago', sources: 2, visibility: 'on-request',
  },
  {
    id: 'w-09', title: 'why second brains fail',
    excerpt: 'The problem isn’t capture. It’s that capture without conversation produces a mausoleum.',
    tags: ['thinking', 'tools'], last_edited: '11 days ago', sources: 4, visibility: 'public',
  },
  {
    id: 'w-08', title: 'eval is the product, model is the tax',
    excerpt: 'About half the bad retrieval examples we look at aren’t model failures, they’re eval failures. Fix the eval, the model "gets better" by twenty points overnight.',
    tags: ['lucerna', 'eval'], last_edited: '2 weeks ago', sources: 3, visibility: 'public',
  },
  {
    id: 'w-07', title: 'how I actually work day-to-day',
    excerpt: 'Calendar’s mostly empty by design. One standing weekly with the team, rest unstructured. The work that matters doesn’t survive meeting-shaped time.',
    tags: ['work', 'personal'], last_edited: '3 weeks ago', sources: 2, visibility: 'public',
  },
  {
    id: 'w-06', title: 'fundraising status, real version',
    excerpt: 'Where we actually are on the round, what we’re asking for, and which conversations are real vs. courtesy. Not public.',
    tags: ['fundraising', 'private'], last_edited: '4 days ago', sources: 6, visibility: 'private',
  },
];

const WIKI_TAGS = ['thinking', 'lucerna', 'eval', 'career', 'fundraising', 'product', 'tools', 'work', 'personal', 'ai', 'strategy', 'private'];

const CONVERSATIONS = [
  {
    id: 'c-44', visitor: 'David Chen', code_label: 'OpenAI eng loop', code: 'OAEN-3K2',
    turns: 11, last: '12 min ago', private_hits: 1,
    transcript: [
      { who: 'visitor', text: 'Walk me through your background.' },
      { who: 'ai',      text: 'Applied math at Tsinghua, PhD at Stanford on representation learning. Google Brain 2019–2024. Left in early 2024 to start Lucerna.' },
      { who: 'visitor', text: 'What did you actually own at Brain?' },
      { who: 'ai',      text: 'Led retrieval quality for a 2023 launch — took top-1 from 38% to 71% over nine months, mostly by rebuilding the eval. The reframing was the contribution; the modeling was the tax.' },
      { who: 'visitor', text: 'Could we set up 30 min next week? I want to dig into the eval rebuild.' },
      { who: 'ai',      tool: 'calendar.find_slots', text: 'Pulling sijie’s availability for next week with David’s timezone (PT)…',
        result: {
          kind: 'calendar',
          slots: [
            { day: 'Tue · May 19', time: '10:30–11:00 PT' },
            { day: 'Wed · May 20', time: '14:00–14:30 PT' },
            { day: 'Thu · May 21', time: '09:00–09:30 PT' },
          ],
        }
      },
      { who: 'visitor', text: 'Wed 14:00 works.' },
      { who: 'ai',      tool: 'calendar.book', text: 'Booked: 30-min call with sijie, Wed May 20 · 14:00 PT. Confirmation sent to david@openai.com.',
        result: { kind: 'booking', confirmed: true, ics: 'sijie-david-may20.ics' }
      },
      { who: 'visitor', text: 'Are you fundraising?' },
      { who: 'ai',      text: 'Private — sijie doesn’t answer this on a public page.', flagged: true },
    ],
  },
  {
    id: 'c-43', visitor: 'Sarah Park', code_label: 'OpenAI eng loop', code: 'OAEN-3K2',
    turns: 4, last: '2 hours ago', private_hits: 0,
  },
  {
    id: 'c-42', visitor: 'anonymous · new from code',  code_label: 'OpenAI eng loop', code: 'OAEN-3K2',
    turns: 3, last: '1 day ago', private_hits: 0,
  },
  {
    id: 'c-41', visitor: 'Mira Yoshida', code_label: 'a16z partner intro', code: 'A16Z-9V1',
    turns: 11, last: '2 days ago', private_hits: 2,
  },
  {
    id: 'c-40', visitor: 'James Liu',    code_label: 'a16z partner intro', code: 'A16Z-9V1',
    turns: 6, last: '3 days ago', private_hits: 1,
  },
  {
    id: 'c-39', visitor: 'Erin Bates',   code_label: 'Stripe advisor chat', code: 'STRA-5T8',
    turns: 5, last: '6 days ago', private_hits: 0,
  },
  {
    id: 'c-38', visitor: 'Ken Toda',     code_label: 'press · The Information', code: 'PRES-2M4',
    turns: 9, last: '1 week ago', private_hits: 3,
  },
];

const CODES = [
  {
    id: 'k-1', code: 'OAEN-3K2', label: 'OpenAI eng loop',
    purpose: 'staff eng interview screening',
    members: [
      { name: 'David Chen',  last: '12 min ago' },
      { name: 'Sarah Park',  last: '2 hours ago' },
      { name: 'anonymous',   last: '1 day ago', anon: true },
    ],
    scope: ['thinking', 'work', 'career', 'lucerna'],
    excluded: ['fundraising', 'private'],
    suggested: [
      'Walk me through your background.',
      'What did you actually own at your last role?',
      'How do you think about AI replacing engineers?',
      'What’s something you’ve changed your mind about?',
    ],
    status: 'active', expires: 'in 18 days', uses: 12,
  },
  {
    id: 'k-2', code: 'A16Z-9V1', label: 'a16z partner intro',
    purpose: 'first investor conversation',
    members: [
      { name: 'Mira Yoshida', last: '2 days ago' },
      { name: 'James Liu',    last: '3 days ago' },
    ],
    scope: ['lucerna', 'thinking', 'product', 'strategy', 'eval'],
    excluded: ['private', 'career'],
    suggested: [
      'Why does Lucerna exist?',
      'What’s your moat?',
      'Are you fundraising?',
      'What have you actually shipped?',
    ],
    status: 'active', expires: 'in 4 days', uses: 17,
  },
  {
    id: 'k-3', code: 'STRA-5T8', label: 'Stripe advisor chat',
    purpose: 'advisor scoping call',
    members: [{ name: 'Erin Bates', last: '6 days ago' }],
    scope: ['lucerna', 'thinking', 'work'],
    excluded: ['private', 'fundraising'],
    suggested: ['What kind of advising are you open to?'],
    status: 'active', expires: 'in 22 days', uses: 5,
  },
  {
    id: 'k-4', code: 'PRES-2M4', label: 'press · The Information',
    purpose: 'one-time reporter prep',
    members: [{ name: 'Ken Toda', last: '1 week ago' }],
    scope: ['lucerna', 'product'],
    excluded: ['private', 'fundraising', 'career', 'eval'],
    suggested: ['What is Lucerna?', 'What’s your timeline?'],
    status: 'expired', expires: 'expired', uses: 9,
  },
];

const CONNECTORS = [
  {
    id: 'email', name: 'Email', connected: true,
    account: 'sijie@standmeet.com',
    note: 'visitors can ping you directly when they hit a private redaction. you can also send the AI new entries by emailing yourself.',
    last_event: '4 hours ago · 2 new pings',
  },
  {
    id: 'calendar', name: 'Calendar', connected: false,
    account: null,
    note: 'lets the AI offer to book a slot when a conversation gets serious. shown only when the visitor’s code has booking enabled.',
    last_event: null,
  },
  {
    id: 'github', name: 'GitHub', connected: true,
    account: '@sijieiwang',
    note: 'pulls README + top-level project descriptions as wiki entries (read-only). nothing private.',
    last_event: '2 days ago · 3 entries updated',
  },
  {
    id: 'mcp', name: 'MCP push endpoint', connected: true,
    account: 'mcp://standmeet/sijie',
    note: 'where Claude / ChatGPT / Cursor send dumps. revoke and rotate at any time.',
    last_event: 'today · 11:42',
  },
];

// helpers
function tagDot(tag) {
  // deterministic-ish color hint per tag (we still mostly render in muted ink)
  const map = {
    private:     'private',
    fundraising: 'private',
    career:      'sensitive',
    eval:        'tech',
    lucerna:     'tech',
  };
  return map[tag] || 'neutral';
}

// extra: wiki entry with a figure media block
WIKI_ENTRIES.unshift({
  id: 'w-13', title: 'the eval rubric, finally typed up',
  excerpt: 'Three columns: faithfulness, attribution, refusal-when-absent. The fourth column everyone tries to sneak in (fluency) is a trap.',
  tags: ['lucerna', 'eval'], last_edited: '4 hours ago', sources: 4, visibility: 'public',
  media: { kind: 'image', label: 'eval-rubric-typed.png' },
});

window.OWNER_ADMIN  = OWNER_ADMIN;
window.SOURCES      = SOURCES;
window.RAW_ENTRIES  = RAW_ENTRIES;
window.ACTIVITY     = ACTIVITY;
window.GROWTH_14D   = GROWTH_14D;
window.WIKI_ENTRIES = WIKI_ENTRIES;
window.WIKI_TAGS    = WIKI_TAGS;
window.CONVERSATIONS = CONVERSATIONS;
window.CODES        = CODES;
window.CONNECTORS   = CONNECTORS;
window.tagDot       = tagDot;
