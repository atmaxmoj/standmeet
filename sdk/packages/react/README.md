# @standmeet/sdk

React components and hooks for a StandMeet instance: the chat (the same one the owner's own site
renders), the owner's corpus as browsable blocks, and the small widgets a page is built from.

## Install

```sh
npm i @standmeet/sdk react react-dom
```

## Use

This is the SDK a StandMeet **microsite** is written with: a React page the instance builds and
serves itself, so every component talks to the instance on the page's own origin.

```tsx
import { AgentWidget, CorpusWidget } from '@standmeet/sdk';
import '@standmeet/sdk/styles.css';

export default function App() {
  return (
    <main>
      <AgentWidget placeholder="Ask me anything" />
      <CorpusWidget />
    </main>
  );
}
```

To put the chat on a site the instance does not serve, use
[`@standmeet/embed`](https://www.npmjs.com/package/@standmeet/embed) — one `<script>` tag. For your
own client on another origin, `createClient` in `@standmeet/sdk-core` takes the instance's URL.

What is in it:

| export | what it is |
|---|---|
| `Agent` / `AgentWidget` | the chat — `layout="inline" \| "rail" \| "dock"`; answers anonymous visitors on the public tier, a visitor with a code on that code's slice |
| `CorpusWidget`, `GateWidget`, `PageNavWidget`, `AssetWidget`, `BlockWidget` | page blocks over the owner's corpus and access flow |
| `SiteWiki` and its parts | a microsite that reads like a wiki, kept in the microsite's own store |
| `LangSwitch`, `usePageLang`, `usePageTheme` | the visitor's language and theme, shared with the instance's own pages |
| `useChatSession` | the chat as plain state, for drawing your own chat UI |

The stylesheet uses semantic class names and CSS variables; it does not need Tailwind or any other
CSS framework on the page.

## Versioning

Versions follow the StandMeet instance's release tags (`v0.1.130` → `0.1.130`). `@standmeet/sdk-core`
and `@standmeet/agent-core` come along at the same version.

## License

MIT
