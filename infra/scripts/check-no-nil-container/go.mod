// Standalone lint tool module (pure stdlib) — not part of the backend production modules; built and
// executed only during make lint (CWD=backend, scanning ./internal + ./cmd).
module standmeet.tools/check-no-nil-container

go 1.26
