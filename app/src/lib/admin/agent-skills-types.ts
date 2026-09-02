// agent-skills-types —— marketplace-tab view types (#48-5: the Pass-1 mock
// registry + fake install are gone; installed skills + install are now real,
// see use-agent-skills / use-skills). What remains is the search-result shape
// the marketplace tab renders.

export type SkillCategory = 'reach' | 'answer' | 'owner';
export type Marketplace = 'github' | 'skillsmp';

// MarketSkillView —— one marketplace search result (adapted from the backend
// MarketSkill in use-marketplace-search).
export interface MarketSkillView {
  id: string;
  name: string;
  author: string;
  // repoStars —— star count of the **repository** the skill lives in; null =
  // this source can't report it (the GitHub source is one such case),
  // in which case no number may be printed — `★ 0` reads as "zero stars",
  // not "unknown" (F-F-2).
  repoStars: number | null;
  version: string;
  marketplace: Marketplace;
  category: SkillCategory;
  blurb: string;
  source_url: string;
  // needs —— connector names this skill uses that the owner hasn't connected
  // yet. **null is itself a value**: the server couldn't answer (it hasn't
  // read this skill's SKILL.md). [] means "answered, nothing missing". Neither
  // case shows a prompt on the card, but don't merge them into one type —
  // merging them makes "unknown" and "nothing wrong" indistinguishable (F-F-4).
  needs: readonly string[] | null;
}
