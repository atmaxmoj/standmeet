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
  stars: number;
  version: string;
  marketplace: Marketplace;
  category: SkillCategory;
  blurb: string;
  source_url: string;
  needs: readonly string[];
}
