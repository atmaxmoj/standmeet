# @standmeet/sdk-core

The framework-free core of the StandMeet SDK: a typed client for a StandMeet instance's public API,
the SSE reader the chat streams with, and the small parsers the UI packages share. No UI.

`@standmeet/sdk` (React) and `@standmeet/embed` (Web Component) are built on it; use it directly
when you are not on React or want your own UI.

## Install

```sh
npm i @standmeet/sdk-core
```

## Use

```ts
import { createClient } from '@standmeet/sdk-core';

// On the instance's own pages baseURL is ''; from another site, the instance's origin.
const sm = createClient({ baseURL: 'https://your-instance.example' });

const cards = await sm.fetchCorpusCards(); // the owner's published corpus, newest first
```

What else is exported:

| export | what it is |
|---|---|
| `createClient`, `MicrositeStoreError` | the API client (corpus cards, microsite store, sessions, …) |
| `readSSE` | reads a server-sent-event stream (the chat's turn stream) |
| `classifySkew` | compares this client's version with the instance's (version-skew advisory) |
| `parseAnswerText`, `parseCorpusQuery`, `applyCorpusQuery` | parsers the UI packages share |
| `PRESETS`, `lookupPreset` | inference provider presets (for bring-your-own-key) |

## Versioning

Versions follow the StandMeet instance's release tags (`v0.1.130` → `0.1.130`). Use the version that
matches the instance you talk to; `classifySkew` tells you when they drift.

## License

MIT
