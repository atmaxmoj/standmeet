// use-corpus-form —— the state machine for CorpusEntryForm. useState /
// useEffect / field computation are pulled out of the .tsx into lib to keep
// the presentation layer at cyclo ≤ 3 + the no-if rule.
//
// After the retrieval-redesign the visibility field was removed; access
// relies on access_codes.corpus_permissions (path-glob ACL). show_as_source
// is set independently via the admin SEO/path edit path, not in the main form.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { heroField } from '@/lib/admin/hero-field';
import type {
  CorpusEntryInput, PromoteInput,
} from '@/lib/admin/use-corpus-actions';

export interface CorpusFormHook {
  title: string;
  body: string;
  tagsRaw: string;
  parentID: string;
  citable: boolean;
  // The hero trio — image + the line laid over it + tone. **All three must
  // be writable on the panel**: doing only the image would mean the owner,
  // after setting a cover, sees the title get pushed up to serve as the
  // headline, with no way to change it (short of going to an AI client and
  // calling MCP). The visitor side renders all three.
  //
  // Saved together with the body, **never PATCHed separately**: corpus.update
  // does a full replace on every field except hero, so sending just a cover
  // would clear the title and body to empty.
  coverAssetID: string;
  coverHeadline: string;
  coverHue: string;
  setTitle: (v: string) => void;
  setBody: (v: string) => void;
  setTagsRaw: (v: string) => void;
  setParentID: (v: string) => void;
  setCitable: (b: boolean) => void;
  setCoverAssetID: (v: string) => void;
  setCoverHeadline: (v: string) => void;
  setCoverHue: (v: string) => void;
  // Derived: whether submit is currently disallowed (false = allowed)
  submitDisabledReason: (busy: boolean, bodyVisible: boolean) => boolean;
  toEntryInput: (bodyVisible: boolean) => CorpusEntryInput;
  toPromoteInput: () => PromoteInput;
}

