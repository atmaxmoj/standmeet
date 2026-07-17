// ConnectorSpecIngest —— #155 区 A：spec 摄入。owner 贴 / 上传 / URL 拉一份 OpenAPI spec →
// 后端校验（同一个 3.0 parser，归一）→ 显示 connector candidate（品类标题）或人类可读拒绝理由。
// spec-driven 装配的第一步：把任意作者搓的 spec 喂进来。

'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConnectorIngest, type AuthForms } from '@/lib/admin/use-connector-ingest';
import { ConnectorCredForm } from '@/components/admin/ConnectorCredForm';

// onUpload —— 给了它（upload-mgmt 路）：填了 binding 后点 submit = 上传装配（建连接器），而非
// 只校验。没给（纯 spec-ingest / cred-form 路）：submit 只校验出 candidate + 派生表单。
export function ConnectorSpecIngest({ onUpload }: { onUpload?: (spec: string, binding: string) => void }) {
  const hook = useConnectorIngest();
  const specRef = useRef('');
  const bindingRef = useRef('');
  const submit = () => {
    (bindingRef.current.trim() !== '' && onUpload !== undefined)
      ? onUpload(specRef.current, bindingRef.current)
      : hook.submitSpec();
  };
  return (
    <div className="mb-6 border-b border-(--color-rule)/60 pb-6">
      <SpecHeading />
      <SpecTextarea
        onText={(t) => { specRef.current = t; hook.setText(t); }}
        onBlur={hook.submitSpec}
      />
      <BindingTextarea onText={(t) => { bindingRef.current = t; }} />
      <div className="flex gap-2 mt-2 items-center">
        <SubmitButton onClick={submit} />
        <FileInput onFile={hook.ingestFile} />
      </div>
      <SpecUrlRow onFetch={hook.fetchUrl} />
      <SpecError message={hook.error} />
      <SpecCandidateMaybe candidate={hook.candidate} />
      <CredFormMaybe auth={hook.auth} />
    </div>
  );
}

function BindingTextarea({ onText }: { onText: (t: string) => void }) {
  return (
    <textarea
      data-testid="connector-binding-input"
      onChange={(e) => onText(e.target.value)}
      placeholder="optional JSONata binding (YAML) — maps operations to a category contract"
      rows={4}
      className="w-full mt-2 bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
    />
  );
}

function SpecCandidateMaybe({ candidate }: { candidate: { title: string } | null }) {
  return candidate === null ? null : <SpecCandidate title={candidate.title} />;
}

function CredFormMaybe({ auth }: { auth: AuthForms | null }) {
  return auth === null ? null : <ConnectorCredForm auth={auth} />;
}

function SpecHeading() {
  const t = useTranslations('adminShell.specIngest');
  return (
    <div className="mb-2">
      <div className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('heading')}
      </div>
      <p className="reading-tight text-[12.5px] text-(--color-muted) mt-1">
        {t('blurb')}
      </p>
    </div>
  );
}

function SpecTextarea({ onText, onBlur }: { onText: (t: string) => void; onBlur: () => void }) {
  return (
    <textarea
      data-testid="connector-spec-input"
      onChange={(e) => onText(e.target.value)}
      onBlur={onBlur}
      placeholder='{ "openapi": "3.0.0", "info": { … }, "servers": [ … ], "paths": { … } }'
      rows={6}
      className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
    />
  );
}

function SubmitButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <button
      type="button" onClick={onClick}
      data-testid="connector-spec-submit"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('useThisSpec')}
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
  const t = useTranslations('adminShell.specIngest');
  const [url, setUrl] = useState('');
  return (
    <div className="flex gap-2 mt-3 items-end">
      <label className="block flex-1">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
          {t('orFetchFromUrl')}
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
        {t('fetch')}
      </button>
    </div>
  );
}

function SpecError({ message }: { message: string }) {
  return message === '' ? null : (
    <p
      data-testid="connector-spec-error"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {message}
    </p>
  );
}

function SpecCandidate({ title }: { title: string }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <div
      data-testid="connector-candidate"
      className="mt-3 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5"
    >
      <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('candidate')}
      </div>
      <div className="text-[14px] mt-0.5">{title}</div>
    </div>
  );
}
