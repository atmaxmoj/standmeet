// Mock corpus for StandMeet — Surface 3 (Visitor / Screening).
// Replaces the original "literary fragments" model with a screening-shaped
// curated Q&A set, plus a free-form ask path for off-menu questions.

const OWNER = {
  handle: 'sijie',
  full:   'sijie wang',
  role:   'indie · markham',
  past:   'previously: research engineer @ Google Brain · eng @ Stripe',
  one_liner: 'building a retrieval substrate that lets people think with their past selves',
  location: 'Markham, Ontario',
  status_open:     'open to: founding eng / staff IC at Series A+ AI startups',
  status_closed:   'not open to: full-time roles outside that filter · most podcast appearances',
  corpus_size: 1247,
  last_ingest: '3 days ago',
};

// Curated screening questions, grouped. Click any → answer expands inline.
const SECTIONS = [
  {
    id: 'work',
    title: 'work & trajectory',
    questions: [
      { id: 'q-now',         label: 'What are you working on right now?',                       key: 'now' },
      { id: 'q-bg',          label: 'Walk me through your background.',                         key: 'bg' },
      { id: 'q-owned',       label: 'What did you actually own at your last role?',             key: 'owned' },
      { id: 'q-leave',       label: 'Why did you leave?',                                       key: 'leave',       private: true },
    ],
  },
  {
    id: 'thinking',
    title: 'thinking',
    questions: [
      { id: 'q-why-lucerna', label: 'Why does Lucerna exist?',                                  key: 'why-lucerna' },
      { id: 'q-ai-eng',      label: 'How do you think about AI replacing engineers?',           key: 'ai-eng' },
      { id: 'q-changed',     label: 'What’s something you’ve changed your mind about?', key: 'changed' },
      { id: 'q-disagree',    label: 'What’s a take you hold that most peers disagree with?', key: 'disagree' },
    ],
  },
  {
    id: 'fit',
    title: 'fit & availability',
    questions: [
      { id: 'q-role',        label: 'What kind of role are you open to right now?',             key: 'role' },
      { id: 'q-fund',        label: 'Are you fundraising?',                                     key: 'fund',        private: true },
      { id: 'q-weak',        label: 'What are you NOT good at?',                                key: 'weak' },
      { id: 'q-how',         label: 'How do you actually work day-to-day?',                     key: 'how' },
    ],
  },
];

// Suggested off-menu probes (for the custom ask input)
const SUGGESTED = [
  { q: 'Is your retrieval actually better than vanilla RAG?', key: 'retrieval-vs-rag' },
  { q: 'What’s the best thing you’ve shipped?',     key: 'best-shipped' },
  { q: 'What should I read of yours?',                        key: 'what-read' },
];

