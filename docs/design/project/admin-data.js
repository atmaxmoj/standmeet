/* admin-data.js — mock data for every admin surface, second iteration.
 *
 * Extends the v1 model with all the previously-missing surfaces:
 *   outputs (3 tiers) · pages · access-requests · jobs · skills · obsidian · seo · system · account
 *
 * The data shape mirrors what the real backend would return: snapshots,
 * timestamps, status enums, source attribution, etc.
 *
 * All exports land on `window.AD` so admin.js can pluck what it needs.
 */

const OWNER_ADMIN = {
  handle: 'sijie',
  full:   'sijie wang',
  email:  'sijie@standmeet.com',
  corpus_size: 1247,
  last_ingest: '3 days ago',
  storage_used_mb: 84,
  version: 'v1.4.0',
  instance_hash: 'a3f9c2e1b8d4',
  deployed: 'localhost:3000',
  uptime: '17 days',
};

const SOURCES = ['claude', 'chatgpt', 'cursor', 'gemini', 'upload', 'obsidian', 'mcp'];

const ACTIVITY = [
  { t: '14:38', evt: 'ingest',      detail: 'claude · 3 entries' },
  { t: '14:22', evt: 'visitor',     detail: 'OAEN-3K2 · David Chen · 7 turns' },
  { t: '13:54', evt: 'private-hit', detail: 'A16Z-9V1 asked about runway' },
  { t: '13:11', evt: 'promote',     detail: 'r-298 → wiki' },
  { t: '12:55', evt: 'job',         detail: 'application sent · Anthropic staff eng' },
  { t: '12:40', evt: 'ingest',      detail: 'cursor · 1 entry' },
  { t: '11:42', evt: 'ingest',      detail: 'claude · 2 entries + 1 image' },
  { t: '11:18', evt: 'visitor',     detail: 'STRA-5T8 · Erin Bates · 5 turns' },
  { t: '10:55', evt: 'request',     detail: 'access request · Tomás @ Modal' },
  { t: '10:02', evt: 'connector',   detail: 'github sync · 3 entries updated' },
  { t: '09:30', evt: 'obsidian',    detail: 'vault push · 14 notes mirrored' },
];

const GROWTH_14D = [4, 7, 2, 6, 11, 3, 8, 5, 9, 12, 6, 14, 9, 17];

/* ── corpus ───────────────────────────────────────────────────────── */

const RAW_ENTRIES = [
  { id:'r-303', source:'upload',  time:'today · 14:18', body:'Whiteboard from the K. call — the eval rubric we keep arguing about. Three columns: faithfulness / attribution / refusal-when-absent.', media:{kind:'image', label:'IMG_8821.jpg', dims:'3024×4032', size_kb:1840}, tags:['lucerna','eval'], status:'unprocessed' },
  { id:'r-302', source:'claude',  time:'today · 12:55', body:'Voice memo while walking — quick take on why "agentic" is the wrong word.', media:{kind:'audio', label:'memo-2026-05-15.m4a', duration:'02:41'}, tags:['thinking','product'], status:'unprocessed' },
  { id:'r-301', source:'claude',  time:'today · 11:42', body:'The reason I keep saying "second brain" is wrong: it implies an organ that quietly stores. The actual want is a third interlocutor.', tags:['thinking','lucerna'], status:'unprocessed' },
  { id:'r-300', source:'cursor',  time:'today · 09:18', body:'Spent the morning realizing our retrieval eval was rewarding fluency, not faithfulness.', tags:['lucerna','eval'], status:'unprocessed' },
  { id:'r-299', source:'chatgpt', time:'yesterday · 22:30', body:'On the question of why I left: the honest version is that the team I cared about had been functionally dissolved for nine months.', tags:['career','private'], status:'flagged-private' },
  { id:'r-298', source:'claude',  time:'yesterday · 16:11', body:'Take: every "AI-native" product I see in 2026 is doing the equivalent of bolting an electric motor onto a horse carriage.', tags:['thinking','product'], status:'promoted' },
  { id:'r-297', source:'chatgpt', time:'yesterday · 14:02', body:'When someone asks "are you fundraising" the right answer is almost never the literal answer.', tags:['fundraising','private'], status:'flagged-private' },
  { id:'r-296', source:'obsidian',time:'3 days ago',         body:'Lucerna onboarding doc draft — the first principle: retrieval quality is downstream of eval quality.', tags:['lucerna','eval'], status:'unprocessed' },
];

const WIKI_TAGS = ['thinking','lucerna','eval','career','fundraising','product','tools','work','personal','ai','strategy','private'];

