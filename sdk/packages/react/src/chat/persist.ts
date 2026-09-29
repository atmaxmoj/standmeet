// persist —— a page's own chat thread, kept in this browser (use-chat's persistKey). Two entries per
// key: the transcript the visitor sees, and the history the model is sent, so a reload shows the
// conversation AND the next turn still remembers it. Best-effort: blocked or full storage means
// no persistence, never a throw.

import type { Message } from '@standmeet/agent-core';

import type { Dialog } from './dialog-stream.js';

const DIALOGS = 'sm-chat-dialogs:';
const HISTORY = 'sm-chat-history:';
// MAX_KEEP —— cap what is stored so a long conversation can't balloon localStorage. The most
// recent turns are what a returning visitor and the model both need.
const MAX_KEEP = 40;

export function loadPersisted(key: string): { dialogs: Dialog[]; history: Message[] } {
  return { dialogs: read<Dialog>(DIALOGS + key), history: read<Message>(HISTORY + key) };
}

export function saveDialogs(key: string, dialogs: readonly Dialog[]): void {
  // A settled turn only; the throbber state is live, never stored.
  write(DIALOGS + key, dialogs.filter((d) => !d.pending).map((d) => ({ ...d, currentTool: null, retrying: false })));
}

export function saveHistory(key: string, history: readonly Message[]): void {
  // The kept tail starts at a visitor message: a cut through a tool call would leave its result
  // without the call, which a provider rejects.
  const tail = history.slice(-MAX_KEEP);
  const start = tail.findIndex((m) => m.role === 'user');
  write(HISTORY + key, start < 0 ? [] : tail.slice(start));
}

export function clearPersisted(key: string): void {
  try {
    localStorage.removeItem(DIALOGS + key);
    localStorage.removeItem(HISTORY + key);
  } catch { /* no storage */ }
}

function read<T>(k: string): T[] {
  try {
    const raw = localStorage.getItem(k);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    // ponytail: trusts its own writes' shape; a schema check if a foreign writer ever appears.
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write(k: string, items: readonly unknown[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(k);
      return;
    }
    localStorage.setItem(k, JSON.stringify(items.length > MAX_KEEP ? items.slice(-MAX_KEEP) : items));
  } catch { /* private mode / quota exceeded */ }
}
