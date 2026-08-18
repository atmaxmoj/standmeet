// ConnectorSpecIngest —— #155 区 A：spec 摄入。owner 贴 / 上传 / URL 拉一份 OpenAPI spec →
// 后端校验（同一个 3.0 parser，归一）→ 显示 connector candidate（品类标题）或人类可读拒绝理由。
// spec-driven 装配的第一步：把任意作者搓的 spec 喂进来。

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  useConnectorIngest, type AuthForms, type AuthScheme,
} from '@/lib/admin/use-connector-ingest';
import {
  isAssemblable, type AssembleInput, type AssembleState,
} from '@/lib/admin/use-connector-upload';
import { ConnectorCredForm } from '@/components/admin/ConnectorCredForm';
import { ConnectorCard } from '@/components/admin/sections/connectors/ConnectorCard';

// ConnectorSpecIngest —— **添加连接器只有这一个表单**（F-C-21）。以前品类卡下面还有第二个
// 形状不同的 `{spec, binding}` 文本框，走过去会把这里填的全清空；现在 AssembleView 渲染的就是
// 这个组件本身。「只留一个表单」指的是一份**实现**，不是一个位置 —— 同一个组件出现在两处不是
// 漂移，两份不同的实现才是。
//
// onAssemble —— 装配（建连接器 + 存凭据）。校验通过、出了候选之后才可点：
// 这个表单**收齐了组装需要的全部东西**（spec、可选 binding、base URL、认证方案、凭据），
// 以前却唯独没有出口。
// onCandidate —— 校验出候选（owner 已经选定「自带 spec」这条路）时通知外层。品类卡下面的
// 协议表单据此收起来：两套表单的字段 testid 同名空间，同屏并存迟早撞车（见 AssembleView）。
export function ConnectorSpecIngest({ onAssemble, onCandidate, assemble }: {
  onAssemble?: (input: AssembleInput) => void;
  onCandidate?: (has: boolean) => void;
  assemble?: AssembleState;
}) {
  const state = assemble ?? NO_ASSEMBLE;
  return state.id === null
    ? (
      <IngestForm
        onAssemble={onAssemble} onCandidate={onCandidate} assembleError={state.error}
      />
    )
    : <AssembledCard id={state.id} />;
}

// NO_ASSEMBLE —— 没传 assemble 时的空态（纯摄入/凭据表单那两条调用路用不到装配）。
// 常量而不是内联可选链：那一串 `?.` 每个都算一次分支，超 complexity 闸。
const NO_ASSEMBLE: AssembleState = { id: null, error: '' };

// AssembledCard —— 装配完成之后**表单让位给这张卡**。卡是凭据 + Connect 的唯一归属；
// 让摄入表单继续留在屏幕上的话，它派生的那个 connector-connect-button（`ConnectMaybe` 渲染的、
// 没有 onClick 的那个）会和卡上真正能用的那个同时存在 —— 一个死按钮压在一个活按钮旁边。
function AssembledCard({ id }: { id: string }) {
  return <ConnectorCard entry={{ id, category: '', kind: 'openapi' }} />;
}