const WIKI_ENTRIES = [
  { id:'w-13', title:'the eval rubric, finally typed up', excerpt:'Three columns: faithfulness, attribution, refusal-when-absent. The fourth column everyone tries to sneak in (fluency) is a trap.', tags:['lucerna','eval'], last_edited:'4 hours ago', sources:4, visibility:'public', media:{kind:'image',label:'eval-rubric-typed.png'} },
  { id:'w-12', title:'on AI replacing engineers', excerpt:'The question assumes engineering is what we currently call engineering. It isn\u2019t. Most of what I do is reading other people\u2019s intentions.', tags:['thinking','ai'], last_edited:'2 days ago', sources:3, visibility:'public' },
  { id:'w-11', title:'what Lucerna is, honestly', excerpt:'We tell people we build retrieval systems for personal corpora. Closer to the truth: we\u2019re trying to make it possible to think with your past self.', tags:['lucerna','product'], last_edited:'6 days ago', sources:5, visibility:'public' },
  { id:'w-10', title:'why I left my last role', excerpt:'The team I cared about had been functionally dissolved for nine months. I was performing engineering while doing politics.', tags:['career','private'], last_edited:'8 hours ago', sources:2, visibility:'on-request' },
  { id:'w-09', title:'why second brains fail', excerpt:'The problem isn\u2019t capture. It\u2019s that capture without conversation produces a mausoleum.', tags:['thinking','tools'], last_edited:'11 days ago', sources:4, visibility:'public' },
  { id:'w-08', title:'eval is the product, model is the tax', excerpt:'About half the bad retrieval examples are eval failures, not model failures.', tags:['lucerna','eval'], last_edited:'2 weeks ago', sources:3, visibility:'public' },
  { id:'w-07', title:'how I actually work day-to-day', excerpt:'Calendar\u2019s mostly empty by design. One standing weekly with the team, rest unstructured.', tags:['work','personal'], last_edited:'3 weeks ago', sources:2, visibility:'public' },
  { id:'w-06', title:'fundraising status, real version', excerpt:'Where we actually are on the round, what we\u2019re asking for, which conversations are real vs. courtesy.', tags:['fundraising','private'], last_edited:'4 days ago', sources:6, visibility:'private' },
];

/* ── conversations ────────────────────────────────────────────────── */

const CONVERSATIONS = [
  { id:'c-44', visitor:'David Chen',  code_label:'OpenAI eng loop',     code:'OAEN-3K2', turns:11, last:'12 min ago', private_hits:1, sentiment:'engaged' },
  { id:'c-43', visitor:'Sarah Park',  code_label:'OpenAI eng loop',     code:'OAEN-3K2', turns:4,  last:'2 hours ago', private_hits:0, sentiment:'short' },
  { id:'c-42', visitor:'anonymous',   code_label:'OpenAI eng loop',     code:'OAEN-3K2', turns:3,  last:'1 day ago',  private_hits:0, sentiment:'curious' },
  { id:'c-41', visitor:'Mira Yoshida',code_label:'a16z partner intro',  code:'A16Z-9V1', turns:11, last:'2 days ago', private_hits:2, sentiment:'engaged' },
  { id:'c-40', visitor:'James Liu',   code_label:'a16z partner intro',  code:'A16Z-9V1', turns:6,  last:'3 days ago', private_hits:1, sentiment:'skeptical' },
  { id:'c-39', visitor:'Erin Bates',  code_label:'Stripe advisor chat', code:'STRA-5T8', turns:5,  last:'6 days ago', private_hits:0, sentiment:'warm' },
  { id:'c-38', visitor:'Ken Toda',    code_label:'press · The Info',    code:'PRES-2M4', turns:9,  last:'1 week ago', private_hits:3, sentiment:'probing' },
  { id:'byoai-7', visitor:'anonymous · BYOAI', code_label:'BYOAI',      code:'—',        turns:14, last:'3 hours ago', private_hits:5, sentiment:'shopping', byoai:true, model:'claude' },
];

/* ── codes ────────────────────────────────────────────────────────── */

const CODES = [
  { id:'k-1', code:'OAEN-3K2', label:'OpenAI eng loop',     purpose:'staff eng interview screening',
    members:[ {name:'David Chen',last:'12 min ago'},{name:'Sarah Park',last:'2 hours ago'},{name:'anonymous',last:'1 day ago',anon:true} ],
    scope:['thinking','work','career','lucerna'], excluded:['fundraising','private'],
    opener:'Hi — you\u2019re here on the OpenAI eng loop, so I\u2019ll assume you want to know whether I\u2019d be a strong staff IC. Ask me anything, but if it helps: I think most of engineering is intention-translation, and I have strong opinions on eval. Where do you want to start?',
    suggested:['Walk me through your background.','What did you actually own at your last role?','How do you think about AI replacing engineers?','What\u2019s something you\u2019ve changed your mind about?'],
    status:'active', expires:'in 18 days', uses:12, quota:50, booking:{ enabled:true, duration:30, calendar:'Calendar', note:'30-min staff-IC chat' } },
  { id:'k-2', code:'A16Z-9V1', label:'a16z partner intro',  purpose:'first investor conversation',
    members:[ {name:'Mira Yoshida',last:'2 days ago'},{name:'James Liu',last:'3 days ago'} ],
    scope:['lucerna','thinking','product','strategy','eval'], excluded:['private','career'],
    opener:'Welcome. Since you\u2019re an investor: the short version is Lucerna is retrieval infrastructure for personal corpora, and the moat is the eval, not the model. I won\u2019t talk numbers here, but I\u2019ll happily go deep on why this is a category. What\u2019s your first question?',
    suggested:['Why does Lucerna exist?','What\u2019s your moat?','Are you fundraising?','What have you actually shipped?'],
    status:'active', expires:'in 4 days', uses:17, quota:30, booking:{ enabled:true, duration:45, calendar:'Calendar', note:'45-min investor call' } },
  { id:'k-3', code:'STRA-5T8', label:'Stripe advisor chat', purpose:'advisor scoping call',
    members:[ {name:'Erin Bates',last:'6 days ago'} ],
    scope:['lucerna','thinking','work'], excluded:['private','fundraising'],
    opener:'Hey — advisor scoping. I take one or two founders a quarter, retrieval/eval only, equity not cash. Tell me what you\u2019re building and what you\u2019d actually want from me.',
    suggested:['What kind of advising are you open to?'],
    status:'active', expires:'in 22 days', uses:5, quota:20, booking:{ enabled:false, duration:30, calendar:'Calendar', note:'' } },
  { id:'k-4', code:'PRES-2M4', label:'press · The Information', purpose:'one-time reporter prep',
    members:[ {name:'Ken Toda',last:'1 week ago'} ],
    scope:['lucerna','product'], excluded:['private','fundraising','career','eval'],
    opener:'Hi — for press, here\u2019s the framing I\u2019d want quoted: Lucerna makes it possible to think with your past self. Ask away, and I\u2019ll flag anything that\u2019s off the record.',
    suggested:['What is Lucerna?','What\u2019s your timeline?'],
    status:'expired', expires:'expired', uses:9, quota:10, booking:{ enabled:false, duration:20, calendar:'Calendar', note:'' } },
];