const ANSWERS = {
  // ── work & trajectory ────────────────────────────────────────────────────
  'now': {
    paras: [
      'Lucerna. We build retrieval infrastructure for personal corpora — text, conversations, notes, voice memos, whatever a single human produces. The layer that makes “searching your own thinking” actually work, instead of the broken text-search you get in note apps today.',
      'Right now we’re four people. I write code, do the long-form thinking about what we’re building, and run most of the early sales conversations. K. (who I worked with at Stripe) leads retrieval quality. We just signed our second customer — a research lab that wanted to give their PI a way to query twelve years of meeting notes.',
      'If you’re here because you might invest, the deck’s on request. If you’re here because you might use it, the waitlist is on the homepage. If you’re hiring me, I’ll save you the read: I’m not looking for full-time roles.',
    ],
    cites: [
      { date: '2025.05.02', title: 'lucerna · weekly note' },
      { date: '2025.04.18', title: 'where the four of us are spending time' },
    ],
    tools: [
      {
        kind: 'file',
        name: 'lucerna-seed-deck.pdf',
        size: '4.1 MB',
        access: 'investor / partner only',
        caption: 'Lucerna seed deck — 16 slides, current as of May 2025.',
        action: { label: 'request deck', href: 'mailto:hello@standmeet.example?subject=re%3A%20lucerna%20deck' },
      },
    ],
  },
  'bg': {
    paras: [
      'Applied math at Tsinghua, then a PhD at Stanford on representation learning. I finished it but never published the thesis because the field moved past it twice while I was writing. Useful lesson.',
      'Joined Google Brain in 2019 as a research engineer. Two years on retrieval models, two more on a team whose work seeded some of what people now call “memory” in modern assistants. Left in early 2024 to start Lucerna.',
      'In between Google and Stanford I had short stints at two places I won’t name on a public page. Happy to walk through those in a real conversation if it’s relevant.',
    ],
    cites: [
      { date: '2024.12.09', title: 'a long-form bio I keep rewriting' },
    ],
  },
  'owned': {
    paras: [
      'At Google Brain, work split roughly 60/40 between research and infrastructure. The piece I’m proudest of: I led retrieval-quality for a 2023 product launch I can’t name here. We took a system that hit 38% top-1 on the eval we cared about and got it to 71% over nine months, without retraining the underlying model.',
      'The honest version of how: about half the bad examples weren’t model failures, they were eval failures. We rebuilt the eval, the model “got better” by twenty points overnight, and then we still had thirteen real points to close with actual modeling work. The reframing was the contribution; the modeling was the tax.',
      'I also wrote the team’s onboarding doc for new ML engineers — it got copied into three adjacent teams. I mention it because the question was “what did you OWN,” and that doc is one of the few artifacts I owned end-to-end.',
    ],
    cites: [
      { date: '2024.07.21', title: 'what I actually did at Brain' },
      { date: '2024.02.15', title: 'eval is the product, model is the tax' },
    ],
  },
  'leave': {
    private: true,
    paras: [
      'I’ve written about this in the corpus, but I haven’t made it public. The short version isn’t the interesting version, and the interesting version belongs in a real conversation — not a chat reply that someone screenshots out of context.',
    ],
    cites: [],
    tools: [
      {
        kind: 'calendar',
        purpose: '15 min with sijie',
        slots: [
          { date: 'Tue May 19', time: '10:00 PT', dur: '15m' },
          { date: 'Wed May 20', time: '14:30 PT', dur: '15m' },
          { date: 'Fri May 22', time: '09:00 PT', dur: '15m' },
        ],
        caption: 'If you actually need to know this, the answer is a conversation. Hold a slot — sijie reviews holds and confirms within a day.',
      },
    ],
    cta: { label: 'or just email', href: 'mailto:hello@standmeet.example?subject=re%3A%20why%20you%20left' },
  },

  // ── thinking ─────────────────────────────────────────────────────────────
  'why-lucerna': {
    paras: [
      'The thing that exists today and shouldn’t: nobody can search their own thinking. Every adult has produced more text in the last five years than they could re-read in a lifetime, and none of it is queryable in a way that lets you talk to your past self. Search bars, folder hierarchies, tags — these are 1990s answers to a problem that’s now twenty times bigger.',
      'Lucerna exists because the primitives to fix this finally landed (good embeddings, fast vector search, capable open models) and nobody is building the substrate. Everybody is building chatbots on top of nothing. We’re building the nothing — well, the something.',
    ],
    cites: [
      { date: '2025.03.11', title: 'what Lucerna is, honestly' },
      { date: '2025.01.27', title: 'capture is a workaround' },
    ],
  },
  'ai-eng': {
    paras: [
      'The question assumes engineering is what we currently call engineering. It isn’t. Most of what I do is reading other people’s intentions and translating them into systems that won’t surprise anyone six months later. The translation is the job; the typing is incidental.',
      'So the honest version of the question: will AI replace the part of engineering that’s already most automatable? Probably, and quickly. Will it replace the part that’s most engineering — holding seven half-formed constraints in your head while three stakeholders contradict each other? Not soon. That part isn’t a skill, it’s a posture.',
      'The field will narrow toward people who can hold context across systems, and widen toward anyone who can describe a system clearly. Most of the panic I see is from people whose job was neither.',
    ],
    cites: [
      { date: '2025.04.22', title: 'on AI replacing engineers' },
      { date: '2024.11.03', title: 'the translation layer' },
    ],
  },
  'changed': {
    paras: [
      'I used to believe the right strategy for any technical product was “make the thing 10x better than what exists.” I spent a year at Lucerna trying to make our retrieval engine 10x faster and 10x more accurate. We did it. It didn’t matter — nobody could feel the difference until they had a reason to use the thing at all.',
      'What I believe now: most product wins come from changing what the user is trying to do, not from improving how well they do the existing thing. Lucerna’s actual product is “talk to your past self,” not “better search.” Took me a year to figure that out and the technical work was almost a distraction from the real problem.',
    ],
    cites: [
      { date: '2025.02.28', title: 'we shipped the wrong 10x' },
    ],
  },
  'disagree': {
    paras: [
      'AI maximalists are wrong about the timeline. AI minimalists are wrong about the scale. The thing nobody around me is willing to say plainly: software engineering as a profession survives mainly because it’s been the cheapest path from intention to computation, and AI just made the translation step roughly fifty times cheaper for the easier half of cases. The bottom half of the field is going to evaporate quickly.',
      'I say this and engineers I respect tell me I’m being alarmist. I think they’re being polite. Most of the work I watch junior-to-mid engineers do in 2025 is being done at four-times speed by someone with Claude and decent taste. That gap will close, then invert. The senior tier survives because their job is mostly judgment, not output.',
    ],
    cites: [
      { date: '2025.04.22', title: 'on AI replacing engineers' },
      { date: '2025.03.30', title: 'who’s being polite' },
    ],
  },

  // ── fit & availability ───────────────────────────────────────────────────
  'role': {
    paras: [
      'Not looking for full-time roles. I’m building Lucerna for at least the next three years and walking away would mean killing it.',
      'Open to: advisory in retrieval, cognition, or AI tooling — one or two founders per quarter, only for products I’d actually use. Investor conversations if you write seed checks in thinking-tools or AI infrastructure. Research collaboration if you have a corpus nobody’s let anyone query in interesting ways.',
      'Not open to: speaking engagements without honoraria, podcast appearances on “the future of AI,” and most consulting.',
    ],
    cites: [
      { date: '2025.04.30', title: 'what I say yes / no to this year' },
    ],
    tool_calls: [
      { tool: 'calendar.find_slots', result: { kind: 'calendar', slots: [
        { day: 'Tue · May 28', time: '10:30–11:00 PT' },
        { day: 'Wed · May 29', time: '14:00–14:30 PT' },
        { day: 'Thu · May 30', time: '09:00–09:30 PT' },
      ]}},
    ],
  },
  'fund': {
    private: true,
    paras: [
      'I don’t answer this one on a public page. Email me if it’s relevant to your reason for asking and I’ll tell you where things stand.',
    ],
    cites: [],
    cta: { label: 'ask sijie directly', href: 'mailto:hello@standmeet.example?subject=re%3A%20fundraising' },
  },
  'weak': {
    paras: [
      'Operating cadence. I work in bursts and the lows are real. If you’re hiring a steady-state operator, that’s not me — I’d be lying to you and to myself.',
      'Selling against incumbents. When someone’s already paying for the wrong tool, my instinct is to argue the tool is wrong, which is correct and useless. I’m getting better at this but it’s slow.',
      'Reading rooms. I can have a great conversation with one person and miss group dynamics completely. I’ve lost a couple of meetings this way. I bring K. to anything that matters now.',
    ],
    cites: [
      { date: '2025.01.14', title: 'failure modes I’ve confirmed twice' },
    ],
  },
  'how': {
    paras: [
      'Calendar’s mostly empty by design. One standing weekly with the team, the rest of the week unstructured. Most of the work I do that matters is reading, writing, and prototyping — none of which survives meeting-shaped time.',
      'I write everything down. Long-form, in the corpus this AI is grounded in. The act of writing is what tells me whether I actually understand something. If I can’t write the explanation, I haven’t done the thinking.',
      'Mornings for hard problems, afternoons for people, evenings protected. Beijing–SF makes that genuinely hard but I try.',
    ],
    cites: [
      { date: '2024.10.05', title: 'my week, on paper vs in practice' },
    ],
  },

  // ── off-menu canned answers (suggested probes) ───────────────────────────
  'retrieval-vs-rag': {
    paras: [
      'For most public benchmarks: marginally. For personal corpora with sub-100K entries and asymmetric query shape (questions about your own past), substantially — we’re running about 1.7x retrieval quality over the strongest open RAG baseline on internal evals, and the gap is bigger when the corpus is messier.',
      'The honest framing: the model isn’t the moat. The evaluation is the moat. We’ve built the best eval for personal corpora I’ve seen and most of our progress is downstream of that. Happy to walk you through the methodology if you NDA in.',
    ],
    cites: [
      { date: '2025.04.02', title: 'our internal eval, redacted' },
    ],
    tools: [
      {
        kind: 'file',
        name: 'eval-methodology.pdf',
        size: '2.4 MB',
        access: 'NDA required',
        caption: 'How we evaluate retrieval on personal corpora — 28 pages, includes the held-out set construction.',
        action: { label: 'request access', href: 'mailto:hello@standmeet.example?subject=re%3A%20eval%20methodology' },
      },
      {
        kind: 'image',
        src: 'eval-chart',
        caption: 'Quality vs. recall on the internal eval, redacted axis labels. Lucerna (red) vs. strongest open RAG baseline (grey).',
      },
    ],
  },
  'best-shipped': {
    paras: [
      'Honest answer: a two-page doc nobody outside Google ever saw. It killed a project I’d worked on for sixteen months and saved the team another year on the same path. Hardest thing I’ve written, best thing I’ve shipped.',
      'Public answer: the retrieval-quality work for the 2023 launch I keep referring to without naming. You can probably guess which one.',
    ],
    cites: [
      { date: '2024.07.21', title: 'what I actually did at Brain' },
    ],
  },
  'what-read': {
    paras: [
      'Two pieces: an essay called “the translation layer” (2024.11) on why engineering is mostly intention-translation, and a shorter one called “why second brains fail” (2025.02) on capture being a workaround. Neither is published on the open web. Ask for the link directly.',
    ],
    cites: [
      { date: '2024.11.03', title: 'the translation layer' },
      { date: '2025.02.04', title: 'why second brains fail' },
    ],
    tools: [
      {
        kind: 'link',
        title: 'the translation layer',
        meta:  'essay · 2024.11.03 · ≈12 min read',
        caption: 'on engineering as intention-translation',
        action: { label: 'request link', href: 'mailto:hello@standmeet.example?subject=re%3A%20translation%20layer' },
      },
      {
        kind: 'link',
        title: 'why second brains fail',
        meta:  'essay · 2025.02.04 · ≈6 min read',
        caption: 'on capture being a workaround for retrieval',
        action: { label: 'request link', href: 'mailto:hello@standmeet.example?subject=re%3A%20second%20brains' },
      },
    ],
  },

  '_unknown': {
    paras: [
      'I haven’t written about this in the corpus yet — or I have, but not under a phrasing the retrieval caught. Try rephrasing more specifically (“how do you think about X” works better than “tell me about X”), or ping me directly and I’ll add it.',
    ],
    cites: [],
    cta: { label: 'ask sijie directly', href: 'mailto:hello@standmeet.example' },
  },
};

