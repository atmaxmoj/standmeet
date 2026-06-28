// ConnectorSpecIngest —— #155 区 A：spec 摄入。owner 贴 / 上传 / URL 拉一份 OpenAPI spec →
// 后端校验（同一个 3.0 parser，归一）→ 显示 connector candidate（品类标题）或人类可读拒绝理由。
// spec-driven 装配的第一步：把任意作者搓的 spec 喂进来。

'use client';

import { useState } from 'react';

import { useConnectorIngest } from '@/lib/admin/use-connector-ingest';

export function ConnectorSpecIngest() {
  const hook = useConnectorIngest();
  return (
    <div className="mb-6 border-b border-(--color-rule)/60 pb-6">
      <SpecHeading />
      <SpecTextarea onText={hook.setText} />
      <div className="flex gap-2 mt-2 items-center">
        <SubmitButton onClick={hook.submitSpec} />
        <FileInput onFile={hook.ingestFile} />
      </div>
      <SpecUrlRow onFetch={hook.fetchUrl} />
      {hook.error !== '' && <SpecError message={hook.error} />}
      {hook.candidate !== null && <SpecCandidate title={hook.candidate.title} />}
    </div>
  );
}

function SpecHeading() {
  return (
    <div className="mb-2">
      <div className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        paste an OpenAPI spec
      </div>
      <p className="reading-tight text-[12.5px] text-(--color-muted) mt-1">
        Any OpenAPI 3.0 spec (JSON or YAML). We derive the credential form + category from it.
      </p>
    </div>
  );
}

function SpecTextarea({ onText }: { onText: (t: string) => void }) {
  return (
    <textarea
      data-testid="connector-spec-input"
      onChange={(e) => onText(e.target.value)}
      placeholder='{ "openapi": "3.0.0", "info": { … }, "servers": [ … ], "paths": { … } }'
      rows={6}
      className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
    />
  );
}

function SubmitButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      data-testid="connector-spec-submit"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      use this spec
    </button>
  );
}

function FileInput({ onFile }: { onFile: (f: File) => void }) {
  return (
    <input
      type="file"
      data-testid="connector-spec-file"
      accept=".json,.yaml,.yml,application/json,text/yaml"
      onChange={(e) => { const f = e.target.files?.[0]; f && onFile(f); }}
      className="mono text-[11px] text-(--color-muted)"
    />
  );
}

function SpecUrlRow({ onFetch }: { onFetch: (url: string) => void }) {
  const [url, setUrl] = useState('');
  return (
    <div className="flex gap-2 mt-3 items-end">
      <label className="block flex-1">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
          …or fetch from a URL
        </span>
        <input
          type="text"
          data-testid="connector-spec-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/openapi.json"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 mono text-[12px]"
        />
      </label>
      <button
        type="button" onClick={() => onFetch(url)}
        data-testid="connector-spec-fetch-button"
        className="sm-btn sm-btn-ghost sm-btn-sm"
      >
        fetch
      </button>
    </div>
  );
}

function SpecError({ message }: { message: string }) {
  return (
    <p
      data-testid="connector-spec-error"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {message}
    </p>
  );
}

function SpecCandidate({ title }: { title: string }) {
  return (
    <div
      data-testid="connector-candidate"
      className="mt-3 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5"
    >
      <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted)">
        connector candidate
      </div>
      <div className="text-[14px] mt-0.5">{title}</div>
    </div>
  );
}