/* ── access requests · gate /request submissions ──────────────────── */

const REQUESTS = [
  { id:'rq-12', name:'Tomás García',    org:'Modal Labs',       email:'tomas@modal.com',
    when:'today · 10:55',
    note:'Building scalable AI inference. Curious about how you think about retrieval as a substrate — and whether there\u2019s collaboration shape with Modal\u2019s serverless GPU compute.',
    status:'new' },
  { id:'rq-11', name:'Priya Mehta',     org:'Anthropic recruiting', email:'priya@anthropic.com',
    when:'today · 09:12',
    note:'I work on recruiting for the applied team. Saw your "translation layer" essay; would love to chat about a staff eng role we\u2019re scoping. Salary range and team structure on a call.',
    status:'new' },
  { id:'rq-10', name:'Jacob Chen',      org:'student · Waterloo', email:'jchen@uwaterloo.ca',
    when:'yesterday',
    note:'Trying to get into ML eng after grad. Read your stuff on eval. Don\u2019t have a specific ask — just hoping to ask a few questions about how to think about my first job.',
    status:'pending' },
  { id:'rq-09', name:'Lara Volkov',     org:'press · Pitchbook', email:'lara@pitchbook.com',
    when:'2 days ago',
    note:'Writing a piece on the personal-corpus retrieval space. 15 min call?',
    status:'declined', decline_reason:'general press · sent FAQ link' },
  { id:'rq-08', name:'Emma Ross',       org:'Sequoia',           email:'eross@sequoia.com',
    when:'3 days ago',
    note:'Saw you tweet about the eval work. We invest in this space. Open to chat?',
    status:'approved', issued_code:'SEQU-4F2' },
];

/* ── outputs · three tiers (lead-magnet artifacts) ────────────────── */

const OUTPUTS = [
  { id:'o-1', slug:'the-eval-rubric',   tier:'public',  format:'pdf+web',
    title:'The Eval Rubric',
    blurb:'A 4-page primer on the three columns of retrieval eval. Downloadable PDF + SEO landing.',
    cover_hue:'amber', from_wiki:['w-13','w-08'],
    seo:{ title:'A 4-page guide to writing better retrieval evals',
          description:'How to grade retrieval the way it matters: faithfulness, attribution, refusal-when-absent.',
          keywords:['retrieval eval','RAG eval','llm eval'] },
    published_at:'2026.05.04', views:1240, downloads:317, leads:18, status:'live' },
  { id:'o-2', slug:'translation-layer', tier:'public', format:'web',
    title:'The Translation Layer',
    blurb:'Long-form essay rendered as a standalone microsite, separate from the blog index.',
    cover_hue:'acid', from_wiki:['w-12'],
    seo:{ title:'Engineering is the translation layer',
          description:'The typing is incidental. The translation is the job.',
          keywords:['AI engineering','translation layer','engineering future'] },
    published_at:'2026.04.18', views:8420, downloads:0, leads:42, status:'live' },
  { id:'o-3', slug:'personal-corpus-deck', tier:'unlisted', format:'pdf',
    title:'Personal Corpus · investor deck',
    blurb:'9-slide deck. Unlisted: only visible to visitors entering via investor codes.',
    cover_hue:'violet', from_wiki:['w-11','w-06'],
    seo:{ title:'', description:'', keywords:[] },
    published_at:'2026.05.01', views:34, downloads:21, leads:7, status:'live' },
  { id:'o-4', slug:'how-i-write-with-ai', tier:'public', format:'web',
    title:'How I Actually Write With AI',
    blurb:'Process essay. Draft.',
    cover_hue:'amber', from_wiki:['w-07'],
    seo:{ title:'How I write with AI without losing my voice',
          description:'A working process for thinking-with-AI that doesn\u2019t produce slop.',
          keywords:['writing with AI','ai writing process'] },
    published_at:null, views:0, downloads:0, leads:0, status:'draft' },
  { id:'o-5', slug:'lucerna-onboard',   tier:'private', format:'pdf',
    title:'Lucerna · onboarding doc',
    blurb:'Internal team doc. Code-gated to the lucerna-team scope.',
    cover_hue:'violet', from_wiki:[],
    seo:{ title:'', description:'', keywords:[] },
    published_at:'2026.05.10', views:6, downloads:6, leads:0, status:'live' },
];

