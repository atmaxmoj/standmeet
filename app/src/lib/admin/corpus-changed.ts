// corpus-changed —— 语料一变,必须跟着作废的东西**都在这里**。
//
// 为什么要有这个文件:作废动作以前是**手抄**的。`useCorpusActions.run()` 里有一行
// `bumpCorpusEpoch()`,而 quick-dump 走的是另一条路(`use-raw.ts` 的 doAddRaw),它旁边跟着
// 一句诚实的注释 ——「dump bypasses useCorpusActions — bump so the lazy tree refetches」——
// 然后抄了同一行。于是后来往 run() 里加计数作废的时候,dump 那条路一个字都没跟上:
// owner 粘一条进来,列表多一行,而标题、四个 tab、侧栏 badge、pulse 栏全都还报旧数(F-L-16)。
//
// 抄一次的代价不是当时那一行,是**以后每一次新增都会漏掉第二个调用方**,而且不报错。
// 所以这里只留一个函数:两条路都调它,下次再多一样要作废的东西,加在这一处。

import { bumpCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { refreshCorpusGrowth } from '@/lib/admin/use-corpus-growth';

export function onCorpusChanged(): void {
  // 懒加载的树:已经取过的那几层作废,展开时重取。
  bumpCorpusEpoch();
  // 计数:/admin/raw 的标题数、四个 tab、侧栏 badge、pulse 栏读的都是这一份。
  void refreshCorpusGrowth();
}
