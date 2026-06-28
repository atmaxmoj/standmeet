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
  scopes: z.array(z.string()).optional(),
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
  submitSpec: () => void;
  fetchUrl: (url: string) => void;
  ingestFile: (file: File) => void;
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

async function runValidate(body: { spec?: string; url?: string }): Promise<IngestState> {
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

  const setText = useCallback((t: string) => { textRef.current = t; }, []);

  const submitSpec = useCallback(() => {
    const t = textRef.current;
    t.trim() !== '' && void runValidate({ spec: t }).then(setState);
  }, []);

  const fetchUrl = useCallback((url: string) => {
    void runValidate({ url }).then(setState);
  }, []);

  const ingestFile = useCallback((file: File) => {
    void file.text().then((t) => runValidate({ spec: t })).then(setState);
  }, []);

  return {
    error: state.error,
    candidate: state.candidate,
    auth: state.auth,
    setText,
    submitSpec,
    fetchUrl,
    ingestFile,
  };
}