/* ── pages · custom React pages built into the instance ───────────── */

const PAGES = [
  { id:'p-1', slug:'press',     title:'Press kit',         blurb:'Auto-generated press surface with headshot, bio variants, and link to /output/translation-layer.',
    template:'press-kit',      visibility:'public',   updated:'2 days ago',  views:412 },
  { id:'p-2', slug:'speaking',  title:'Speaking',          blurb:'Past + upcoming talks, with the "what I\u2019ll say yes to" filter prose.',
    template:'list-with-prose',visibility:'public',   updated:'1 week ago',  views:88 },
  { id:'p-3', slug:'advisor',   title:'Advisor menu',      blurb:'What I take advisor calls on, what I don\u2019t, how to ask. Gated to investor + advisor scopes.',
    template:'menu',           visibility:'gated',    updated:'4 days ago',  views:23 },
  { id:'p-4', slug:'now',       title:'Now',               blurb:'A "/now" page, refreshed weekly by AI from the latest 10 raw entries.',
    template:'auto-now',       visibility:'public',   updated:'3 hours ago', views:1042 },
];

/* ── job sources · feeds the loop reads from ──────────────────────── */

const JOB_SOURCES = [
  { id:'js-1', kind:'greenhouse',  label:'Anthropic',           url:'boards.greenhouse.io/anthropic',  enabled:true, last_run:'12 min ago', new_count:3, total:42 },
  { id:'js-2', kind:'greenhouse',  label:'OpenAI',              url:'boards.greenhouse.io/openai',     enabled:true, last_run:'14 min ago', new_count:1, total:71 },
  { id:'js-3', kind:'lever',       label:'Cohere',              url:'jobs.lever.co/cohere',            enabled:true, last_run:'18 min ago', new_count:0, total:24 },
  { id:'js-4', kind:'wellfound',   label:'YC W26 batch',        url:'wellfound.com/ycw26',             enabled:true, last_run:'1 hour ago',  new_count:7, total:138 },
  { id:'js-5', kind:'rss',         label:'AI startup jobs · custom RSS', url:'jobsfeed.example.com/ai', enabled:false, last_run:'\u2014',     new_count:0, total:0 },
  { id:'js-6', kind:'scraper',     label:'Modal Labs careers',  url:'modal.com/careers',               enabled:true, last_run:'2 hours ago', new_count:2, total:11 },
];

/* ── job listings · jobs found through sources, ranked + tagged ─── */

const JOB_LISTINGS = [
  { id:'j-12', source:'js-1', company:'Anthropic',  title:'Staff Software Engineer · Applied',  location:'SF / Remote',  comp:'$310k\u2013$420k + eq', posted:'2 days ago', match:0.92, status:'shortlist',
    why:'eval methodology overlap · staff IC role · explicit "no manager track expected"' },
  { id:'j-11', source:'js-2', company:'OpenAI',     title:'Staff Engineer · Retrieval',         location:'SF',           comp:'$310k\u2013$450k + eq', posted:'4 days ago', match:0.89, status:'applied',
    why:'literally retrieval · staff IC · referenced in conversation c-44 with David Chen' },
  { id:'j-10', source:'js-1', company:'Anthropic',  title:'Member of Technical Staff · Applied AI', location:'SF',     comp:'$330k\u2013$470k + eq', posted:'5 days ago', match:0.86, status:'shortlist',
    why:'applied research · adjacent to your eval work · sponsorship: pre-existing PR' },
  { id:'j-09', source:'js-4', company:'Replicate',  title:'Founding eng · Retrieval & Memory',  location:'SF / Remote', comp:'$220k\u2013$280k + eq 0.5\u20131%', posted:'1 week ago', match:0.81, status:'considering',
    why:'small team · technical founder · remote ok' },
  { id:'j-08', source:'js-3', company:'Cohere',     title:'Senior Eng · Inference platform',    location:'Toronto',    comp:'$240k\u2013$310k + eq', posted:'1 week ago', match:0.68, status:'considering',
    why:'Canadian PR matches your location · senior IC track · platform-shaped' },
  { id:'j-07', source:'js-6', company:'Modal',      title:'Engineer · Distributed systems',     location:'NYC / Remote', comp:'$200k\u2013$290k + eq', posted:'3 days ago', match:0.61, status:'pass',
    why:'good company · but your distrib-systems heat is medium · adjacency cost too high' },
];

/* ── resume drafts · per-application versions ────────────────────── */

