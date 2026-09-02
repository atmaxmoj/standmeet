// list-view-kind —— the 4-state list-view dispatch shared by admin sections
// (DraftsSection / ApplicationsSection etc.).
//
// The presentation layer must not run `if` / complex ternary chains; this is
// pulled out so the component can use a single switch on string.

export type ListViewKind = 'loading' | 'error' | 'empty' | 'list';

export function listViewKind(
  loading: boolean, error: string | null, count: number,
): ListViewKind {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}
