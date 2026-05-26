/* visitor-data.js — public-facing corpus data exposed to wiki / output / page surfaces.
 *
 * What a real backend would serve to anonymous + coded + BYOAI visitors.
 * Mock here mirrors the shapes in admin-data.js but trimmed to public fields.
 * Loads onto window.VD so each surface can pluck what it needs.
 */

const OWNER = {
  handle: 'sijie',
  full:   'sijie wang',
  location: 'Markham, Ontario',
  bio_short: 'building Lucerna · ex Google Brain · obsessed with how people think with their past selves',
  email: 'hello@standmeet.com',
};

/* Wiki entries — public + on-request. Each maps to /wiki/<slug>.
 * Visibility filtering happens in the surface based on URL ?c=… code. */

const WIKI = [
  {
    slug: 'eval-is-the-product',
    title: 'Eval is the product, model is the tax',
    excerpt: 'About half the bad retrieval examples we look at aren’t model failures — they’re eval failures. Fix the eval, the model "gets better" by twenty points overnight.',
    body: [
      { kind:'p', text:'Most ML teams I’ve sat with treat their evaluation suite as a finished thing — a fixture that measures whatever the modeling work happens to produce. The thinking goes: the eval is the ruler, the model is the thing being measured, and progress means moving the model along the ruler.' },
      { kind:'p', text:'This is exactly backwards. The eval is the product. The model is downstream of it.' },
      { kind:'pull', text:'If your eval is wrong, every modeling decision downstream of it is a coin flip dressed in lab coats.' },
      { kind:'p', text:'At Lucerna we run on the same principle. The model itself isn’t our moat — it’s LLM-grade work that two years from now any well-funded team could match. The moat is the eval.' },
    ],
    tags: ['lucerna','eval','thinking'],
    visibility: 'public',
    last_edited: '2 weeks ago',
    sources: 3,
    seo: {
      description: 'A working principle for retrieval systems: the eval is the product, the model is the tax.',
      keywords: ['retrieval eval','RAG eval','ML evaluation','llm eval'],
      og_hue: 'amber',
    },
    related: ['why-second-brains-fail','translation-layer'],
    backlinks: ['lucerna-honestly','we-shipped-the-wrong-10x'],
  },
  {
    slug: 'why-second-brains-fail',
    title: 'Why second brains fail',
    excerpt: 'The problem isn’t capture. It’s that capture without conversation produces a mausoleum.',
    body: [
      { kind:'p', text:'I’ve owned every note-taking app you can name. Roam, Obsidian, Notion, Logseq, the homegrown markdown vault, the org-mode rig. They all promised the same thing: a second brain that would let me think with my past self. They all failed in the same way.' },
      { kind:'p', text:'The failure isn’t about capture. Capture is, if anything, too easy. The failure is that capture without retrieval that talks back produces a mausoleum: a beautiful building you visit, light a candle, leave.' },
      { kind:'pull', text:'A second brain that doesn’t talk back is just a sad library card you keep losing.' },
      { kind:'p', text:'The bar I care about isn’t storage. It’s being able to ask my past self a question and have it answer in something like its own voice.' },
    ],
    tags: ['thinking','tools'],
    visibility: 'public',
    last_edited: '11 days ago',
    sources: 4,
    seo: {
      description: 'Capture without retrieval that talks back produces a mausoleum. Why your notes app isn’t a second brain.',
      keywords: ['second brain','notes','retrieval','obsidian','roam'],
      og_hue: 'violet',
    },
    related: ['eval-is-the-product','translation-layer'],
    backlinks: ['lucerna-honestly'],
  },
  {
    slug: 'translation-layer',
    title: 'Engineering is the translation layer',
    excerpt: 'Most of what I do is reading other people’s intentions and translating them into systems that won’t surprise anyone six months later. The translation is the job; the typing is incidental.',
    body: [
      { kind:'p', text:'The question assumes engineering is what we currently call engineering. It isn’t. Most of the work I do — the part that produces the durable artifact — is translation.' },
      { kind:'pull', text:'The field will narrow toward people who can hold context across systems and widen toward anyone who can describe a system clearly.' },
      { kind:'p', text:'AI replaces the typing, brilliantly. AI does not — yet — replace the part of engineering that holds seven half-formed constraints in your head while three stakeholders contradict each other in three different vocabularies.' },
    ],
    tags: ['thinking','ai','work'],
    visibility: 'public',
    last_edited: '2 days ago',
    sources: 3,
    seo: {
      description: 'Engineering is mostly intention-translation. AI replaces the typing, not the translation. A take on what the field becomes.',
      keywords: ['AI replacing engineers','translation layer','engineering future'],
      og_hue: 'acid',
    },
    related: ['eval-is-the-product','why-second-brains-fail'],
    backlinks: ['lucerna-honestly'],
  },
  {
    slug: 'lucerna-honestly',
    title: 'What Lucerna is, honestly',
    excerpt: 'We tell people we build retrieval systems for personal corpora. Closer to the truth: we’re trying to make it possible to think with your past self again.',
    body: [
      { kind:'p', text:'Public answer: we build retrieval infrastructure for personal corpora. True. Boring.' },
      { kind:'p', text:'Honest answer: we’re trying to make it possible to think with your past self again. The primitives finally landed in 2023 — good embeddings, fast vector search, capable open models — but the substrate is still missing.' },
    ],
    tags: ['lucerna','product'],
    visibility: 'public',
    last_edited: '6 days ago',
    sources: 5,
    seo: {
      description: 'Lucerna builds retrieval infrastructure for personal corpora. The honest version: we want you to be able to think with your past self.',
      keywords: ['Lucerna','retrieval','personal corpus','RAG'],
      og_hue: 'amber',
    },
    related: ['why-second-brains-fail','eval-is-the-product'],
    backlinks: ['translation-layer'],
  },
  {
    slug: 'why-i-left',
    title: 'Why I left',
    excerpt: 'The team I cared about had been functionally dissolved for nine months. I was performing engineering while doing politics.',
    body: [],
    locked_body: 'This essay is one of the entries sijie keeps private on the corpus. It’s included in scopes for trusted conversations (close investor / advisor codes). Ask for a code if you have reason to read it.',
    tags: ['career','private'],
    visibility: 'on-request',
    last_edited: '8 hours ago',
    sources: 2,
    seo: {
      description: 'A private essay. Available on request.',
      keywords: [],
      og_hue: 'violet',
    },
    related: [],
    backlinks: [],
  },
];