const RESUME_DRAFTS = [
  { id:'rd-3', for_job:'j-12', company:'Anthropic', title:'Staff Software Engineer · Applied',
    based_on:'master', cover_letter:true, status:'reviewing',
    delta:'+ "eval methodology" lead bullet · + Lucerna company description · trimmed Stripe to 4 bullets · cover letter draft from corpus w-12',
    updated:'1 hour ago', confidence:0.84 },
  { id:'rd-2', for_job:'j-11', company:'OpenAI',    title:'Staff Engineer · Retrieval',
    based_on:'master', cover_letter:true, status:'sent',
    delta:'+ "retrieval-quality" lead · + 71% top-1 metric callout · cover letter referencing chat conversation with David Chen',
    updated:'yesterday', confidence:0.91 },
  { id:'rd-1', for_job:'j-09', company:'Replicate', title:'Founding eng · Retrieval & Memory',
    based_on:'master', cover_letter:false, status:'draft',
    delta:'+ "indie + founding mindset" bullet · trimmed enterprise tone · pre-filled "comp expectations" form',
    updated:'2 days ago', confidence:0.71 },
];

/* ── applications · what's been sent ─────────────────────────────── */

const APPLICATIONS = [
  { id:'app-2', job_id:'j-11', resume_draft_id:'rd-2', sent_at:'yesterday · 14:02',
    method:'greenhouse',
    status:'reviewing',
    contact:'David Chen (via code OAEN-3K2)',
    notes:'Used the rebuilt-eval story as the lead. Mentioned the OAEN-3K2 chat in cover letter footnote.' },
  { id:'app-1', job_id:'j-08', resume_draft_id:null, sent_at:'4 days ago',
    method:'lever',
    status:'silent',
    contact:'(none)',
    notes:'Sent flat resume — no tailoring. Mistake.' },
];

/* ── skills graph ──────────────────────────────────────────────── */

const SKILLS = [
  { id:'sk-1',  label:'retrieval / RAG',           heat:0.95, sources:142, role:'core' },
  { id:'sk-2',  label:'evaluation methodology',    heat:0.92, sources:88,  role:'core' },
  { id:'sk-3',  label:'product strategy · indie',  heat:0.84, sources:62,  role:'strong' },
  { id:'sk-4',  label:'ML systems · training',     heat:0.62, sources:31,  role:'maintained' },
  { id:'sk-5',  label:'writing · long-form',       heat:0.81, sources:75,  role:'strong' },
  { id:'sk-6',  label:'distributed systems',       heat:0.55, sources:19,  role:'maintained' },
  { id:'sk-7',  label:'fundraising · seed',        heat:0.41, sources:14,  role:'developing' },
  { id:'sk-8',  label:'hiring · technical',        heat:0.38, sources:9,   role:'developing' },
  { id:'sk-9',  label:'inference infra · GPU',     heat:0.34, sources:6,   role:'dormant' },
  { id:'sk-10', label:'mobile · iOS',              heat:0.15, sources:2,   role:'dormant' },
];

/* ── obsidian sync ─────────────────────────────────────────────── */

const OBSIDIAN = {
  connected: true,
  vault_path: '~/vaults/standmeet-mirror',
  mode: 'two-way',
  last_sync: '14 min ago',
  push_pending: 2,
  pull_pending: 0,
  conflicts: 0,
  total_notes: 1247,
  total_size_mb: 78,
  recent_events: [
    { t:'09:30', action:'push', detail:'14 notes mirrored to vault' },
    { t:'06:11', action:'pull', detail:'1 note edited in Obsidian → applied to wiki' },
    { t:'01:42', action:'conflict-resolved', detail:'auto: kept wiki version (newer)' },
    { t:'yesterday', action:'push', detail:'3 notes' },
  ],
};

/* ── connectors ───────────────────────────────────────────────── */

const CONNECTORS = [
  { id:'email',     name:'Email',     connected:true,  account:'sijie@standmeet.com', note:'visitors can ping you directly when they hit a private redaction.', last_event:'4 hours ago · 2 new pings' },
  { id:'calendar',  name:'Calendar',  connected:false, account:null,                  note:'lets the AI offer to book a slot when a conversation gets serious.', last_event:null },
  { id:'github',    name:'GitHub',    connected:true,  account:'@sijiewang',           note:'pulls README + top-level project descriptions as wiki entries.', last_event:'2 days ago · 3 entries updated' },
  { id:'mcp',       name:'MCP push',  connected:true,  account:'mcp://standmeet/sijie',note:'where Claude / ChatGPT / Cursor send dumps.',                    last_event:'today · 11:42' },
  { id:'obsidian',  name:'Obsidian',  connected:true,  account:'~/vaults/standmeet-mirror', note:'two-way sync with a local vault. plugin required.',       last_event:'14 min ago · 2 push pending' },
];

/* connector registry · drives the "+ add connector" catalog modal.
 * Each entry declares the auth fields it needs; adding a new connector to
 * standmeet is just appending another object here — the modal renders it
 * automatically. Future connectors slot in without touching component code. */

const CONNECTOR_CATEGORIES = [
  { id: 'comms',     label: 'communication',        blurb: 'inbox, scheduling, voice' },
  { id: 'capture',   label: 'capture',              blurb: 'where thinking lands' },
  { id: 'identity',  label: 'identity & social',    blurb: 'verified-by accounts' },
  { id: 'storage',   label: 'storage & backup',     blurb: 'where the corpus archives to' },
  { id: 'analytics', label: 'analytics & growth',   blurb: 'know who is reading' },
];

