// use-assemble —— 归一装配视图的 openapi 路：owner 把 { spec, binding } 贴进来 → 提交 → 后端装配出
// 一个 openapi 连接器（返回 id），随后用 ConnectorCard（派生表单 + scheme + connect）把它连起来。
// 协议路（CalDAV/SMTP 固定表单）走 use-protocol-connect，不在这。

import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const CreateSchema = z.object({ id: z.string() });
const SpecBindingSchema = z.object({
  spec: z.record(z.string(), z.unknown()),
  binding: z.record(z.string(), z.unknown()),
});

export interface SpecAssembleHook {
  error: string;
  setSpec: (text: string) => void;
  submit: () => void;
}

// parseSpecBinding —— 贴的文本应是 { spec, binding } 的 JSON（两者都是对象）；否则 null（友好报错）。
function parseSpecBinding(text: string): { spec: unknown; binding: unknown } | null {
  try {
    const r = SpecBindingSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function useSpecAssemble(onCreated: (id: string) => void): SpecAssembleHook {
  const specRef = useRef('');
  const [error, setError] = useState('');

  const submit = useCallback(() => {
    const parsed = parseSpecBinding(specRef.current);
    parsed === null
      ? setError('Paste a JSON object with { spec, binding }.')
      : void adminAPI.post(
        '/connectors', { kind: 'openapi', spec: parsed.spec, binding: parsed.binding }, CreateSchema,
      ).then((r) => onCreated(r.id)).catch(() => setError('The spec could not be assembled.'));
  }, [onCreated]);

  return { error, setSpec: (t) => { specRef.current = t; }, submit };
}
