// use-connector-ingest —— #155 区 A spec 摄入的 client 逻辑（贴/URL 拉 → 后端校验 → candidate /
// 人类可读错误）。逻辑住这里（非 presentation），ConnectorSpecIngest.tsx 只渲染 + 连线。

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// 客户端尺寸闸（跟后端 openapi.MaxSpecBytes 对齐）：超大 spec 不上传，本地直接拒。
const MAX_SPEC_BYTES = 2 * 1024 * 1024;

const VerdictSchema = z.object({
  ok: z.boolean(),
  title: z.string().optional(),
  error: z.string().optional(),
});

export interface IngestCandidate { title: string }

export interface ConnectorIngestHook {
  error: string;
  candidate: IngestCandidate | null;
  setText: (t: string) => void;
  submitSpec: () => void;
  fetchUrl: (url: string) => void;
  ingestFile: (file: File) => void;
}

function verdictToState(v: z.infer<typeof VerdictSchema>): IngestState {
  return v.ok && v.title !== undefined
    ? { error: '', candidate: { title: v.title } }
    : { error: v.error ?? 'The spec could not be validated.', candidate: null };
}

interface IngestState {
  error: string;
  candidate: IngestCandidate | null;
}

async function runValidate(body: { spec?: string; url?: string }): Promise<IngestState> {
  const tooBig = (body.spec?.length ?? 0) > MAX_SPEC_BYTES;
  const fallback: IngestState = {
    error: 'Spec is too large (over the size limit). Provide a smaller spec.',
    candidate: null,
  };
  return tooBig
    ? fallback
    : adminAPI.post('/connectors/validate-spec', body, VerdictSchema)
        .then(verdictToState)
        .catch(() => ({ error: 'Could not validate the spec. Please try again.', candidate: null }));
}

export function useConnectorIngest(): ConnectorIngestHook {
  const [state, setState] = useState<IngestState>({ error: '', candidate: null });
  const [text, setTextState] = useState('');

  const submitSpec = useCallback(() => {
    text.trim() !== '' && void runValidate({ spec: text }).then(setState);
  }, [text]);

  const fetchUrl = useCallback((url: string) => {
    void runValidate({ url }).then(setState);
  }, []);

  const ingestFile = useCallback((file: File) => {
    void file.text().then((t) => runValidate({ spec: t })).then(setState);
  }, []);

  return {
    error: state.error,
    candidate: state.candidate,
    setText: setTextState,
    submitSpec,
    fetchUrl,
    ingestFile,
  };
}
