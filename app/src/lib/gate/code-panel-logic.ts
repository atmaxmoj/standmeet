// code-panel-logic —— gate CodePanel 的 business logic + state derivation。
// 从 component 文件里抽出来（presentation 层不准跑 `if` / async / control flow）。
//
// 行为 mirror docs/design/project/gate.js CodeInput：归一化大写 + 去非
// [A-Z0-9-] + 32 字符上限；paste 自动 submit；错码 → shake + 清空 + refocus。

import type { GateHook } from '@/lib/gate/use-gate';

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
}

// codeReady —— 输入足够长（去 dash 后 ≥ 3）才让 enter 按钮可点。
export function codeReady(code: string): boolean {
  return code.replace(/-/g, '').length >= 3;
}

// codeShapedForAutoSubmit —— paste 进来的东西看起来像 code（去 dash 后
// ≥ 4 字符），值得自动跑一次 submit；不够长就停在 input 里等用户敲。
export function codeShapedForAutoSubmit(code: string): boolean {
  return code.replace(/-/g, '').length >= 4;
}

// handlePasteEvent —— 接 onPaste 事件 → 抽 text → normalize → 喂给 apply。
// 空剪切板直接 return；不调 preventDefault（让 React 自己处理）。
export function handlePasteEvent(
  e: React.ClipboardEvent<HTMLInputElement>,
  apply: (normalized: string) => void,
): void {
  const t = e.clipboardData.getData('text');
  if (t === '') return;
  e.preventDefault();
  apply(normalizeCode(t));
}

interface SubmitDeps {
  router: { push: (path: string) => void };
  hook: GateHook;
}

// submitCodeAndGo —— 调 hook.submitCode + 成功跳 `/`(带回首页问题 ?q=)。
// CodePanel form onSubmit + paste 自动提交 共用。
export async function submitCodeAndGo(
  code: string,
  name: string,
  deps: SubmitDeps,
): Promise<void> {
  const ok = await deps.hook.submitCode(code, name);
  if (ok) deps.router.push(postGateHref());
}

// postGateHref —— 过闸后回 `/`;若访客是从首页带着问题(/gate?q=)来的,把 ?q= 串回去,
// 让 ChatRoom mount 时接着答(不丢问题)。
export function postGateHref(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  const q = new URL(window.location.href).searchParams.get('q');
  return q === null || q === '' ? '/' : `/?q=${encodeURIComponent(q)}`;
}

// scheduleAutoSubmit —— paste 的延迟自动提交（50ms 让 React state 跑完）。
export function scheduleAutoSubmit(
  normalized: string,
  name: string,
  deps: SubmitDeps,
): void {
  if (!codeShapedForAutoSubmit(normalized)) return;
  setTimeout(() => void submitCodeAndGo(normalized, name, deps), 50);
}
