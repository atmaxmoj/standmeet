// use-corpus-detail —— EditForm 展开时 lazy-fetch 单条 entry 的 hook。
// 拿到 body 后回填，避免 owner 再手抄一遍。
//
// **依赖那个函数，不是整个 actions 对象**（F-A-17）。use-corpus-actions 每次渲染都 return 一个新的
// 对象字面量（里面的函数各自 useCallback 过，对象本身没有），所以 `[id, actions]` 会在每次渲染后
// 重跑。而 fetchDetail 自己会 setPending → 重渲染 → 新对象 → 再跑：一个**无限的 render+fetch 环**。
// 后端日志里是同一条 GET 每 6ms 一发，没有尽头。
//
// 更糟的是它**看起来像在加载**：每轮 cleanup 都在 promise 落地前把 alive 置 false，于是 setDetail
// 一次都不执行，表单永远停在 loading…。owner 看到的是"慢"，不是"坏"，所以不会有人报告它。
//
// 失败同理：原来 `.then()` 后面一个 catch 都没有 —— 请求挂了也是一个永恒的 loading…（外加一条没人
// 接的 unhandled rejection）。现在失败经 report 反显给 owner。

'use client';

import { useEffect, useState } from 'react';

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

// RawHeroForm —— raw 行内编辑框里 hero 那三样的可编辑状态。
export interface RawHeroForm {
  cover: string;
  coverHeadline: string;
  coverHue: string;
  setCover: (v: string) => void;
  setCoverHeadline: (v: string) => void;
  setCoverHue: (v: string) => void;
}

// useRawHeroForm —— 拉一次详情(列表行不带 hero),回填成可编辑状态。
//
// 回填这一步放在 hook 里而不是组件里:渲染层不写控制流。而且**必须回填** ——
// 不回填的话表单把已有的值显示成空,owner 看到一个空的 "cover line" 会以为没设过。
export function useRawHeroForm(id: string, actions: CorpusActionsHook): RawHeroForm {
  const [cover, setCover] = useState('');
  const [coverHeadline, setCoverHeadline] = useState('');
  const [coverHue, setCoverHue] = useState('');
  const report = useReportError();
  const fetchDetail = actions.fetchRawDetail;
  useEffect(() => {
    let alive = true;
    void fetchDetail(id)
      .then((d) => { alive && d && seedHero(d, setCover, setCoverHeadline, setCoverHue); })
      .catch((e: unknown) => { alive && report(e); });
    return () => { alive = false; };
  }, [id, fetchDetail, report]);
  return { cover, coverHeadline, coverHue, setCover, setCoverHeadline, setCoverHue };
}

// heroInput —— 表单状态 → 更新入参。**空串不发** —— hero 在后端是指针字段,
// 不发 = 不动;发空串 = 明确清空。owner 这次没碰的那几项不该被抹掉。
export function heroInput(f: RawHeroForm): {
  cover_image_asset_id?: string; cover_headline?: string; cover_hue?: string;
} {
  const out: Record<string, string> = {};
  if (f.cover !== '') out['cover_image_asset_id'] = f.cover;
  if (f.coverHeadline !== '') out['cover_headline'] = f.coverHeadline;
  if (f.coverHue !== '') out['cover_hue'] = f.coverHue;
  return out;
}

function seedHero(
  d: RawDetail,
  setCover: (v: string) => void,
  setHeadline: (v: string) => void,
  setHue: (v: string) => void,
): void {
  setCover(d.cover_image_asset_id);
  setHeadline(d.cover_headline);
  setHue(d.cover_hue);
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