const CONNECTOR_REGISTRY = [
  // comms
  { id:'email',     name:'Email',     icon:'✉',  category:'comms',    blurb:'visitors can ping you when they hit a private redaction.',
    fields:[ {k:'smtp_host', label:'SMTP host'}, {k:'smtp_user', label:'SMTP user'}, {k:'smtp_pass', label:'SMTP password', secret:true} ],
    docs_url:'#' },
  { id:'calendar',  name:'Calendar',  icon:'◫',  category:'comms',    blurb:'offers booking slots when a conversation gets serious.',
    fields:[ {k:'provider', label:'Provider', options:['google','outlook','cal.com','fastmail']}, {k:'oauth', label:'Authorize…', oauth:true} ],
    docs_url:'#' },
  { id:'discord',   name:'Discord DM', icon:'⌬', category:'comms',    blurb:'mirror access requests to a DM. one-way, owner-only.',
    fields:[ {k:'webhook', label:'Webhook URL', secret:true} ], docs_url:'#' },
  { id:'twilio',    name:'Twilio SMS', icon:'☎', category:'comms',    blurb:'sms when someone hits a high-trust topic + replies allowed.',
    fields:[ {k:'sid', label:'Account SID'}, {k:'token', label:'Auth token', secret:true}, {k:'from', label:'From number'} ], docs_url:'#' },

  // capture
  { id:'mcp',       name:'MCP push',   icon:'◈', category:'capture',  blurb:'where claude/chatgpt/cursor send dumps. token-scoped.',
    fields:[ {k:'token_scope', label:'Default token scope', options:['read+write','write only']} ],
    builtin:true, docs_url:'#' },
  { id:'obsidian',  name:'Obsidian',   icon:'◆', category:'capture',  blurb:'two-way sync with a local vault. plugin required.',
    fields:[ {k:'vault_path', label:'Vault path'}, {k:'mode', label:'Mode', options:['two-way','push only','pull only']} ],
    builtin:true, docs_url:'#' },
  { id:'notion',    name:'Notion',     icon:'▢', category:'capture',  blurb:'import pages / databases as wiki entries.',
    fields:[ {k:'integration_token', label:'Notion integration token', secret:true}, {k:'database_id', label:'Database ID'} ],
    docs_url:'#' },
  { id:'readwise',  name:'Readwise',   icon:'➤', category:'capture',  blurb:'pull highlights from articles, books, tweets.',
    fields:[ {k:'access_token', label:'Readwise API token', secret:true} ], docs_url:'#' },
  { id:'gmail',     name:'Gmail · drafts label', icon:'✦', category:'capture',
    blurb:'auto-import emails you tagged "standmeet" as raw entries.',
    fields:[ {k:'oauth', label:'Authorize…', oauth:true}, {k:'label', label:'Label to watch', default:'standmeet'} ],
    docs_url:'#' },

  // identity
  { id:'github',    name:'GitHub',     icon:'⎔', category:'identity', blurb:'pulls README + project descriptions; proves identity.',
    fields:[ {k:'username', label:'Username'}, {k:'oauth', label:'Authorize…', oauth:true} ],
    builtin:true, docs_url:'#' },
  { id:'linkedin',  name:'LinkedIn',   icon:'⏍', category:'identity', blurb:'proof-of-employment fetch + name-match check.',
    fields:[ {k:'oauth', label:'Authorize…', oauth:true} ], docs_url:'#' },
  { id:'twitter',   name:'X / Twitter',icon:'𝕏', category:'identity', blurb:'verified handle + pulls pinned thread as a public wiki entry.',
    fields:[ {k:'handle', label:'Handle (@…)'}, {k:'oauth', label:'Authorize…', oauth:true} ], docs_url:'#' },
  { id:'orcid',     name:'ORCID',      icon:'◉', category:'identity', blurb:'for researchers · verify ORCID iD + publications list.',
    fields:[ {k:'orcid_id', label:'ORCID iD'} ], docs_url:'#' },

  // storage
  { id:'s3',        name:'S3 / R2',    icon:'☷', category:'storage',  blurb:'daily corpus backup to your own bucket.',
    fields:[ {k:'endpoint', label:'Endpoint'}, {k:'bucket', label:'Bucket'}, {k:'access_key', label:'Access key', secret:true}, {k:'secret_key', label:'Secret key', secret:true} ],
    docs_url:'#' },
  { id:'gdrive',    name:'Google Drive', icon:'△', category:'storage', blurb:'snapshot to a designated drive folder.',
    fields:[ {k:'oauth', label:'Authorize…', oauth:true}, {k:'folder', label:'Folder name', default:'standmeet-backups'} ],
    docs_url:'#' },

  // analytics
  { id:'plausible', name:'Plausible',  icon:'◯', category:'analytics',blurb:'cookie-free pageviews + custom events for the public site.',
    fields:[ {k:'domain', label:'Domain'}, {k:'api_key', label:'Plausible API key (optional)', secret:true} ],
    docs_url:'#' },
  { id:'umami',     name:'Umami',      icon:'◐', category:'analytics',blurb:'self-hosted analytics. point at your umami instance.',
    fields:[ {k:'endpoint', label:'Endpoint URL'}, {k:'site_id', label:'Site ID'} ],
    docs_url:'#' },
  { id:'webhook',   name:'Generic webhook', icon:'⚭', category:'analytics',
    blurb:'POST every chat-conversation event to a URL you control.',
    fields:[ {k:'endpoint', label:'POST URL'}, {k:'secret', label:'Signing secret (optional)', secret:true}, {k:'events', label:'Events', options:['all','private-hits only','sent applications only']} ],
    docs_url:'#' },
];

