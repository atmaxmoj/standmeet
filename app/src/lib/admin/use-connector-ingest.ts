// use-connector-ingest —— #155 area A client logic for spec ingestion (paste/URL
// fetch → backend validation → candidate / human-readable error). The logic
// lives here (not presentation); ConnectorSpecIngest.tsx only renders + wires up.

import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// This file **no longer judges size itself**. It used to copy a
// `2 * 1024 * 1024` value "to match the backend" — and the backend's number
// is now an owner-adjustable knob (`CONNECTOR_SPEC_MAX_BYTES`). The moment
// the two diverge, the symptom is: the owner raises the limit to 12 MiB to
// fit GitHub's docs, the browser still rejects at its own 2 MiB, and the
// knob they just turned appears to do nothing (one fact, two homes).
// Only the server knows the limit, and only it should answer — its message already says it clearly ("spec is too large…").

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
  // sourceUrl —— when the spec was fetched from a URL, **the body only ever
  // existed during that one backend fetch**; assembly must send the source
  // along too, so the backend can fetch it again (F-C-25). For a pasted/uploaded spec this is an empty string.
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
  return adminAPI.post('/connectors/validate-spec', body, VerdictSchema)
    .then(verdictToState)
    .catch(() => ({
      error: 'Could not validate the spec. Please try again.', candidate: null, auth: null,
    }));
}

export function useConnectorIngest(): ConnectorIngestHook {
  const [state, setState] = useState<IngestState>({ error: '', candidate: null, auth: null });
  const textRef = useRef('');
  // baseUrlRef —— the base URL the owner typed in by hand. **All three
  // ingest paths (paste / file upload / URL fetch) must carry it**: miss one
  // and the owner hits behavior that exists on only one path — "pasting it
  // works, uploading the same file complains about a missing servers entry"
  // — which looks like broken file parsing (that's exactly how I misdiagnosed it during F-C-22).
  const baseUrlRef = useRef('');
  const sourceUrlRef = useRef('');

  // A pasted/uploaded body clears the "source URL": otherwise, fetch once,
  // then paste a different spec instead, and assembly would still send that
  // stale URL — the screen shows the new spec's candidate, but what gets assembled is the old one.
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
    // Remembers the source: the assembly step has no body, and can only rely
    // on this (F-C-25). textRef is cleared so it doesn't get mixed up with what was pasted last time.
    sourceUrlRef.current = url;
    textRef.current = '';
    void runValidate({ url, base_url: baseUrlRef.current }).then(setState);
  }, []);

  const ingestFile = useCallback((file: File) => {
    // The file content also goes into textRef: assembly sends the spec's raw
    // text, not a file handle — out of sync, and "upload file → candidate
    // appears → click assemble" would send an empty spec while the UI looks completely fine.
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
