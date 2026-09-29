// embed.ts —— <standmeet-chat base-url="https://alice.dev" [code|embed kid key] [mode] [layout] [lang]>
// Web Component: one <script> tag and the owner's chat is on any site.
//
// It renders the one chat (docs/design/sdk-chat-inheritance.md): the SDK's <Agent>, the same
// transcript, composer and dock the owner's own site renders, so everything the app's chat can do
// the embed can do, with nothing to port. This file only opens the session and mounts it.
//
// Sealed both ways: the chat mounts in a shadow root carrying the SDK's stylesheet and the design
// tokens, so the host page's CSS can't get in and ours can't leak out.
//
// The session: with embed credentials (embed id + kid + private key) the element signs an EdDSA JWT
// on the spot and sends only that — **never the plaintext code** ([[embed-credential-never-carries-the-code]]).
// Else a `code` attribute, else the owner's public tier (mode="public").

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient, type IssueSessionInput, type PublicSessionResponse } from '@standmeet/sdk-core';
import {
  Agent, persistSession, peekStoredSession, setChatBaseURL, useVisitorSessionStore, type AgentLayout,
} from '@standmeet/sdk';
import sdkStyles from '@standmeet/sdk/styles.css';

const TAG = 'standmeet-chat';

// TOKENS —— the design tokens the chat's stylesheet reads. On the owner's own site the page defines
// them; on someone else's site nothing does, so the shadow host carries them. The fonts are named,
// never fetched: a drop-in script hitting a CDN adds a cross-origin request to someone else's page
// ([[right-bytes-wrong-glyphs]]); Newsreader if installed, else Georgia — still serif.
const TOKENS = `
  :host {
    --color-paper: #F3EFE6; --color-ink: #1B1814; --color-muted: #7A7167; --color-faint: #A89F92;
    --color-rule: #DCD3BF; --color-accent: #B5391C;
    --font-serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    display: block; background: var(--color-paper); color: var(--color-ink);
    border: 1px solid var(--color-rule); border-radius: 3px; max-width: 46em; padding: 18px 24px;
  }
  .reading { font-family: var(--font-serif); font-size: 18px; line-height: 1.55; font-weight: 380; }
`;

// The stylesheet's KaTeX @import names a package path; inside a shadow root it would resolve
// against the host page's URL and 404. Equations still lay out from KaTeX's own inline styles.
const CHAT_CSS = sdkStyles.replace(/@import[^;]+;/g, '');

class StandMeetChatElement extends HTMLElement {
  private root: Root | null = null;

  connectedCallback(): void {
    setChatBaseURL(this.getAttribute('base-url') ?? '');
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = TOKENS + CHAT_CSS;
    const mount = document.createElement('div');
    shadow.replaceChildren(style, mount);
    void this.openSession().then(() => { this.mountAgent(mount); });
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = null;
  }

  private mountAgent(mount: HTMLElement): void {
    this.root = createRoot(mount);
    this.root.render(createElement(Agent, {
      layout: toLayout(this.getAttribute('layout')),
      lang: this.getAttribute('lang') ?? undefined,
      placeholder: this.getAttribute('placeholder') ?? undefined,
      publicTier: this.getAttribute('mode') === 'public',
    }));
  }

  // openSession —— a coded visitor's session is issued here and stored where the chat reads it, so
  // the <Agent> below is that code's agent from its first render. A return visit with the same code
  // keeps its session (and so its member and its conversation).
  private async openSession(): Promise<void> {
    const code = this.getAttribute('code') ?? '';
    const embedded = this.hasAttribute('embed');
    if (!embedded && code === '') return; // public tier or the gate: <Agent> decides
    if (!embedded && peekStoredSession()?.code === code) return;
    try {
      const client = createClient({ baseURL: this.getAttribute('base-url') ?? '' });
      const sess = await client.issueSession(await this.sessionInput(code));
      persistSession(sess, false);
      storeDisplay(sess, code);
    } catch (e) {
      // No session → <Agent> shows the gate handoff; the reason goes to the console only.
      console.error('[standmeet-chat] could not open a session', e);
    }
  }

  private async sessionInput(code: string): Promise<IssueSessionInput> {
    const embed = this.getAttribute('embed');
    const kid = this.getAttribute('kid');
    const key = this.getAttribute('key');
    if (embed && kid && key) {
      return { mode: 'code', embed_token: await signEmbedJWT(kid, embed, window.location.origin, key) };
    }
    return { mode: 'code', code };
  }
}

// storeDisplay —— the session's display state (quota, label), which the chat's quota lock reads.
function storeDisplay(sess: PublicSessionResponse, code: string): void {
  useVisitorSessionStore.getState().setSession({
    code: code === '' ? null : code, visitor: null, byoai: false, byoaiProvider: '',
    label: sess.code_label ?? null,
    used: sess.quota.used_turns, max: sess.quota.max_turns,
    maxMembers: sess.quota.max_members, memberCount: sess.members.length,
    startedAt: Date.now(), email: '', ownerCanDeliver: sess.owner_can_deliver ?? false,
  });
}

function toLayout(s: string | null): AgentLayout {
  return s === 'rail' || s === 'dock' ? s : 'inline';
}

// b64url —— base64url without padding (JWT segment encoding). Input is ASCII JSON / raw bytes.
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// signEmbedJWT —— sign the per-embed EdDSA JWT in the browser with WebCrypto. The private key is a
// base64 PKCS8 DER (what the owner pasted into the snippet); we import it as Ed25519 and sign
// `header.payload`. Folds in the origin (read live) + a 2-min expiry + a one-time jti. The plaintext
// access code is never here — the server resolves this token to the code.
async function signEmbedJWT(
  kid: string, embedID: string, origin: string, privateKeyB64: string,
): Promise<string> {
  const enc = new TextEncoder();
  const pkcs8 = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })));
  const payload = b64url(enc.encode(JSON.stringify({
    iss: embedID, iat: now, exp: now + 120, jti: crypto.randomUUID(), origin,
  })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, StandMeetChatElement);
}

export { StandMeetChatElement };
