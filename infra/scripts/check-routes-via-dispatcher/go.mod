// Standalone lint tool module (pure stdlib) — not part of the backend production modules; built and
// executed only during make lint (CWD=backend, scanning ./internal/routes).
module standmeet.tools/check-routes-via-dispatcher

go 1.26