// Free-text router for custom questions (mock).
// Order matters: private/personal checks first so they shadow looser keywords.
function routeQuery(q) {
  const s = q.toLowerCase();
  if (/leave|left|quit|fired|why.*last|previous job/.test(s))           return 'leave';
  if (/fundrais|\braising\b|\bround\b|\bseed\b|\bseries\b|valuation/.test(s))           return 'fund';
  if (/rag|retrieval|vector|embed|search.*better/.test(s))              return 'retrieval-vs-rag';
  if (/best.*ship|proudest|biggest.*win|most proud/.test(s))            return 'best-shipped';
  if (/read|essay|write|blog|writing|publish/.test(s))                  return 'what-read';
  if (/replac|engineer|coder|software|developer|programm/.test(s))      return 'ai-eng';
  if (/lucerna|startup|your product|building.*now|working on/.test(s))  return 'now';
  if (/background|career|history|where.*work|past role/.test(s))        return 'bg';
  if (/own|responsible|lead/.test(s))                                    return 'owned';
  if (/changed.*mind|used to.*think|revised/.test(s))                    return 'changed';
  if (/disagree|controversial|unpopular|hot take/.test(s))               return 'disagree';
  if (/role|hire|available|open to|looking for/.test(s))                 return 'role';
  if (/weak|bad at|not good|fail|struggle/.test(s))                      return 'weak';
  if (/how.*work|day.*day|routine|schedule|process/.test(s))             return 'how';
  return '_unknown';
}

window.OWNER     = OWNER;
window.SECTIONS  = SECTIONS;
window.SUGGESTED = SUGGESTED;
window.ANSWERS   = ANSWERS;
window.routeQuery = routeQuery;
