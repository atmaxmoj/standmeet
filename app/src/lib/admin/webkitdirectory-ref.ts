import type { RefObject } from 'react';

export function webkitDirectoryRef(
  inputRef: RefObject<HTMLInputElement | null>,
): (el: HTMLInputElement | null) => void {
  return (el) => {
    if (inputRef && typeof inputRef === 'object') { inputRef.current = el; }
    if (el) el.setAttribute('webkitdirectory', '');
  };
}
