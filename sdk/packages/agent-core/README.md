# @standmeet/agent-core

The visitor chat turn, as a client sees it: `VisitorTurnAgent` sends one question to a StandMeet
instance's agent endpoint and turns the streamed reply into typed events (text, tool progress,
citations, the finish). The agent loop itself runs on the instance; this package is the part every
client shares, behind ports, so the browser SDK, the embed and the eval harness run the same code.

Most people use it through `@standmeet/sdk` (React) or `@standmeet/embed` and never import it
directly.

## Install

```sh
npm i @standmeet/agent-core
```

## Use

```ts
import { VisitorTurnAgent, agentEventOf } from '@standmeet/agent-core';
```

`VisitorTurnAgent` takes its I/O as ports (the prompt source, the turn streamer, an event observer),
so a host supplies transport and rendering and gets the same turn semantics: cut detection,
recovery of a turn whose stream dropped, and the `session_gone` code when a turn is refused because
its session no longer exists.

## Versioning

Versions follow the StandMeet instance's release tags (`v0.1.130` → `0.1.130`).

## License

MIT
