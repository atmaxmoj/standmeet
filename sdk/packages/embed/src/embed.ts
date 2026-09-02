// embed.ts —— <standmeet-chat base-url="..." tier="public" code="...">
// Web Component. Drop-in single <script> for any site to use.
//
// No React dependency internally; calls sdk-core's createClient + streamMessage directly,
// hand-rolls the DOM rendering of the transcript: **question = mono small heading, answer =
// serif body**, two distinct voices, matching the design spec.
//
// ⚠️ This sentence used to be **false**: the comment said this, while the whole file had not
// a single line of styling — a bare div with a `data-role` attribute shipped to someone
// else's site, font and color left entirely to the host page's mercy, question and answer
// same size and color, you couldn't even see where one turn ended
// (three 2026-08-13 design-review 🎨🔴 items, all pointing here). **A comment describes
// intent, not outcome.**
// Now the styles live in a shadow root: the host page's CSS can't get in, ours can't leak
// out — this surface is a deliverable, it must carry its own product identity rather than
// take on the shape of whatever site it lands on.
//
// v1 is single-owner-instance — base-url points straight at the owner's own standmeet
// deployment, there's no handle attribute anymore.
//
// Usage:
//   <script src="https://alice.dev/embed/embed.iife.js"></script>
//   <standmeet-chat base-url="https://alice.dev"></standmeet-chat>

import { createClient, parseAnswerText } from '@standmeet/sdk-core';
import type {
  StandMeetClient, SessionMode, SSEEvent, AnswerSpan, IssueSessionInput,
} from '@standmeet/sdk-core';

const TAG = 'standmeet-chat';

// SHELL_CSS —— this surface's product identity. Three things, matching the three
// 2026-08-13 design-review items:
//
//  1. **Identity**: cream paper + ink + vermillion + serif/mono dual typeface. **No external
//     font fetch** — a drop-in script hitting a CDN for fonts adds a cross-origin request on
//     someone else's page, and silently swaps faces when the fetch fails
//     ([[right-bytes-wrong-glyphs]]). So instead we ship a font stack: use Newsreader if the
//     host has it installed, fall back to Georgia — both still serif, the voice doesn't change.
//  2. **Hierarchy**: the question is a mono small heading (small, wide letter-spacing, muted),
//     the answer is serif body text (large, ink-colored, loose line-height).
//     Before, both were the same size and color, and the browser's default blue focus ring
//     on the input was the most eye-catching thing on the page — the hierarchy was backwards.
//  3. **Boundary**: a hairline rule + whitespace between each turn, so you can count turns
//     at a glance.
const SHELL_CSS = `
  :host {
    --sm-paper: #F3EFE6; --sm-ink: #1B1814; --sm-muted: #7A7167;
    --sm-rule: #DCD3BF; --sm-accent: #B5391C;
    --sm-serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    --sm-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    display: block; background: var(--sm-paper); color: var(--sm-ink);
    border: 1px solid var(--sm-rule); border-radius: 3px;
    max-width: 46em; padding: 0;
  }
  [data-role="transcript"] { padding: 22px 24px 6px; }
  /* One turn = question + answer. A hairline rule between turns makes the boundary visible. */
  [data-role="visitor"] {
    font-family: var(--sm-mono); font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--sm-muted);
    margin: 0 0 10px; padding-top: 18px; border-top: 1px solid var(--sm-rule);
  }
  [data-role="transcript"] > [data-role="visitor"]:first-child {
    padding-top: 0; border-top: none;
  }
  [data-role="assistant"] {
    font-family: var(--sm-serif); font-size: 16.5px; line-height: 1.62;
    color: var(--sm-ink); margin: 0 0 22px; white-space: pre-wrap;
  }
  /* An answer with no text yet = still thinking. Pure CSS, adds no new event or capability
     (progress indication belongs to the Result column). */
  [data-role="assistant"]:empty::after {
    content: '…'; color: var(--sm-muted); font-family: var(--sm-mono);
  }
  /* Paragraphs and inline markup (F-O-6): bold and inline code in the answer now render as
     typography instead of printing the raw asterisks/backticks. Note: this comment lives
     inside the SHELL_CSS template literal — it can't contain a backtick character, that
     would truncate the whole string. */
  [data-role="assistant"] .para { margin: 0 0 0.85em; }
  [data-role="assistant"] .para:last-child { margin-bottom: 0; }
  [data-role="assistant"] strong { font-weight: 600; }
  [data-role="assistant"] em { font-style: italic; }
  [data-role="assistant"] code {
    font-family: var(--sm-mono); font-size: 0.88em;
    background: color-mix(in oklab, var(--sm-ink) 7%, transparent);
    padding: 0.1em 0.3em; border-radius: 2px;
  }
  /* The answer block itself is no longer pre-wrap: paragraph breaks are now handled by
     .para (pre-wrap would double-count the blank line between paragraphs). */
  [data-role="assistant"] { white-space: normal; }
  textarea {
    display: block; width: 100%; box-sizing: border-box;
    font-family: var(--sm-mono); font-size: 13px; line-height: 1.5;
    color: var(--sm-ink); background: transparent;
    border: none; border-top: 1px solid var(--sm-rule);
    padding: 14px 24px 16px; resize: none; outline: none;
  }
  textarea::placeholder { color: var(--sm-muted); }
  /* Focus uses a vermillion bar on the left instead of the browser's default blue ring —
     the ring competed with the answer for attention. */
  textarea:focus { box-shadow: inset 2px 0 0 var(--sm-accent); }
`;