export function useCorpusForm(initial?: Partial<CorpusEntryInput>): CorpusFormHook {
  const seed = seedFromInitial(initial);
  const [title, setTitle] = useState(seed.title);
  const [body, setBody] = useState(seed.body);
  const [tagsRaw, setTagsRaw] = useState(seed.tagsRaw);
  const [parentID, setParentID] = useState(seed.parentID);
  const [citable, setCitable] = useState(seed.citable);
  const [coverAssetID, setCoverAssetID] = useState(seed.coverAssetID);
  const [coverHeadline, setCoverHeadline] = useState(seed.coverHeadline);
  const [coverHue, setCoverHue] = useState(seed.coverHue);
  const key = JSON.stringify(initial ?? {});
  useEffect(() => {
    const next = seedFromInitial(initial);
    setTitle(next.title);
    setBody(next.body);
    setTagsRaw(next.tagsRaw);
    setParentID(next.parentID);
    setCitable(next.citable);
    setCoverAssetID(next.coverAssetID);
    setCoverHeadline(next.coverHeadline);
    setCoverHue(next.coverHue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    title, body, tagsRaw, parentID, citable, coverAssetID, coverHeadline, coverHue,
    setTitle, setBody, setTagsRaw, setParentID, setCitable, setCoverAssetID,
    setCoverHeadline, setCoverHue,
    submitDisabledReason: useCallback(
      (busy: boolean, bodyVisible: boolean) =>
        submitDisabled(busy, bodyVisible, title, body),
      [title, body],
    ),
    toEntryInput: useCallback(
      (bodyVisible: boolean) => ({
        title: title.trim(),
        body: bodyVisible ? body : '',
        tags: parseTags(tagsRaw),
        // parent_id —— the backend is now also a **pointer field** (F-L-28):
        // not sending = leave unchanged, sending empty = move to root.
        // The edit form doesn't display this field, so it's never sent, and
        // the note's position stays put — which is exactly what's wanted.
        // **This line must change when a parent control is added to the edit
        // form**: at that point "none (root)" must send an empty string,
        // instead of being folded into undefined as it is here, or that option would do nothing when clicked.
        parent_id: parentID === '' ? undefined : parentID,
        // citable —— MUST be sent: the Go request struct decodes a missing `show_as_source` as
        // FALSE, so omitting it silently turned citation OFF on every edit (the note stayed
        // readable but stopped being attributable). Carry it explicitly.
        show_as_source: citable,
        // What gets sent for the three hero fields is judged in one place by
        // heroField (compared against the value **as loaded**, not against
        // empty) — that's what lets "he never set this" and "he's clearing it" be told apart.
        cover_image_asset_id: heroField(coverAssetID, seed.coverAssetID),
        cover_headline: heroField(coverHeadline, seed.coverHeadline),
        cover_hue: heroField(coverHue, seed.coverHue),
      }),
      [
        title, body, tagsRaw, parentID, citable, coverAssetID, coverHeadline, coverHue,
        seed.coverAssetID, seed.coverHeadline, seed.coverHue,
      ],
    ),
    toPromoteInput: useCallback(
      () => ({ title: title.trim(), tags: parseTags(tagsRaw) }),
      [title, tagsRaw],
    ),
  };
}

interface Seed {
  title: string;
  body: string;
  tagsRaw: string;
  parentID: string;
  citable: boolean;
  coverAssetID: string;
  coverHeadline: string;
  coverHue: string;
}

function seedFromInitial(initial?: Partial<CorpusEntryInput>): Seed {
  return {
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    tagsRaw: (initial?.tags ?? []).join(', '),
    parentID: initial?.parent_id ?? '',
    // Defaults to true = matches the DB's `show_as_source NOT NULL DEFAULT true`: a new entry is citable by default.
    citable: initial?.show_as_source ?? true,
    coverAssetID: initial?.cover_image_asset_id ?? '',
    coverHeadline: initial?.cover_headline ?? '',
    coverHue: initial?.cover_hue ?? '',
  };
}

function submitDisabled(
  busy: boolean, bodyVisible: boolean, title: string, body: string,
): boolean {
  const titleBlank = title.trim() === '';
  const bodyBlank = bodyVisible && body.trim() === '';
  return busy || titleBlank || bodyBlank;
}

// splitTail —— splits the body into "the body" and "the trailing whitespace run".
//
// Both functions below use it, for the same reason (F-L-51): **that
// trailing newline is the owner's own byte, not ours**. Nothing is allowed
// to casually strip it — strip it and it never grows back, so "insert →
// remove" would never return to the original text.
function splitTail(body: string): { head: string; tail: string } {
  const tail = /\s*$/u.exec(body)?.[0] ?? '';
  return { head: body.slice(0, body.length - tail.length), tail };
}

// appendBlock —— appends a block to the end of the body, leaving one blank
// line between. **Appended, never overwritten** — the owner clicking
// "insert" means adding an image, not making the body they already wrote disappear.
//
// The trailing whitespace run **stays exactly where it was, at the very
// end**: inserting means adding an image, not casually reformatting the
// note. Measured the cost in prod: a real 3240-byte note became 3311 after
// one insert, 3239 after removing it — that missing byte was stripped right here (F-L-51).
export function appendBlock(body: string, block: string): string {
  if (body.trim() === '') return block;
  const { head, tail } = splitTail(body);
  return `${head}\n\n${block}${tail}`;
}

// dropAssetRef —— removes the **entire image reference** to an asset from
// the body, along with any surrounding blank lines it added.
//
// The other half of appendBlock (F-L-50): if the asset is removed but the
// reference stays in place, the visitor page shows a broken image plus an
// internal filename, invisible to the owner on the panel. The whole image
// node is deleted, not just the address — deleting only the address would
// leave `![original filename]()`, exposing the filename to visitors.
//
// **Strictly the inverse of appendBlock** (F-L-51): appendBlock inserts
// `\n\n` + the image, so this tries removing exactly that shape first;
// failing that, it falls back to something looser (an image followed by a
// blank line, or a bare image — a position the owner typed by hand).
// Trailing whitespace is likewise preserved exactly. So "insert → remove" returns byte-for-byte to the original, instead of losing a byte every round trip.
export function dropAssetRef(body: string, assetID: string): string {
  const ref = `!\\[[^\\]]*\\]\\(\\s*standmeet-asset:${assetID}\\s*\\)`;
  const { head, tail } = splitTail(body);
  const stripped = head
    .replace(new RegExp(`\\n\\n${ref}`, 'gu'), '')
    .replace(new RegExp(`${ref}\\n\\n`, 'gu'), '')
    .replace(new RegExp(ref, 'gu'), '')
    .replace(/\n{3,}/gu, '\n\n');
  return `${stripped}${tail}`;
}

function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
}

// runWith —— a "finish up only on success" helper wrapping an action
// `Promise<boolean>` + toast + onDone. Every submit path in a section goes
// through it, avoiding a `ok && (toast, onDone)` no-unused-expressions / multi-statement-ternary in the presentation layer.
export async function runWith(
  action: () => Promise<boolean>,
  onSuccess: () => void,
): Promise<void> {
  const ok = await action();
  if (ok) onSuccess();
}

// savedLine —— the receipt for one save. **Whatever happened as a side
// effect must also be stated**: unpublishing a pinned entry removes it from
// the homepage sections, and the owner did this from the "edit a note"
// screen — without going to that other page, they'd never know (F-L-31).
// When there's no side effect, it's just the original sentence.
export function savedLine(unpinnedSections: readonly string[]): string {
  if (unpinnedSections.length === 0) {
    return 'saved';
  }
  return `saved — unpublishing also removed it from ${unpinnedSections.join(' and ')}`;
}
