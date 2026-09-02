// use-corpus-detail —— the hook that lazy-fetches a single entry when
// EditForm expands. Once the body arrives, it's backfilled into the form so
// the owner doesn't have to retype it.
//
// **Depend on that one function, not the whole actions object** (F-A-17).
// use-corpus-actions returns a new object literal on every render (the
// functions inside it are each individually useCallback'd, but the object
// itself is not), so `[id, actions]` would rerun after every render. And
// fetchDetail itself calls setPending → rerender → new object → rerun: an
// **infinite render+fetch loop**. In the backend logs it was the same GET
// firing every 6ms, with no end.
//
// Worse, it **looked like it was still loading**: every round's cleanup set
// alive to false before the promise landed, so setDetail never ran even
// once, and the form stayed stuck on loading… forever. What the owner saw
// looked like "slow", not "broken", so nobody reported it.
//
// Failure had the same shape: `.then()` used to have no catch after it at
// all — a failed request was also an eternal loading… (plus an unhandled
// rejection nobody caught). Failure now gets reflected to the owner through report.

'use client';

import { useEffect, useState } from 'react';

import { heroField } from '@/lib/admin/hero-field';
import type {
  CorpusActionsHook, OutputDetail, RawDetail, SubjectivityDetail, WikiDetail,
} from '@/lib/admin/use-corpus-actions';
import { useReportError } from '@/lib/ui/use-report-error';

export function useWikiDetail(id: string, actions: CorpusActionsHook): WikiDetail | null {
  const [detail, setDetail] = useState<WikiDetail | null>(null);
  const report = useReportError();
  const fetchDetail = actions.fetchWikiDetail; // stable (useCallback []); the object around it is not
  useEffect(() => {
    let alive = true;
    void fetchDetail(id)
      .then((d) => { alive && setDetail(d); })
      .catch((e: unknown) => { alive && report(e); });
    return () => { alive = false; };
  }, [id, fetchDetail, report]);
  return detail;
}

// RawHeroForm —— the editable state of the three hero fields in raw's inline edit box.
//
// `loaded` is the value **as loaded**, compared against on submit: all three
// fields are pointer fields, and "he never set this" and "he just cleared
// it" are both an empty string — only comparing against the loaded value
// tells them apart (see the comment on the [[hero-field]] function).
export interface RawHeroForm {
  cover: string;
  coverHeadline: string;
  coverHue: string;
  loaded: { cover: string; coverHeadline: string; coverHue: string };
  setCover: (v: string) => void;
  setCoverHeadline: (v: string) => void;
  setCoverHue: (v: string) => void;
}

// useRawHeroForm —— fetches the detail once (the list row doesn't carry
// hero), backfilling it into editable state.
//
// The backfill step lives in the hook, not the component: the render layer
// doesn't write control flow. And it **must** backfill — without it the form
// would display existing values as empty, and the owner seeing a blank
// "cover line" would think it had never been set.
export function useRawHeroForm(id: string, actions: CorpusActionsHook): RawHeroForm {
  const [cover, setCover] = useState('');
  const [coverHeadline, setCoverHeadline] = useState('');
  const [coverHue, setCoverHue] = useState('');
  const [loaded, setLoaded] = useState(EMPTY_HERO);
  const report = useReportError();
  const fetchDetail = actions.fetchRawDetail;
  useEffect(() => {
    let alive = true;
    void fetchDetail(id)
      .then((d) => {
        alive && d && seedHero(d, setCover, setCoverHeadline, setCoverHue, setLoaded);
      })
      .catch((e: unknown) => { alive && report(e); });
    return () => { alive = false; };
  }, [id, fetchDetail, report]);
  return {
    cover, coverHeadline, coverHue, loaded,
    setCover, setCoverHeadline, setCoverHue,
  };
}

const EMPTY_HERO = { cover: '', coverHeadline: '', coverHue: '' };

// heroInput —— form state → the update input. What gets sent is decided by
// heroField: compared against the value **as loaded**, not against empty —
// otherwise the owner could never clear a cover/line/tone they'd already set (F-L-38(a)).
export function heroInput(f: RawHeroForm): {
  cover_image_asset_id?: string; cover_headline?: string; cover_hue?: string;
} {
  return {
    cover_image_asset_id: heroField(f.cover, f.loaded.cover),
    cover_headline: heroField(f.coverHeadline, f.loaded.coverHeadline),
    cover_hue: heroField(f.coverHue, f.loaded.coverHue),
  };
}

function seedHero(
  d: RawDetail,
  setCover: (v: string) => void,
  setHeadline: (v: string) => void,
  setHue: (v: string) => void,
  setLoaded: (v: { cover: string; coverHeadline: string; coverHue: string }) => void,
): void {
  setCover(d.cover_image_asset_id);
  setHeadline(d.cover_headline);
  setHue(d.cover_hue);
  setLoaded({
    cover: d.cover_image_asset_id,
    coverHeadline: d.cover_headline,
    coverHue: d.cover_hue,
  });
}

export function useSubjectivityDetail(
  id: string, actions: CorpusActionsHook,
): SubjectivityDetail | null {
  const [detail, setDetail] = useState<SubjectivityDetail | null>(null);
  const report = useReportError();
  const fetchDetail = actions.fetchSubjectivityDetail;
  useEffect(() => {
    let alive = true;
    void fetchDetail(id)
      .then((d) => { alive && setDetail(d); })
      .catch((e: unknown) => { alive && report(e); });
    return () => { alive = false; };
  }, [id, fetchDetail, report]);
  return detail;
}

export function useOutputDetail(id: string, actions: CorpusActionsHook): OutputDetail | null {
  const [detail, setDetail] = useState<OutputDetail | null>(null);
  const report = useReportError();
  const fetchDetail = actions.fetchOutputDetail;
  useEffect(() => {
    let alive = true;
    void fetchDetail(id)
      .then((d) => { alive && setDetail(d); })
      .catch((e: unknown) => { alive && report(e); });
    return () => { alive = false; };
  }, [id, fetchDetail, report]);
  return detail;
}
