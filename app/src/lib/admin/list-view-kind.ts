// list-view-kind —— admin sections (DraftsSection / ApplicationsSection 等)
// 共用的 list 视图 4 态 dispatch。
//
// presentation 层不准跑 `if` / 复杂三元链；这里抽出来给 component 用单一
// switch on string。

export type ListViewKind = 'loading' | 'error' | 'empty' | 'list';

export function listViewKind(
  loading: boolean, error: string | null, count: number,
): ListViewKind {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}
