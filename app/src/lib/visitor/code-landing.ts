// code-landing —— 一张码扫出来看到的是什么。
//
// 默认是访客对话；owner 给这张码挂了一个自定义页，看到的就是那一页
// （**pages 给了 code 一个渲染**）。授权一点没变：同一个角色、同一套配额、同一份记账 ——
// 变的只有读者眼前的那张纸。
//
// 领码有两条路（/gate 上提交、带 `?code=` 进站后的名字选择器）。两条都要落到同一个地方，
// 所以「去哪」只由这一个函数说了算 —— 各写一遍的话，改一条另一条会静默留在旧行为上
// （[[copied-invalidation-goes-stale]]）。

// codeLandingHref —— 空 slug 返回空串，表示「这张码没有自己的落地，按各自的默认走」。
// 不在这里编一个默认值：两条路的默认不一样（一条要把 ?q= 串回去，另一条已经在首页上了）。
export function codeLandingHref(slug: string): string {
  return slug === '' ? '' : `/p/${slug}`;
}
