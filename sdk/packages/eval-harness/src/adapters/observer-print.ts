// observer-print.ts —— EventObserver adapter: 彩色 stdout transcript +
// 可选 JSONL 行流。
//
// 彩色 stdout 给 owner 扫一眼判 (iter / tool call / final text)。JSONL
// 给另一个 agent 后处理 (grep / jq / 二次 evaluate)。两条同时写不互斥。

import { openSync, writeSync } from 'node:fs';

import type {
  AgentEvent,
  EventObserver,
} from '@standmeet/agent-core';

export interface PrintObserverOptions {
  readonly stdout?: boolean;
  readonly jsonlPath?: string;
  readonly color?: boolean;
  // 自定义 startTime (一个 scenario 起跑时 record 一下)，没传就用第一次
  // 事件时间。runner 每个 scenario 起跑前 reset。
  readonly startTimeMs?: number;
}

export function printObserver(opts: PrintObserverOptions = {}): EventObserver {
  const stdoutEnabled = opts.stdout ?? true;
  const color = opts.color ?? true;
  const start = opts.startTimeMs ?? Date.now();
  const jsonlFd = opts.jsonlPath ? openJSONLAppend(opts.jsonlPath) : null;
  return {
    onEvent(event: AgentEvent): void {
      const t = Date.now() - start;
      if (stdoutEnabled) writeStdout(t, event, color);
      if (jsonlFd !== null) writeJSONL(jsonlFd, t, event);
    },
  };
}

function openJSONLAppend(path: string): number {
  return openSync(path, 'a');
}

function writeJSONL(fd: number, tMs: number, event: AgentEvent): void {
  const line = JSON.stringify({ t: tMs, ...event }) + '\n';
  writeSync(fd, line);
}

function writeStdout(tMs: number, event: AgentEvent, color: boolean): void {
  const ts = padTimestamp(tMs);
  const line = formatLine(event, color);
  process.stdout.write(`${dim(ts, color)} ${line}\n`);
}

function padTimestamp(ms: number): string {
  return `[t=${String(ms).padStart(6, ' ')}ms]`;
}

// formatLine —— 单条 event 的人读输出。switch 拆开是为每种事件保留独立
// 着色/格式 (e.g. tool_request 红/橙，final_text 绿)。
function formatLine(event: AgentEvent, color: boolean): string {
  switch (event.type) {
    case 'iteration_started':
      return cyan(`iter ${event.iter} →`, color);
    case 'iteration_completed':
      return dim(`iter ${event.iter} ✓`, color);
    case 'llm_chunk':
      return dim('text: ', color) + truncate(event.text, 120);
    case 'llm_tool_request':
      return yellow('toolcall', color) + ' ' + event.call.name + ' ' + dim(formatArgs(event.call.args), color);
    case 'tool_started':
      return dim(`dispatch ${event.name} ...`, color);
    case 'tool_completed':
      return green('tool ok', color, !event.result.ok) + ' ' + event.result.name + ' ' + dim(formatResult(event.result.result, event.result.reason), color);
    case 'capability_state_changed':
      return magenta('caps', color) + ' ' + event.states.map((s) => `${s.id}=${s.enabled ? '1' : '0'}`).join(' ');
    case 'suggestions_received':
      return magenta('suggestions', color) + ' ' + event.items.map((s) => `"${s}"`).join(', ');
    case 'final_text':
      return green('FINAL: ', color) + truncate(event.text, 4000);
    case 'error':
      return red('ERROR: ' + event.message, color);
  }
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 200);
  } catch {
    return '[unserializable args]';
  }
}

function formatResult(result: unknown, reason: string | undefined): string {
  if (reason !== undefined) return reason;
  try {
    const s = JSON.stringify(result);
    return s.slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ANSI 着色 helpers。color=false 时返原串，让 piping 给 less / log
// aggregator 时不带 escape。
function dim(s: string, color: boolean): string { return color ? `\x1b[2m${s}\x1b[0m` : s; }
function red(s: string, color: boolean): string { return color ? `\x1b[31m${s}\x1b[0m` : s; }
function green(s: string, color: boolean, asRed = false): string {
  if (!color) return s;
  return asRed ? `\x1b[31m${s}\x1b[0m` : `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string, color: boolean): string { return color ? `\x1b[33m${s}\x1b[0m` : s; }
function cyan(s: string, color: boolean): string { return color ? `\x1b[36m${s}\x1b[0m` : s; }
function magenta(s: string, color: boolean): string { return color ? `\x1b[35m${s}\x1b[0m` : s; }