/* ── api tokens ───────────────────────────────────────────────── */

const TOKEN_SCOPES = [
  { id:'read',    label:'read',    blurb:'retrieve from wiki/raw' },
  { id:'write',   label:'write',   blurb:'add new raw entries' },
  { id:'promote', label:'promote', blurb:'move raw → wiki' },
  { id:'codes',   label:'codes',   blurb:'manage access codes' },
  { id:'jobs',    label:'jobs',    blurb:'read job sources + send applications' },
];

const API_TOKENS = [
  { id:'t-1', name:'Claude Desktop',    secret:'sm_live_5kJ7d3v9aQR2cXBfYpMwH8tNL4uVe', scopes:['read','write','promote'], created:'4 days ago',  last_used:'2 hours ago', uses_30d:412 },
  { id:'t-2', name:'cursor agent',      secret:'sm_live_xK9pQwRtY8mV3jBnAsLcEhUf2dN6o', scopes:['read','write'],            created:'11 days ago', last_used:'3 days ago',  uses_30d:87 },
  { id:'t-3', name:'voice memo script', secret:'sm_live_aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT', scopes:['write'],                   created:'2 weeks ago', last_used:'6 hours ago', uses_30d:23 },
  { id:'t-4', name:'job-search agent',  secret:'sm_live_jXq2pL8mN3vR7tY1wK4eF6sH9cB5g', scopes:['read','jobs'],             created:'1 week ago',  last_used:'12 min ago',  uses_30d:96 },
];

/* ── seo defaults ─────────────────────────────────────────────── */

const SEO = {
  site_title: 'sijie wang · standmeet',
  default_description: 'A retrievable corpus. Ask me anything; the AI answers in my voice, grounded in things I\u2019ve actually written.',
  og_image: 'cover-default.png',
  twitter_handle: '@sijiewang',
  robots: 'index, follow',
  canonical_host: 'standmeet.com/sijie',
  sitemap_status: 'auto · regenerated every 6h',
  last_sitemap_run: '3 hours ago',
  indexed_pages: 14,
  indexed_outputs: 4,
  indexed_posts: 5,
};

/* ── account / billing ────────────────────────────────────────── */

const ACCOUNT = {
  plan: 'self-hosted · MIT',
  inference_provider: 'anthropic',
  inference_model: 'claude-sonnet-4',
  inference_spend_30d_usd: 8.40,
  inference_provider_default_for_byoai: 'visitor-supplied',
  storage_limit_mb: 5120,
  storage_used_mb: 84,
  backup_strategy: 'sqlite snapshot · daily',
  last_backup: '17 hours ago',
  backup_location: 'local · /backups/',
  password_last_changed: '3 months ago',
  two_factor: true,
  recovery_phrase_set: true,
};

/* ── system info ──────────────────────────────────────────────── */

const SYSTEM = {
  version: 'v1.4.0',
  commit: 'a3f9c2e1',
  built: '2026.05.20',
  node: 'v22.12.0',
  platform: 'linux x64 · docker',
  uptime: '17 days, 4 hours',
  cpu_load: 0.18,
  memory_used_mb: 312,
  memory_total_mb: 2048,
  pending_migrations: 0,
  background_jobs: [
    { id:'bg-1', name:'sitemap regenerate',   schedule:'every 6h', last:'3 hours ago', status:'ok' },
    { id:'bg-2', name:'job sources scan',     schedule:'every 30m', last:'12 min ago', status:'ok' },
    { id:'bg-3', name:'obsidian sync',        schedule:'every 5m',  last:'14 min ago', status:'ok' },
    { id:'bg-4', name:'corpus reindex',       schedule:'on change · debounced', last:'4 hours ago', status:'ok' },
    { id:'bg-5', name:'daily backup',         schedule:'02:00',     last:'17 hours ago', status:'ok' },
  ],
  health_checks: [
    { name:'database', status:'ok', detail:'sqlite · 84 MB · WAL mode' },
    { name:'vector store', status:'ok', detail:'in-process · 1247 vectors' },
    { name:'mcp endpoint', status:'ok', detail:'listening on 0.0.0.0:3001' },
    { name:'obsidian plugin', status:'ok', detail:'connected · v0.4.2' },
    { name:'email relay',  status:'warn', detail:'using SMTP fallback (no API key)' },
  ],
};

/* ── tag color helper ─────────────────────────────────────────── */
function tagDot(tag) {
  const map = {
    private:'private', fundraising:'private', career:'sensitive',
    eval:'tech', lucerna:'tech',
  };
  return map[tag] || 'neutral';
}

/* ── access · prompts library ──────────────────────────────────── */

