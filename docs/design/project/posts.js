// posts.js — mock blog data for StandMeet
// Posts are corpus entries with the `published=true` flag. Each carries a slug,
// cover, tags, visibility, and may cross-reference other wiki/post slugs.
//
// Lives on window.POSTS so the index, the article view, and the chat link-up
// can all read from one source.

const POSTS = [
  {
    slug: 'evaluation-is-the-product',
    title: 'Evaluation is the product. The model is the tax.',
    date: '2026.05.12',
    iso: '2026-05-12',
    read_minutes: 9,
    tags: ['lucerna', 'eval', 'thinking'],
    visibility: 'public',
    cover: {
      // hand-drawn SVG cover — typographic; rendered inline by the article page
      kind: 'typo',
      headline: 'eval is the product.',
      sub: 'the model is the tax.',
      hue: 'amber',
    },
    excerpt: 'About half the bad retrieval examples we look at aren’t model failures — they’re eval failures. Rebuild the rubric and the model "gets better" by twenty points overnight.',
    body: [
      { kind: 'p', text: 'Most ML teams I’ve sat with treat their evaluation suite as a finished thing — a fixture that measures whatever the modeling work happens to produce. The thinking goes: the eval is the ruler, the model is the thing being measured, and progress means moving the model along the ruler.' },
      { kind: 'p', text: 'This is exactly backwards. The eval is the product. The model is downstream of it.' },
      { kind: 'p', text: 'Here’s the version of this that took me two years at Brain to internalize. We had a retrieval system whose top-1 sat at 38% on the benchmark we cared about. We spent six months on modeling changes — better embeddings, hard negative mining, reranking, the whole stack. We moved the number to 41%. The team felt the work was producing ~zero, which it was.' },
      { kind: 'pull', text: 'If your eval is wrong, every modeling decision downstream of it is a coin flip dressed in lab coats.' },
      { kind: 'p', text: 'Then someone — not on the modeling team, not even on ML — looked at our eval rubric and asked what counted as a correct answer. The answer was: whatever the original annotation pipeline labeled as relevant. The annotation pipeline had been built two years prior, by a different team, for a different product surface, with rules nobody could fully reconstruct.' },
      { kind: 'p', text: 'We rebuilt the eval from scratch. Three new annotators, a fresh rubric written in plain English, every disagreement adjudicated by reading. It took six weeks. When we re-ran our existing models against the new eval, top-1 jumped to 58% — twenty points overnight, no modeling changes. We then spent another four months doing actual modeling work and finished the year at 71%.' },
      { kind: 'h', text: 'The reframing was the contribution; the modeling was the tax.' },
      { kind: 'p', text: 'I keep using this story because the conclusion is generic. If your eval is wrong, every modeling decision downstream of it is a coin flip dressed in lab coats. You will mistake noise for signal, get punished for fixing real bugs, get rewarded for memorizing the test set, and not be able to tell which is which. Worse, you’ll feel productive — twenty engineers shipping commits is a lot of motion.' },
      { kind: 'p', text: 'At Lucerna we run on the same principle. The model itself isn’t our moat — it’s LLM-grade work that two years from now any well-funded team could match. The moat is the eval. We’ve built the most rigorous personal-corpus retrieval eval I’ve seen, and roughly 60% of our quarter-over-quarter improvement is downstream of evaluation work, not model work.' },
      { kind: 'p', text: 'You can copy our model architecture. You can’t copy our eval methodology without spending nine months annotating, and by then we’ve moved.' },
    ],
    cross_refs: ['why-second-brains-fail', 'translation-layer'],
  },

  {
    slug: 'why-second-brains-fail',
    title: 'Why second brains fail',
    date: '2026.04.04',
    iso: '2026-04-04',
    read_minutes: 6,
    tags: ['thinking', 'tools'],
    visibility: 'public',
    cover: {
      kind: 'typo',
      headline: 'a mausoleum',
      sub: 'is not a brain.',
      hue: 'violet',
    },
    excerpt: 'The problem isn’t capture. It’s that capture without conversation produces a mausoleum.',
    body: [
      { kind: 'p', text: 'I’ve owned every note-taking app you can name. Roam, Obsidian, Notion, Logseq, Anytype, the homegrown markdown vault, the org-mode rig. They all promised the same thing: a second brain that would let me think with my past self. They all failed in the same way.' },
      { kind: 'p', text: 'The failure isn’t about capture. Capture is, if anything, too easy. The failure is that capture without retrieval that talks back produces a mausoleum: a beautiful building you visit, light a candle, leave.' },
      { kind: 'pull', text: 'A second brain that doesn’t talk back is just a sad library card you keep losing.' },
      { kind: 'p', text: 'Picture the act you actually want. You’re working through a problem and a phrase tugs at the back of your head — "didn’t I think about something like this last winter?" In a working second brain, you’d ask. The system would surface the thread, with enough context that you can pick it back up. It would talk to you in the same voice you wrote in.' },
      { kind: 'p', text: 'Note apps don’t do this. They give you full-text search over a folder hierarchy you can’t remember the shape of. The hit rate is roughly zero, and you stop checking after the second time it doesn’t work.' },
      { kind: 'p', text: 'The bar I care about isn’t storage. It’s being able to ask my past self a question and have it answer in something like its own voice. That’s the real unlock, and it’s only possible now — retrieval is finally good enough, language models are finally good enough, and yet the existing market is still selling more capture surfaces.' },
      { kind: 'p', text: 'Lucerna exists to bridge that gap.' },
    ],
    cross_refs: ['evaluation-is-the-product', 'translation-layer'],
  },

  {
    slug: 'translation-layer',
    title: 'Engineering is the translation layer',
    date: '2026.03.18',
    iso: '2026-03-18',
    read_minutes: 7,
    tags: ['thinking', 'ai', 'work'],
    visibility: 'public',
    cover: {
      kind: 'typo',
      headline: 'the typing',
      sub: 'is incidental.',
      hue: 'acid',
    },
    excerpt: 'Most of what I do is reading other people’s intentions and translating them into systems that won’t surprise anyone six months later. The translation is the job; the typing is incidental.',
    body: [
      { kind: 'p', text: 'The first time someone asked me "will AI replace engineers" I gave the polite answer. The polite answer is wrong, because the question is wrong.' },
      { kind: 'p', text: 'The question assumes engineering is what we currently call engineering. It isn’t. Most of the work I do — the part that produces the durable artifact — is translation. I read someone’s half-formed intention, hold it next to three contradictory stakeholder requirements, and translate it into a system that won’t surprise anyone six months later. The translation is the job. The typing is incidental.' },
      { kind: 'pull', text: 'The field will narrow toward people who can hold context across systems and widen toward anyone who can describe a system clearly.' },
      { kind: 'p', text: 'AI replaces the typing, brilliantly. Most of what I watch junior engineers do in 2026 is being done at four-times speed by someone with Claude and decent taste. That gap will close, then invert.' },
      { kind: 'p', text: 'AI does not — yet, and not for a while — replace the part of engineering that holds seven half-formed constraints in your head while three stakeholders contradict each other in three different vocabularies. That part isn’t a skill, it’s a posture. It requires you to know what the building is for, which means having sat in enough buildings to have an opinion.' },
      { kind: 'p', text: 'My five-year prediction: the field narrows toward people who can hold context across systems, and widens toward anyone who can describe a system clearly. The bottom half of the current pyramid evaporates. The top half gets weirder and more architectural, less tactical. The middle is mostly gone.' },
      { kind: 'p', text: 'Most of the panic I see is from people whose job was neither end. They aren’t wrong to panic.' },
    ],
    cross_refs: ['evaluation-is-the-product', 'why-second-brains-fail'],
  },

  {
    slug: 'lucerna-honestly',
    title: 'What Lucerna is, honestly',
    date: '2026.02.21',
    iso: '2026-02-21',
    read_minutes: 5,
    tags: ['lucerna', 'product'],
    visibility: 'public',
    cover: {
      kind: 'typo',
      headline: 'a substrate.',
      sub: 'not a chatbot.',
      hue: 'acid',
    },
    excerpt: 'We tell people we build retrieval systems for personal corpora. Closer to the truth: we’re trying to make it possible to think with your past self again.',
    body: [
      { kind: 'p', text: 'Public answer: we build retrieval infrastructure for personal corpora. True. Boring.' },
      { kind: 'p', text: 'Honest answer: we’re trying to make it possible to think with your past self again. The primitives finally landed in 2023 — good embeddings, fast vector search, capable open models — but the substrate is still missing, so everyone is building chatbots on top of nothing. We’re building the nothing. Well, the something underneath.' },
      { kind: 'p', text: 'If you’re here because you might invest, the deck’s on request. If you’re here because you might use it, the waitlist is on the homepage. If you’re hiring me — I’m not looking for full-time roles. I’ll save you the read.' },
    ],
    cross_refs: ['why-second-brains-fail'],
  },

  {
    slug: 'we-shipped-the-wrong-10x',
    title: 'We shipped the wrong 10x',
    date: '2026.01.30',
    iso: '2026-01-30',
    read_minutes: 4,
    tags: ['lucerna', 'product'],
    visibility: 'public',
    cover: {
      kind: 'typo',
      headline: '10× faster.',
      sub: 'no one cared.',
      hue: 'amber',
    },
    excerpt: 'I spent a year making our retrieval 10x faster. Nobody could feel the difference, because they didn’t have a reason to use the thing at all.',
    body: [
      { kind: 'p', text: 'A year ago I believed the right strategy for any technical product was "make the thing 10x better than what exists." So I spent the first year of Lucerna making our retrieval engine 10x faster and 10x more accurate. We did it. It didn’t matter.' },
      { kind: 'p', text: 'Nobody could feel the difference, because the existing user hadn’t had a reason to retrieve anything at all. The product was for a use case that didn’t exist yet. We’d built a faster horse for a journey nobody was taking.' },
      { kind: 'p', text: 'What I believe now: most product wins come from changing what the user is trying to do, not from improving how well they do the existing thing. Lucerna’s actual product is "talk to your past self," not "better search." Took me a year to figure that out and the technical work was almost a distraction from the real problem.' },
    ],
    cross_refs: ['lucerna-honestly'],
  },

  {
    slug: 'private-why-i-left',
    title: 'Why I left',
    date: '2025.11.04',
    iso: '2025-11-04',
    read_minutes: 8,
    tags: ['career', 'private'],
    visibility: 'private',
    cover: {
      kind: 'typo',
      headline: 'nine months',
      sub: 'of pretending.',
      hue: 'violet',
    },
    excerpt: 'The team I cared about had been functionally dissolved for nine months. I was performing engineering while doing politics.',
    locked_body: 'This essay is one of the entries sijie keeps private on the corpus. It’s included in scopes for trusted conversations (e.g. close investor / advisor codes). Ask for a code if you have reason to read it.',
    body: [
      { kind: 'p', text: 'The short version: the team I cared about had been functionally dissolved for nine months, and I was performing engineering while doing politics. Eventually that wasn’t survivable.' },
      { kind: 'p', text: 'The long version is below, and it’s the reason this essay is gated. I have no interest in litigating any of it in public; the people involved are largely good people who got caught in a bad org shape. But the inside story is useful if we’re considering working together — it’s the cleanest way I know to show you what I will and won’t do under pressure.' },
      { kind: 'pull', text: 'Performing engineering while doing politics is a kind of slow drowning.' },
      { kind: 'p', text: 'I joined the team thinking the work was the work. Two reorgs in, the work was about thirty percent of the job. The rest was managing perception across three lines of management, none of whom agreed on what we were building or why. I kept telling myself this was a temporary state. It wasn’t.' },
      { kind: 'p', text: 'The moment I knew I was leaving: a meeting where my manager asked me to soften the wording of a postmortem because a peer team had taken offense to the phrase "this could have been caught in code review." The system error in question had cost a real product two weeks of debugging. The softening worked. The error happened again four months later, in a different system, for the same reason. By then I was gone.' },
      { kind: 'p', text: 'I should have left six months earlier. I didn’t, because I was attached to the team I came in with, and because the work had real technical depth that I knew I’d miss. Both were true. Neither was a good enough reason.' },
      { kind: 'p', text: 'If you’re hiring me, what this tells you: I will leave a job that has stopped being the job. I won’t be loud about it, I won’t litigate it on the way out, and I won’t be talked out of it by retention conversations. The cost of staying past the point of usefulness is too high — to me, and to the next thing I’d be doing instead.' },
    ],
    cross_refs: [],
  },
];

// helpers
function postBySlug(slug) { return POSTS.find((p) => p.slug === slug); }
function visiblePosts(visibility) {
  // visibility filter: 'public' (default for visitors), 'unlocked' (visitor has a code w/ private scope), 'all' (owner)
  if (visibility === 'all')      return POSTS;
  if (visibility === 'unlocked') return POSTS;  // still show locked ones, but indicate they're locked
  return POSTS.filter((p) => p.visibility !== 'private');
}

window.POSTS = POSTS;
window.postBySlug = postBySlug;
window.visiblePosts = visiblePosts;
