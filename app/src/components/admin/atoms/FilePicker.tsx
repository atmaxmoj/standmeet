// FilePicker —— the one and only way to "pick a file".
//
// The browser's native `<input type="file">` draws its own `Choose File / No file
// chosen`: the look is decided by the OS and matches nothing in this product. UX-81
// was caught in the connector modal — the one undesigned control in the whole window,
// sitting right next to a designed button. After fixing that spot, the same thing was
// still standing in two other places (the wiki entry's FILES row, a writing's cover
// image) — one lesson only fixed the place it was found in.
//
// So this isn't a third manual fix; it collapses the pattern into one: hide the input,
// let the `<label>` wrapping it act as the button. **Click behavior is identical** — a
// label natively forwards clicks to the input inside it, no onClick and no ref needed.
//
// Warning: hiding the native control also hides the filename it would otherwise print.
// So every call site must supply its own receipt: a spec resolves into a candidate card
// as soon as it's picked, an asset goes straight into the list, a cover image shows a
// preview immediately. All three do — nowhere without a receipt may use this atom.
//
// The testid lands on the real input (unlike Btn, which doesn't expose one): tests
// drive file selection via setInputFiles, which needs that actual input element.

import type { RefObject } from 'react';

import { resolveBtnClass } from '@/lib/admin/btn-styles';

import type { BtnKind, BtnSize } from '@/components/admin/atoms/Btn';

type Props = {
  label: string;
  testid: string;
  onPick: (files: FileList | null) => void;
  accept?: string;
  disabled?: boolean;
  kind?: BtnKind;
  size?: BtnSize;
  inputRef?: RefObject<HTMLInputElement | null>;
};

// pickerClass —— defaults to ghost/sm: this is a secondary action (a real primary
// button usually stands next to it). Pulled out on its own because the two `??`
// plus the ternary below trip the complexity gate.
function pickerClass(kind: BtnKind | undefined, size: BtnSize | undefined): string {
  return resolveBtnClass(kind ?? 'ghost', size ?? 'sm');
}

export function FilePicker(props: Props) {
  const dim = props.disabled ? 'opacity-50' : '';
  return (
    <label className={`${pickerClass(props.kind, props.size)} cursor-pointer ${dim}`}>
      {props.label}
      <input
        ref={props.inputRef}
        type="file"
        accept={props.accept}
        disabled={props.disabled}
        data-testid={props.testid}
        onChange={(e) => props.onPick(e.target.files)}
        className="sr-only"
      />
    </label>
  );
}
