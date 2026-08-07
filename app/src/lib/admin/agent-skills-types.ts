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
  // repoStars —— 技能所在**仓库**的星数;null = 这个源报不出来(GitHub 那一源就是),
  // 这时候一个数都不许印 —— `★ 0` 读起来是"零颗星",不是"不知道"(F-F-2)。
  repoStars: number | null;
  version: string;
  marketplace: Marketplace;
  category: SkillCategory;
  blurb: string;
  source_url: string;
  needs: readonly string[];
}
