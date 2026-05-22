// embed.ts —— <standmeet-chat base-url="..." tier="public" code="...">
// Web Component。drop-in 单 <script> 给任意站点用。
//
// 内部不依赖 React；直接调 sdk-core 的 createClient + streamMessage，
// 手写 DOM 渲染一个最简 transcript（问题 mono small-heading，回答 serif
// body，跟设计稿一致）。
//
// v1 单 owner instance —— base-url 直接指向 owner 自己的 standmeet 部署，
// 不再有 handle attribute。
//
// 用法：
//   <script src="https://alice.dev/embed/embed.iife.js"></script>
//   <standmeet-chat base-url="https://alice.dev"></standmeet-chat>

import { createClient } from '@standmeet/sdk-core';
import type { StandMeetClient, SessionTier, SSEEvent } from '@standmeet/sdk-core';

const TAG = 'standmeet-chat';

class StandMeetChatElement extends HTMLElement {
  private client: StandMeetClient | null = null;
  private session: { id: string; token: string } | null = null;
  private transcript: HTMLDivElement;
  private input: HTMLTextAreaElement;

  constructor() {
    super();
    this.transcript = document.createElement('div');
    this.input = document.createElement('textarea');
  }

  connectedCallback(): void {
    const baseURL = this.getAttribute('base-url') ?? '';
    this.client = createClient({ baseURL });
    this.renderShell();
    this.input.addEventListener('keydown', this.onKeyDown);
  }

  disconnectedCallback(): void {
    this.input.removeEventListener('keydown', this.onKeyDown);
  }

  private renderShell(): void {
    this.transcript.setAttribute('data-role', 'transcript');
    this.input.setAttribute('placeholder', 'ask…');
    this.input.setAttribute('rows', '2');
    this.append(this.transcript, this.input);
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    void this.send(text);
  };

  private async send(text: string): Promise<void> {
    this.appendBlock('visitor', text);
    const assistant = this.appendBlock('assistant', '');
    try {
      await this.ensureSession();
      const sess = this.session;
      if (!sess) throw new Error('no session');
      if (!this.client) throw new Error('no client');
      for await (const ev of this.client.streamMessage(sess.id, sess.token, text)) {
        applyEventToBlock(assistant, ev);
      }
    } catch (e) {
      assistant.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.session || !this.client) return;
    const tier = (this.getAttribute('tier') ?? 'public') as SessionTier;
    const code = this.getAttribute('code') ?? undefined;
    const s = await this.client.issueSession({ tier, code });
    this.session = { id: s.conversation_id, token: s.session_token };
  }

  private appendBlock(role: 'visitor' | 'assistant', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.setAttribute('data-role', role);
    div.textContent = text;
    this.transcript.appendChild(div);
    return div;
  }
}

function applyEventToBlock(block: HTMLDivElement, ev: SSEEvent): void {
  if (ev.kind === 'token') {
    block.textContent = (block.textContent ?? '') + ev.text;
  } else if (ev.kind === 'error') {
    block.textContent = `error: ${ev.message}`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, StandMeetChatElement);
}

export { StandMeetChatElement };