/* Outputs — public-facing artifacts assembled from wiki entries. /output/<slug> */

const OUTPUTS = [
  {
    slug: 'the-eval-rubric',
    title: 'The Eval Rubric',
    tagline: 'A 4-page primer on faithfulness, attribution, refusal-when-absent.',
    tier: 'public',
    format: 'pdf+web',
    cover_hue: 'amber',
    published_at: '2026.05.04',
    pages: 4,
    download_kb: 184,
    excerpt: 'How to grade retrieval the way it matters. A working rubric, the three columns we use at Lucerna, and twelve examples of what gets each rating.',
    body: [
      { kind:'h', text:'Why grade retrieval at all' },
      { kind:'p', text:'Most retrieval evals reward fluency, not faithfulness. They ask "did the answer sound right?" — a measure that is increasingly orthogonal to whether the answer is grounded in the underlying corpus.' },
      { kind:'p', text:'A working eval needs three columns, in this order.' },
      { kind:'h', text:'01 · Faithfulness' },
      { kind:'p', text:'For every claim in the answer, can you trace it back to an entry in the corpus? Not "is it true in general" — is it supported by what the corpus actually says? If retrieval invents detail that the corpus doesn’t carry, faithfulness drops, even if the invention happens to be correct.' },
      { kind:'h', text:'02 · Attribution' },
      { kind:'p', text:'When the answer is faithful, can the system point to which entry supports which claim? A faithful answer with no attribution is half a product — the user can’t verify, so they either trust everything or they trust nothing.' },
      { kind:'h', text:'03 · Refusal-when-absent' },
      { kind:'p', text:'When the corpus doesn’t carry the answer, does the system say so? Or does it fabricate something plausible? This is the eval column most teams skip, because their benchmark sets are biased toward answerable questions.' },
      { kind:'pull', text:'Fluency is the column that wants to sneak in. It looks like quality but rewards the wrong thing.' },
      { kind:'p', text:'The fourth column everyone tries to sneak in is fluency — "did the response read well?" Resist this. Fluency is downstream of the modeling work and rewards the wrong thing.' },
    ],
    leads_pitch: 'Get the full rubric + 12 worked examples as a PDF.',
    related: ['translation-layer'],
    seo: {
      description: 'A 4-page guide to writing better retrieval evals. Faithfulness, attribution, refusal-when-absent.',
      keywords: ['retrieval eval','RAG eval','llm eval','evaluation rubric','rag faithfulness'],
    },
  },
  {
    slug: 'translation-layer',
    title: 'The Translation Layer',
    tagline: 'Engineering is mostly intention-translation. AI replaces the typing, not the job.',
    tier: 'public',
    format: 'web',
    cover_hue: 'acid',
    published_at: '2026.04.18',
    pages: null,
    download_kb: 0,
    excerpt: 'A long-form essay on what engineering is once AI absorbs the bottom half of the field.',
    body: [
      { kind:'p', text:'The first time someone asked me "will AI replace engineers" I gave the polite answer. The polite answer is wrong, because the question is wrong.' },
      { kind:'pull', text:'The field will narrow toward people who can hold context across systems, and widen toward anyone who can describe a system clearly.' },
      { kind:'p', text:'AI replaces the typing, brilliantly. Most of what I watch junior engineers do in 2026 is being done at four-times speed by someone with Claude and decent taste. That gap will close, then invert.' },
      { kind:'p', text:'My five-year prediction: the field narrows toward people who can hold context across systems, and widens toward anyone who can describe a system clearly. The bottom half of the current pyramid evaporates. The top half gets weirder and more architectural, less tactical. The middle is mostly gone.' },
    ],
    leads_pitch: null,
    related: ['the-eval-rubric'],
    seo: {
      description: 'A working principle for the post-AI engineering org. Translation, not typing.',
      keywords: ['AI engineering','future of engineering','translation layer','staff engineer ai'],
    },
  },
  {
    slug: 'personal-corpus-deck',
    title: 'Personal Corpus · investor deck',
    tagline: 'The 9-slide deck. Unlisted — enter on a code or request access.',
    tier: 'unlisted',
    format: 'pdf',
    cover_hue: 'violet',
    published_at: '2026.05.01',
    pages: 9,
    download_kb: 2840,
    excerpt: 'Where Lucerna sits in the personal-retrieval space, where the moat is, and the shape of the round.',
    body: [],
    locked_body: 'Investor deck is gated. Enter on a valid code or request access through the gate.',
    leads_pitch: null,
    related: [],
    seo: {
      description: '',
      keywords: [],
    },
  },
];

