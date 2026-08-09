// danger-action —— 破坏性行内动作（delete / discard）的**唯一**一份样式。
//
// UX-32:raw 每行三个动作 promote / edit / delete 的 hover 全部收敛到同一个 `--color-accent`
// (实测都是 `rgb(181, 57, 28)`),于是「提升进 wiki」「编辑」和「永久删除」在鼠标停下那一刻
// 反馈完全相同 —— 而 hover 是点击前最后一次分辨机会。静止态更糟:delete 用的是三者里最淡的
// `--color-faint`,所以最不可逆的动作平时最不显眼、悬停时又认不出来。
//
// 两个设计判断写在这里,别再各自散着写:
//   • 静止态用 `--color-muted` 而不是 `--color-faint` —— 破坏性动作应该**朴素**,不该**藏起来**。
//     藏起来 + 悬停时又和安全动作一样,是最坏的组合:你注意到它的那一刻已经悬在上面了。
//   • 悬停态不借品牌强调色。朱砂在这个产品里是**身份**(LIVE 点、AI 标签、侧栏计数),让它同时
//     表示"危险",色彩就什么都没说。改用满强度的 ink + 下划线:重量 + 下划线读作"这是一次承诺",
//     而且不用往这套紧凑的调色板里塞新色相。
//
// 新增任何 delete/discard 都从这里取,免得下一个又长成安全的样子。
export const DANGER_ACTION_CLASS =
  'mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) '
  + 'hover:text-(--color-ink) hover:underline underline-offset-2 disabled:opacity-40';