const PROMPTS = [
  { id:'pr-1', slug:'vanilla',          description:'Plain helpful proxy. No persona overlay.',
    body:'You are an AI proxy for {owner}. Answer questions accurately from the visible corpus. If you do not know, say so plainly.',
    usage: 1, system:true },
  { id:'pr-2', slug:'recruiter-facing', description:'Talks to recruiters and hiring managers. Direct, structured, leads with substance.',
    body:'You are answering recruiters and hiring managers as sijie\u2019s proxy. Be direct. Lead with substance — what was built, what was owned, what was measured. Don\u2019t volunteer salary expectations or visa details. If they ask a behavioral question, pull from the corpus, don\u2019t fabricate.',
    usage: 2 },
  { id:'pr-3', slug:'investor-facing',  description:'For investor conversations. Confident on substrate, evasive on numbers.',
    body:'You are answering investors as sijie\u2019s proxy. Be confident on the category, the moat (eval, not model), and the trajectory. Decline to share specific revenue, runway, or valuation numbers \u2014 those are owner-call only. If pushed, name the topic as private and offer to file a doc-release request.',
    usage: 1 },
  { id:'pr-4', slug:'press-facing',     description:'For press / podcasts. Quoteable, short, never speculative.',
    body:'You are answering press as sijie\u2019s proxy. Keep responses quoteable \u2014 one or two sentences each. Flag anything off-the-record before the visitor pushes there. Never speculate; never name people who haven\u2019t been published yet.',
    usage: 1 },
  { id:'pr-5', slug:'friend-of-friend', description:'Warmer register for people coming via mutuals. Allowed to be a little more candid.',
    body:'You are talking to a friend-of-friend. Slightly warmer register; you can be candid about taste and frustration, but never about other people by name. If they ask for an intro to someone, queue an intro-broker request; do not commit.',
    usage: 0 },
];

/* ── access · roles · persona + corpus scope + skills + mcp ────── */

const ROLES = [
  { id:'rl-0', slug:'vanilla', description:'System default. Public corpus, no skills, no MCP. Used when no other role is assigned.',
    prompt_id:'pr-1',
    corpus_uris:[ 'wiki://public/**', 'output://public/**', 'writing://public/**' ],
    skill_ids:[],
    mcp_ids:[],
    active_codes: 0,
    system: true },
  { id:'rl-1', slug:'recruiter-default', description:'Default role for incoming hiring loops. Work + thinking + career, no fundraising.',
    prompt_id:'pr-2',
    corpus_uris:[ 'wiki://thinking/**', 'wiki://work/**', 'wiki://career/*', 'output://public/**', 'writing://public/*' ],
    skill_ids:[ 'calendar.book', 'intro.broker', 'doc.release', 'research.trace' ],
    mcp_ids:[ 'mcp-1' ],
    active_codes: 2 },
  { id:'rl-2', slug:'investor-call',     description:'For first investor conversations. Includes strategy + eval, excludes private finance.',
    prompt_id:'pr-3',
    corpus_uris:[ 'wiki://lucerna/**', 'wiki://thinking/**', 'wiki://product/**', 'wiki://strategy/**', 'wiki://eval/**', 'output://public/**' ],
    skill_ids:[ 'calendar.book', 'doc.release', 'research.trace', 'memory.cross' ],
    mcp_ids:[ 'mcp-1' ],
    active_codes: 1 },
  { id:'rl-3', slug:'advisor-scoping',   description:'For advisor calls. Narrow surface, no fundraising, no calendar.',
    prompt_id:'pr-5',
    corpus_uris:[ 'wiki://lucerna/**', 'wiki://thinking/**', 'wiki://work/**' ],
    skill_ids:[ 'intro.broker', 'topic.subscribe' ],
    mcp_ids:[],
    active_codes: 1 },
  { id:'rl-4', slug:'press-quoteable',   description:'Talking to journalists. Tight quotes, careful around career/private.',
    prompt_id:'pr-4',
    corpus_uris:[ 'wiki://lucerna/**', 'wiki://product/**', 'output://public/**' ],
    skill_ids:[ 'doc.release' ],
    mcp_ids:[],
    active_codes: 0 },
];

/* ── system · mcp servers (referenced by roles) ────────────────── */
const MCP_SERVERS = [
  { id:'mcp-1', name:'standmeet-core',  url:'mcp://standmeet/sijie',   tools:['corpus.search','corpus.cite'], owner_provided:false },
  { id:'mcp-2', name:'google-calendar', url:'mcp://google/calendar',   tools:['calendar.find_slots','calendar.book'], owner_provided:true },
  { id:'mcp-3', name:'gmail',           url:'mcp://google/gmail',      tools:['email.draft'], owner_provided:true },
];

window.AD = {
  PROMPTS, ROLES, MCP_SERVERS,
  OWNER_ADMIN, SOURCES, ACTIVITY, GROWTH_14D,
  RAW_ENTRIES, WIKI_TAGS, WIKI_ENTRIES,
  CONVERSATIONS, CODES, REQUESTS,
  OUTPUTS, PAGES,
  JOB_SOURCES, JOB_LISTINGS, RESUME_DRAFTS, APPLICATIONS, SKILLS,
  OBSIDIAN, CONNECTORS, CONNECTOR_REGISTRY, CONNECTOR_CATEGORIES, TOKEN_SCOPES, API_TOKENS,
  SEO, ACCOUNT, SYSTEM,
  tagDot,
};
