// PickerSearchField —— the search box above every picker (codes, roles). A picker offers the
// first page of its list; typing narrows on the server (docs/design/paging.md, *Pickers*), so a
// row on "page 7" is one search away instead of unreachable.

'use client';

export function PickerSearchField({ value, onChange, placeholder, testid }: {
  value: string; onChange: (q: string) => void; placeholder: string; testid: string;
}) {
  return (
    <input
      type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} aria-label={placeholder}
      data-testid={testid} className="sm-field-input w-full mb-2"
    />
  );
}