function IngestForm({ onAssemble, onCandidate, assembleError }: {
  onAssemble?: (input: AssembleInput) => void;
  onCandidate?: (has: boolean) => void;
  assembleError: string;
}) {
  const hook = useConnectorIngest();
  const bindingRef = useRef('');
  const schemeRef = useRef('');
  const credsRef = useRef<Record<string, string>>({});
  // scopesRef —— oauth2 勾选的 scope。跟凭据一起存进新连接器；漏了它，授权跳转就少了范围，
  // 而界面上一切正常（复选框勾了、看着已生效）。
  const scopesRef = useRef<Set<string>>(new Set());
  const [expose, setExpose] = useState(false);
  const [useless, setUseless] = useState(false);
  const hasCandidate = hook.candidate !== null;
  useEffect(() => { onCandidate?.(hasCandidate); }, [hasCandidate, onCandidate]);
  // buildInput —— 把表单上收齐的东西装成一次装配的入参。
  // authScheme：没动过下拉 → 用派生表单里的第一个方案。留空的话后端在三个 manual 候选里挑不出
  // 唯一一个，连接器建得出来却派生不了凭据表单。
  const buildInput = (): AssembleInput => ({
    spec: hook.specText(), url: hook.sourceUrl(),
    binding: bindingRef.current, baseUrl: hook.baseUrl(),
    authScheme: schemeRef.current === '' ? defaultScheme(hook.auth) : schemeRef.current,
    exposeAsAgentTools: expose,
    credentials: credsRef.current,
    scopes: [...scopesRef.current],
  });
  // assemble —— 装出来的东西必须**有人能用**（规则在 isAssemblable，属于装配语义，不在这一层）。
  // 不能用就当场拒并说清缺哪一样，而不是建出一个谁都调不到的死物。
  const assemble = () => {
    const input = buildInput();
    setUseless(!isAssemblable(input));
    isAssemblable(input) && onAssemble?.(input);
  };
  return (
    <div className="mb-6 border-b border-(--color-rule)/60 pb-6">
      <SpecHeading />
      <SpecTextarea onText={hook.setText} onBlur={hook.submitSpec} />
      <BindingTextarea onText={(t) => { bindingRef.current = t; setUseless(false); }} />
      <BaseUrlRow onText={hook.setBaseUrl} />
      <div className="flex gap-2 mt-2 items-center">
        <SubmitButton onClick={hook.submitSpec} />
        <FileInput onFile={hook.ingestFile} />
      </div>
      <SpecUrlRow onFetch={hook.fetchUrl} />
      <SpecError message={hook.error} />
      <SpecCandidateMaybe candidate={hook.candidate} />
      <CredFormMaybe
        auth={hook.auth}
        onScheme={(s) => { schemeRef.current = s; }}
        values={credsRef.current}
        scopes={scopesRef.current}
      />
      <ExposeRow
        show={hasCandidate}
        checked={expose}
        onChange={(v) => { setExpose(v); setUseless(false); }}
      />
      <UselessWarning show={useless} />
      <AssembleFailure message={assembleError} />
      <AssembleRow show={hasCandidate && onAssemble !== undefined} onClick={assemble} />
    </div>
  );
}

// ExposeRow —— 「把这份 spec 的接口开给访客的 AI」。**默认关，必须 owner 自己勾**（设计源 §3：
// 这条路是 opt-in）。它把厂商文档里的每一个 operation 都变成访客 AI 能调的工具 —— Cal.com v2
// 是 211 条 —— 所以这是一次对外授权，不该从「binding 空不空」去推断 owner 的意思。
function ExposeRow({ show, checked, onChange }: {
  show: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <label className="mt-4 flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        data-testid="connector-expose-agent-tools"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="reading-tight text-[12.5px] text-(--color-muted)">{t('exposeLabel')}</span>
    </label>
  ) : null;
}

// AssembleFailure —— 装配真的失败了（后端拒了）的那句话，**落在模态里**。
// 页面级 toast 不够：模态盖着整页，owner 看不到它 —— 于是「点了装配、什么都没发生」（F-C-26）。
function AssembleFailure({ message }: { message: string }) {
  return message === '' ? null : (
    <p
      data-testid="connector-assemble-error"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {message}
    </p>
  );
}

// UselessWarning —— 无 binding 且未勾选时的拒绝。说的是**缺哪一样**，不是「操作失败」。
function UselessWarning({ show }: { show: boolean }) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <p
      data-testid="connector-assemble-useless"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {t('needsBindingOrExpose')}
    </p>
  ) : null;
}

// authForms —— 派生出的方案列表（没有则空）。拆出来只为把可选链的分支数摊开：
// `auth?.forms?.[0]?.scheme ?? ''` 一行里有四个分支，超 complexity 闸。
function authForms(auth: AuthForms | null): AuthScheme[] {
  return auth === null ? [] : (auth.forms ?? []);
}

// defaultScheme —— 派生表单里的第一个方案（owner 没主动选时的生效值，跟 SchemePicker 的
// 默认选中保持一致）。没有派生出任何方案 → 空串（spec 自己声明了唯一方案的那种）。
function defaultScheme(auth: AuthForms | null): string {
  return authForms(auth)[0]?.scheme ?? '';
}