class StandMeetChatElement extends HTMLElement {
  private client: StandMeetClient | null = null;
  private session: { id: string; token: string; system: string } | null = null;
  private transcript: HTMLDivElement;
  private input: HTMLTextAreaElement;
  // pending / queue —— whether a turn is in flight right now, plus the questions waiting
  // behind it. The backend only runs one turn per session at a time
  // (a race gets rejected with 429, F-O-5), so this is serialized here; but **it does not
  // gray out the input** — queuing is the product's job, not a discipline imposed on the
  // visitor (F-A-42).
  private pending = false;
  private readonly queue: string[] = [];

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
    // shadow root: the host page's CSS can't get in, ours can't leak out. Something shipped
    // to someone else's site has to be sealed on both sides.
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHELL_CSS;
    root.append(style, this.transcript, this.input);
  }

  // onKeyDown —— **always accept** this question (F-O-5 → F-A-42).
  //
  // The backend only runs one turn per session at a time (`ErrSessionBusy` → 429), so
  // sending again while the previous turn is still streaming gets rejected, and the visitor
  // reads "didn't go through, try again" — both halves of that sentence are false.
  //
  // My previous fix was to **gray out the input**. That was wrong, and wrong in a classic
  // way: global rule #10 says "when an action can't be done right now (busy / not ready /
  // conflicting), **accept the request and queue it, don't gray it out**. Graying out means
  // making a person stand and watch the screen." The product's own visitor page made this
  // same mistake, caught by F-A-42 — an input that looked perfectly ready ate every
  // keystroke the visitor typed into it. Both surfaces now follow the same rule: accept,
  // show it, queue it.
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.enqueue(text);
  };

  // enqueue —— the question posts to the transcript immediately (the visitor sees their own
  // message stay put), then gets queued.
  private enqueue(text: string): void {
    this.appendBlock('visitor', text);
    this.queue.push(text);
    void this.drain();
  }

  // drain —— runs one turn at a time (backend requirement), but anything queued behind it
  // gets picked up and run automatically, no need for the visitor to resend.
  private async drain(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      for (let text = this.queue.shift(); text !== undefined; text = this.queue.shift()) {
        await this.runTurn(text);
      }
    } finally {
      this.pending = false;
    }
  }

  private async runTurn(text: string): Promise<void> {
    const assistant = this.appendBlock('assistant', '');
    try {
      await this.ensureSession();
      const sess = this.session;
      if (!sess) throw new Error('no session');
      if (!this.client) throw new Error('no client');
      for await (const ev of this.client.streamMessage(
        sess.id, sess.token, text, sess.system,
      )) {
        applyEventToBlock(assistant, ev);
      }
    } catch (e) {
      // Prefer language the visitor can understand; technical detail goes to console
      // (project rule: no raw error strings in the UI).
      // **Speak by category**: one blanket sentence for every failure tells someone to
      // retry even when the message actually went through (F-O-5).
      assistant.textContent = turnFailureText(e);
      console.error('[standmeet-chat] turn failed', e);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.session || !this.client) return;
    const s = await this.client.issueSession(await this.sessionInput());
    // system prompt is assembled once per session: the fragment + this session's persona.
    // Without it the model gets an empty system prompt and answers like a generic chatbot,
    // unrelated to this owner (F-O-2).
    this.session = {
      id: s.conversation_id, token: s.session_token,
      system: await this.client.composeSystem(s),
    };
  }

  // sessionInput —— how this session opens. **Anti-leak path (preferred)**: if the host page
  // supplied embed credentials (embed id + kid + private key), sign an EdDSA JWT on the spot
  // and send only embed_token, **never the plaintext code**. No credentials → fall back to
  // the old path (mode + code / public). See [[embed-credential-never-carries-the-code]].
  private async sessionInput(): Promise<IssueSessionInput> {
    const embed = this.getAttribute('embed');
    const kid = this.getAttribute('kid');
    const key = this.getAttribute('key');
    if (embed && kid && key) {
      const embedToken = await signEmbedJWT(kid, embed, window.location.origin, key);
      return { mode: 'code', embed_token: embedToken };
    }
    return {
      mode: toMode(this.getAttribute('mode') ?? 'public'),
      code: this.getAttribute('code') ?? undefined,
    };
  }

  private appendBlock(role: 'visitor' | 'assistant', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.setAttribute('data-role', role);
    div.textContent = text;
    this.transcript.appendChild(div);
    return div;
  }
}

