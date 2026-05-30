// agent-skills-mock —— in-process registry + marketplace fixture.
//
// Mirrors docs/design/project/admin.js AgentSkillsSection (2583-2814):
//   - 10 built-in skills, 3 categories (visitor-reaching / answer-shaping /
//     owner-side), each with gate (auto | owner) + connector deps + 30d run count
//   - 6 marketplace items split between github (anthropics/skills) + skillsmp
//
// Pass-2 backend swap-in point: replace this module with the real
// /api/admin/agent-skills + /api/admin/marketplace fetches; the rest of
// the UI consumes a stable AgentSkillView / MarketSkillView interface.

export type SkillCategory = 'reach' | 'answer' | 'owner';
export type SkillGate = 'auto' | 'owner';
export type Marketplace = 'github' | 'skillsmp';

export interface AgentSkillView {
  id: string;
  name: string;
  cat: SkillCategory;
  on: boolean;
  gate: SkillGate;
  blurb: string;
  needs: readonly string[];
  runs_30d: number;
  /** marketplace metadata — only set on installed-from-marketplace skills. */
  mpId?: string;
  marketplace?: Marketplace;
  source_url?: string;
  installed_version?: string;
  latest_version?: string;
}

export interface MarketSkillView {
  id: string;
  name: string;
  author: string;
  stars: number;
  version: string;
  marketplace: Marketplace;
  category: SkillCategory;
  blurb: string;
  source_url: string;
  needs: readonly string[];
}

export const CATEGORY_LABEL: Record<SkillCategory, string> = {
  reach: 'visitor-reaching',
  answer: 'answer-shaping',
  owner: 'owner-side',
};

export const SKILL_KIND_LABEL: Record<SkillGate, string> = {
  auto: 'auto',
  owner: 'owner-gated',
};

export const BUILT_IN_SKILLS: readonly AgentSkillView[] = [
  { id: 'calendar.book', name: 'Book a meeting', cat: 'reach', on: true, gate: 'auto',
    blurb: 'Offer open calendar slots and write the booking. Per-code toggle in codes.',
    needs: ['Calendar'], runs_30d: 14 },
  { id: 'intro.broker', name: 'Broker an intro', cat: 'reach', on: true, gate: 'owner',
    blurb: 'When a visitor asks to be connected, file an intro request to your inbox. You approve before anything sends.',
    needs: ['Email'], runs_30d: 3 },
  { id: 'doc.release', name: 'Request a gated doc', cat: 'reach', on: true, gate: 'owner',
    blurb: 'Instead of hard-refusing private content, file a release request you can grant per-visitor.',
    needs: [], runs_30d: 6 },
  { id: 'topic.subscribe', name: 'Topic subscribe', cat: 'reach', on: true, gate: 'auto',
    blurb: 'Capture an email tied to a topic ("ping me when you write on retrieval").',
    needs: ['Email'], runs_30d: 11 },
  { id: 'bundle.send', name: 'Send a follow-up bundle', cat: 'reach', on: false, gate: 'auto',
    blurb: 'At end of a conversation, email the visitor the entries discussed + a transcript.',
    needs: ['Email'], runs_30d: 0 },
  { id: 'research.trace', name: 'Show research trace', cat: 'answer', on: true, gate: 'auto',
    blurb: 'Surface a visible retrieve → rank → synthesize trace when answering hard questions.',
    needs: [], runs_30d: 88 },
  { id: 'artifact.make', name: 'Make an artifact', cat: 'answer', on: false, gate: 'owner',
    blurb: 'Assemble a one-pager / PDF from corpus entries on request, into outputs as a draft.',
    needs: [], runs_30d: 0 },
  { id: 'memory.cross', name: 'Cross-surface memory', cat: 'answer', on: true, gate: 'auto',
    blurb: 'Remember what a visitor read on /wiki or /writings when they land in chat (session-scoped).',
    needs: [], runs_30d: 41 },
  { id: 'reply.draft', name: 'Draft replies in my voice', cat: 'owner', on: true, gate: 'owner',
    blurb: 'In your admin, draft replies to access requests / pings in your voice. You edit + send.',
    needs: ['Email'], runs_30d: 9 },
  { id: 'week.summary', name: 'Weekly conversation digest', cat: 'owner', on: true, gate: 'auto',
    blurb: 'Summarize the week’s visitor conversations and flag anyone worth a real reply.',
    needs: [], runs_30d: 4 },
];

// MARKET_FIXTURE deleted on backend-fetch landing — what the backend's
// job-board-mock serves now is the live source of truth (real GitHub
// snapshot + hand-rolled SkillsMP fixture, both under
// e2e/fixtures/marketplace/).

// installed-from-marketplace skills always start off (owner explicitly
// flips them on after install) and get default gate based on whether
// they need Email (the legacy rule: Email-needing skills require owner
// approval per send).
export function marketSkillToInstalled(m: MarketSkillView): AgentSkillView {
  return {
    id: m.name.toLowerCase().replace(/[^a-z]+/g, '.'),
    name: m.name,
    cat: m.category,
    on: false,
    gate: m.needs.includes('Email') ? 'owner' : 'auto',
    blurb: m.blurb,
    needs: m.needs,
    runs_30d: 0,
    mpId: m.id,
    marketplace: m.marketplace,
    source_url: m.source_url,
    installed_version: m.version,
    latest_version: m.version,
  };
}