// AssembleRow —— 装配动作。**只在有候选时出现**：spec 还没校验通过就给一个能点的按钮，
// 等于把「点了没反应」当成产品行为。
function AssembleRow({ show, onClick }: { show: boolean; onClick: () => void }) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <div className="mt-4">
      <button
        type="button" onClick={onClick}
        data-testid="connector-assemble-button"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('assemble')}
      </button>
    </div>
  ) : null;
}

// BaseUrlRow —— spec 没写 `servers` 时 owner 手填的 base URL（F-C-22）。**常驻**，不是等到
// 报错才出现：一个只在失败之后才现身的输入框，owner 第一次读到那句拒绝时仍然无处可填。
function BaseUrlRow({ onText }: { onText: (t: string) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <label className="block mt-2">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('baseUrlLabel')}
      </span>
      <input
        type="text"
        data-testid="connector-spec-base-url"
        onChange={(e) => onText(e.target.value)}
        placeholder="https://api.example.com/v2"
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

// BindingTextarea —— 这一格以前**只有占位符没有标签**（UX-81）：同一扇弹窗里，上面那格有
// `PASTE AN OPENAPI SPEC` + 一句解释、下面那格有 `BASE URL —— ONLY IF…`，唯独它没有。
// 而占位符里那句 "maps operations to a category contract" 是这一格**唯一的解释**，
// owner 一打字它就消失了 —— placeholder-as-label。
// 现在标签常驻、解释常驻，占位符退回去只举一个例子。
function BindingTextarea({ onText }: { onText: (t: string) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <label className="block mt-2">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('bindingLabel')}
      </span>
      <textarea
        data-testid="connector-binding-input"
        onChange={(e) => onText(e.target.value)}
        placeholder={'book:\n  operation: createBooking'}
        rows={4}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
      />
      <span className="reading-tight text-[11.5px] text-(--color-muted) block mt-1">
        {t('bindingHint')}
      </span>
    </label>
  );
}

function SpecCandidateMaybe({ candidate }: { candidate: { title: string } | null }) {
  return candidate === null ? null : <SpecCandidate title={candidate.title} />;
}

function CredFormMaybe({ auth, onScheme, values, scopes }: {
  auth: AuthForms | null;
  onScheme: (s: string) => void;
  values: Record<string, string>;
  scopes: Set<string>;
}) {
  return auth === null
    ? null
    : <ConnectorCredForm auth={auth} onScheme={onScheme} values={values} scopes={scopes} />;
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

// FileInput —— 上传一份 spec 文件。
//
// 以前这里是**浏览器原生**的 `Choose File / No file chosen`（UX-81）—— 整扇弹窗里唯一
// 没被设计过的控件，就贴在被设计过的 `USE THIS SPEC` 旁边。原生控件的长相由操作系统决定，
// 跟这个产品的任何一处都对不上。
//
// 藏起那个 input、让包着它的 `<label>` 当按钮：**点击行为一模一样**（label 天然把点击转发给
// 内部的 input），改的只是长相。testid 留在真正的 input 上，驱动方式不变。
function FileInput({ onFile }: { onFile: (f: File) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <label className="sm-btn sm-btn-ghost sm-btn-sm cursor-pointer">
      {t('uploadSpec')}
      <input
        type="file"
        data-testid="connector-spec-file"
        accept=".json,.yaml,.yml,application/json,text/yaml"
        onChange={(e) => { const f = e.target.files?.[0]; f && onFile(f); }}
        className="sr-only"
      />
    </label>
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
          className="sm-field-input sm-mono"
        />
      </label>
      {/* FETCH 跟 USE THIS SPEC 是**并列的两条路**（把 spec 交进来），以前一个是深色实心按钮、
          一个是最右边的浅色文字链 —— 权重差了一个量级（UX-81）。两条都是「提交这一格里的东西」，
          所以给同一种描边按钮：主次留给它们下面那个真正的主动作（ASSEMBLE）。 */}
      <button
        type="button" onClick={() => onFetch(url)}
        data-testid="connector-spec-fetch-button"
        className="sm-btn sm-btn-outline sm-btn-sm"
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