/* Pages — custom React surfaces /p/<slug>. Each binds a template + data. */

const PAGES = [
  {
    slug: 'press',
    title: 'Press kit',
    template: 'press-kit',
    visibility: 'public',
    blurb: 'Headshot, bio variants, downloadable assets, and the canonical short link to the work.',
    data: {
      headshot_caption: 'photo by Yulia Park · 2026',
      bios: [
        { length: 'one-line', text: 'sijie wang — building Lucerna, a retrieval substrate for personal corpora; previously research engineer at Google Brain.' },
        { length: 'short',    text: 'Sijie Wang builds Lucerna, retrieval infrastructure for personal corpora. Previously at Google Brain, where he led retrieval-quality for a 2023 product launch. Based in Markham, Ontario.' },
        { length: 'long',     text: 'Sijie Wang is the founder of Lucerna, where his team is building retrieval infrastructure that lets people think with their past selves. Before Lucerna he spent five years at Google Brain leading retrieval-quality for an unnamed 2023 product launch, taking top-1 from 38% to 71% over nine months. He writes long-form essays on retrieval, engineering, and what the field becomes after AI absorbs the bottom of the pyramid. He lives in Markham, Ontario, and reads Kafka in German for the pleasure of difficulty.' },
      ],
      assets: [
        { label: 'headshot · web', size: '1.4 mb · 2400×3000' },
        { label: 'headshot · print', size: '4.2 mb · 6000×7500' },
        { label: 'lucerna logo · light', size: '12 kb · svg' },
        { label: 'lucerna logo · dark',  size: '12 kb · svg' },
      ],
      links: [
        { label: 'recent writing',  url: '/blog' },
        { label: 'the eval rubric · pdf', url: '/output/the-eval-rubric' },
        { label: 'lucerna',         url: 'lucerna.dev' },
      ],
      contact: {
        booking: 'hello@standmeet.com',
        agent:   'No agent. Direct inquiries fine.',
      },
    },
  },
  {
    slug: 'speaking',
    title: 'Speaking',
    template: 'list-with-prose',
    visibility: 'public',
    blurb: 'Past + upcoming talks, with the what-I’ll-say-yes-to filter.',
    data: {
      prose: 'I take a small number of speaking engagements a year. The filter: technical audience, real q&a time built in, and the topic is something I’ve actually been writing about. I don’t do "future of AI" talks for a general audience — there are people better at that.',
      lists: [
        {
          title: 'upcoming',
          items: [
            { date: '2026.07.14', title: 'Retrieval Day · keynote',    where: 'San Francisco', kind: 'public' },
            { date: '2026.09.02', title: 'A small team’s eval',    where: 'workshop · invite only', kind: 'private' },
          ],
        },
        {
          title: 'past',
          items: [
            { date: '2026.03.20', title: 'Engineering as translation',  where: 'YC W26 internal', kind: 'private' },
            { date: '2025.11.04', title: 'Personal corpora, finally',   where: 'Strange Loop', kind: 'public', link: '/output/translation-layer' },
            { date: '2025.06.18', title: 'How we rebuilt our eval',     where: 'Google Brain seminar', kind: 'private' },
          ],
        },
      ],
    },
  },
  {
    slug: 'advisor',
    title: 'Advisor menu',
    template: 'menu',
    visibility: 'gated',
    blurb: 'What I take advisor calls on, what I don’t, how to ask.',
    data: {
      intro: 'I advise one or two founders per quarter, almost always at the seed/A stage, almost always on retrieval or evaluation. The shape: a 30-min monthly call + a slack channel + occasional async review. Equity-only, no cash.',
      items: [
        { no: '01', title: 'I’ll say yes to', body: 'Retrieval infrastructure. Evaluation methodology for ML systems. Personal-corpus product shape. Indie/founder-shaped technical strategy.' },
        { no: '02', title: 'I’ll say no to', body: 'General "AI strategy." Generic "advice on the round." Anything that’s really a recruiter conversation in disguise.' },
        { no: '03', title: 'How to ask', body: 'Send a code-request through the gate with the specific question you want help with. If the question is real and the question is in the first list, I’ll usually say yes.' },
      ],
    },
  },
  {
    slug: 'now',
    title: 'Now',
    template: 'auto-now',
    visibility: 'public',
    blurb: 'A /now page, regenerated weekly by AI from the latest 10 raw entries.',
    data: {
      updated: 'today · 14:42',
      paragraphs: [
        'Building Lucerna. The team is four people. We just signed our second customer — a research lab that wanted a way to query twelve years of meeting notes.',
        'Rewriting the eval rubric for personal corpora. Faithfulness, attribution, refusal-when-absent, in that order. Most of our recent gains are downstream of getting this right.',
        'Reading Kafka. The German is a vehicle for the difficulty, which is the actual point.',
        'Not looking for full-time roles. Open to advisory at seed/A, investor conversations, and research collaboration. The rest of the filter is on the /advisor page.',
      ],
      pulled_from: ['r-301','r-300','r-298','r-296'],
    },
  },
];

window.VD = { OWNER, WIKI, OUTPUTS, PAGES };
