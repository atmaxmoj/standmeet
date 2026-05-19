// RawDumpBox —— "quick dump" 入口。design 的设想是 owner 可以在 admin 直接
// 粘贴一条想法。但 backend 暂未暴露 POST /api/admin/raw（MCP-only）—— UI
// 给出来，但 submit 触发 tooltip 提示走 MCP。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '../../atoms/Btn';

export function RawDumpBox() {
  const [text, setText] = useState('');
  const onAdd = useCallback(() => {
    // backend 没暴露 admin raw_dump 入口 —— 永远走 MCP。
    typeof window !== 'undefined' && window.alert(
      'Direct dumps from the admin UI are coming. For now, push from your AI client (MCP tool: raw_dump).',
    );
  }, []);
  return (
    <div className="border border-dashed border-(--color-rule) bg-(--color-surface)/40 rounded-sm p-4 relative">
      <RawDumpHead />
      <RawDumpTextarea value={text} onChange={setText} />
      <RawDumpFooter disabled={text.trim() === ''} onAdd={onAdd} />
    </div>
  );
}

function RawDumpHead() {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) flex items-baseline gap-2">
        <span>quick dump</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-faint)">paste a thought · then promote</span>
      </div>
      <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-faint)">
        mcp only · for now
      </span>
    </div>
  );
}

function RawDumpTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Paste a thought, a passage from a chat, a half-formed take. Push from MCP for now — admin write endpoint coming."
      rows={3}
      className="w-full bg-transparent text-(--color-ink) placeholder:text-(--color-faint) reading-tight text-[15.5px]"
    />
  );
}

function RawDumpFooter({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between mt-3">
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        mcp endpoint stays unindexed until promoted
      </span>
      <Btn kind="primary" onClick={onAdd} disabled={disabled}>dump ↵</Btn>
    </div>
  );
}
