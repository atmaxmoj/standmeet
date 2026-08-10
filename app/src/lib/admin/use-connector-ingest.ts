// use-connector-ingest —— #155 区 A spec 摄入的 client 逻辑（贴/URL 拉 → 后端校验 → candidate /
// 人类可读错误）。逻辑住这里（非 presentation），ConnectorSpecIngest.tsx 只渲染 + 连线。

import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// 客户端尺寸闸（跟后端 openapi.MaxSpecBytes 对齐）：超大 spec 不上传，本地直接拒。
const MAX_SPEC_BYTES = 2 * 1024 * 1024;

const AuthFieldSchema = z.object({
  key: z.string(),
  type: z.string(),
  scopes: z.array(z.string()).nullish().transform((v) => v ?? undefined), // F-D-1 class: scopes can be null
});

const AuthSchemeSchema = z.object({
  scheme: z.string(),
  type: z.string(),
  in: z.string().optional(),
  param_name: z.string().optional(),
  discovery_url: z.string().optional(),
  fields: z.array(AuthFieldSchema),
  needs_dance: z.boolean(),
});

const AuthFormsSchema = z.object({
  note: z.string().nullish(),
  forms: z.array(AuthSchemeSchema).nullish(),
});

export type AuthField = z.infer<typeof AuthFieldSchema>;
export type AuthScheme = z.infer<typeof AuthSchemeSchema>;
export type AuthForms = z.infer<typeof AuthFormsSchema>;

const VerdictSchema = z.object({
  ok: z.boolean(),
  title: z.string().optional(),
  error: z.string().optional(),
  auth: AuthFormsSchema.optional(),
});

export interface IngestCandidate { title: string }

export interface ConnectorIngestHook {
  error: string;
  candidate: IngestCandidate | null;
  auth: AuthForms | null;
  setText: (t: string) => void;
  setBaseUrl: (u: string) => void;
  submitSpec: () => void;
  fetchUrl: (url: string) => void;
  ingestFile: (file: File) => void;
  specText: () => string;
  baseUrl: () => string;
  // sourceUrl —— spec 是从 URL 抓来的时候,**正文只在后端那次抓取里存在过**;装配得把来源
  // 一并送去,由后端再抓一次(F-C-25)。贴/上传进来的 spec 这里是空串。
  sourceUrl: () => string;
}

function verdictToState(v: z.infer<typeof VerdictSchema>): IngestState {
  return v.ok && v.title !== undefined
    ? { error: '', candidate: { title: v.title }, auth: v.auth ?? null }
    : { error: v.error ?? 'The spec could not be validated.', candidate: null, auth: null };
}

interface IngestState {
  error: string;
  candidate: IngestCandidate | null;
  auth: AuthForms | null;
}

async function runValidate(
  body: { spec?: string; url?: string; base_url?: string },
): Promise<IngestState> {
  const tooBig = (body.spec?.length ?? 0) > MAX_SPEC_BYTES;
  const fallback: IngestState = {
    error: 'Spec is too large (over the size limit). Provide a smaller spec.',
    candidate: null,
    auth: null,
  };
  return tooBig
    ? fallback
    : adminAPI.post('/connectors/validate-spec', body, VerdictSchema)
        .then(verdictToState)
        .catch(() => ({
          error: 'Could not validate the spec. Please try again.', candidate: null, auth: null,
        }));
}

export function useConnectorIngest(): ConnectorIngestHook {
  const [state, setState] = useState<IngestState>({ error: '', candidate: null, auth: null });
  const textRef = useRef('');
  // baseUrlRef —— owner 手填的 base URL。**三条摄入路（贴 / 上传文件 / URL 拉）都带上它**：
  // 少带一条，owner 就会遇到「贴进去能过、上传同一份文件反而说缺 servers」这种只在某条路上
  // 存在的行为，而那看起来像文件解析坏了（F-C-22 那次我就是这么误判的）。
  const baseUrlRef = useRef('');
  const sourceUrlRef = useRef('');

  // 贴/上传进来的正文把「来源 URL」清掉:否则先抓过一次、再改贴一份别的 spec,装配会送去
  // 那个陈旧的 URL —— 屏幕上是新 spec 的候选,装出来的却是旧的那个。
  const setText = useCallback((t: string) => {
    textRef.current = t;
    sourceUrlRef.current = '';
  }, []);
  const setBaseUrl = useCallback((u: string) => { baseUrlRef.current = u; }, []);

  const submitSpec = useCallback(() => {
    const t = textRef.current;
    t.trim() !== '' && void runValidate({ spec: t, base_url: baseUrlRef.current }).then(setState);
  }, []);

  const fetchUrl = useCallback((url: string) => {
    // 记住来源:装配那一步没有正文,只能靠它(F-C-25)。textRef 清空,免得跟上一次贴的混在一起。
    sourceUrlRef.current = url;
    textRef.current = '';
    void runValidate({ url, base_url: baseUrlRef.current }).then(setState);
  }, []);

  const ingestFile = useCallback((file: File) => {
    // 文件内容同时进 textRef：装配那一步送的是 spec 原文，不是文件句柄 —— 不同步的话，
    // 「上传文件 → 候选出现 → 点装配」会送出一份空 spec，而 UI 上一切正常。
    void file.text().then((t) => {
      textRef.current = t;
      sourceUrlRef.current = '';
      return runValidate({ spec: t, base_url: baseUrlRef.current });
    }).then(setState);
  }, []);

  return {
    error: state.error,
    candidate: state.candidate,
    auth: state.auth,
    setText,
    setBaseUrl,
    submitSpec,
    fetchUrl,
    ingestFile,
    specText: () => textRef.current,
    baseUrl: () => baseUrlRef.current,
    sourceUrl: () => sourceUrlRef.current,
  };
}