// turnFailureText —— why this turn didn't go through, **stated by category** (F-O-5).
//
// 429 means "this session is busy right now": the previous turn is still streaming. It
// calls for a **different next step** than other failures — those can be retried, retrying
// this one just gets rejected again. A single catch used to collapse both into the same
// sentence, "That did not go through. Please try again.", which told people to retry even
// when the message **actually went through**
// ([[collapsed-error-class-kills-its-own-branch]]).
//
// The gate in onKeyDown now keeps most of this class from reaching here at all; it stays
// because **the gate doesn't block every path in** (multiple tabs, programmatic calls),
// and this sentence still has to be true when it does.
function turnFailureText(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) return 'Still answering the previous question — one moment.';
  return 'That did not go through. Please try again.';
}

// applyEventToBlock —— streaming accumulation. **The raw text accumulates in the dataset,
// what renders on screen is the formatted version** (F-O-6).
//
// This used to do `textContent +=` directly, so `**like this**` and backticks printed
// literally to the visitor — syntax meant for the model leaking in front of a human
// (same class as F-R-7's `[[wikilink]]`). The product's own visitor page renders this
// correctly, the embed didn't: another case of "one capability, two surfaces, only one
// of them implemented."
function applyEventToBlock(block: HTMLDivElement, ev: SSEEvent): void {
  if (ev.kind === 'token') {
    block.dataset['raw'] = (block.dataset['raw'] ?? '') + ev.text;
    renderInline(block, block.dataset['raw']);
  } else if (ev.kind === 'error') {
    block.textContent = streamFailureText(ev);
    console.error('[standmeet-chat] stream error', ev.code, ev.message);
  }
}

// streamFailureText —— an error arriving over the stream, what should the visitor's block
// say (F-O-9)?
//
// The bill: this line used to be `error: ${ev.message}`. But the message the backend sends
// down **is already a sentence meant for a human**
// ("Something went wrong on my end — please try again."), so what showed up on screen was
// *"error: Something went wrong on my end…"* — a perfectly good sentence with a technical
// prefix we glued onto it ourselves, on a widget embedded on **someone else's site**. The
// `catch` path twelve lines up was already fixed (`turnFailureText`, the F-O-5 change), the
// stream-event path never caught up: one capability, two surfaces, only one got fixed.
//
// So: **use the backend's human-facing sentence as-is**; only fall back ourselves when it
// didn't send one (`client.ts` defaults to `'error'`). Technical detail goes to console,
// same rule as the catch path.
function streamFailureText(ev: { readonly message: string }): string {
  const msg = ev.message.trim();
  return msg === '' || msg === 'error'
    ? 'That did not go through. Please try again.'
    : msg;
}

// renderInline —— recognizes exactly three things: `**bold**`, `` `code` ``, and blank-line
// paragraph breaks.
//
// **No innerHTML, no markdown library**: this code runs on **someone else's page**, so an
// XSS here is an XSS on someone else's origin. This builds the DOM entirely with
// `createElement` + `textContent` — the injection surface doesn't exist in the first place,
// no need to bolt on a sanitizer (a full markdown pipeline would need rehype-sanitize
// ordered before rehype-katex, [[katex-sanitize-order]], but that's a separate concern, not
// handled here).
//
// The three markers were chosen deliberately, not picked at random: these are the markers
// that actually show up **at high frequency** in model answers; everything else (tables,
// lists, links) should degrade to plain text in a small window embedded on someone else's
// page anyway.
// renderInline —— parsing goes through core's `parseAnswerText` (the same one the React
// bindings use, F-O-8), this just assembles the resulting spans into DOM. All
// `createElement` + `textContent`, never touches innerHTML.
function renderInline(block: HTMLDivElement, raw: string): void {
  block.textContent = '';
  for (const spans of parseAnswerText(raw)) {
    const p = document.createElement('div');
    p.className = 'para';
    for (const piece of spans) {
      p.appendChild(spanToNode(piece));
    }
    block.appendChild(p);
  }
}

const SPAN_TAG: Readonly<Record<string, string>> = {
  bold: 'strong', italic: 'em', code: 'code',
};

function spanToNode(m: AnswerSpan): Node {
  const tag = SPAN_TAG[m.kind];
  if (tag === undefined) return document.createTextNode(m.text);
  const el = document.createElement(tag);
  el.textContent = m.text;
  return el;
}

const MODES: readonly SessionMode[] = ['public', 'code', 'byoai'];
function toMode(s: string): SessionMode {
  return MODES.find((m) => m === s) ?? 'public';
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
