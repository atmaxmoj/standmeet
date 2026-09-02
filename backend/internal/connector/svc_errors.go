// errors.go — connectorsvc's sentinel errors. Each expresses one kind of failure the caller
// **needs to distinguish** (the routes layer translates them into different HTTP envelopes);
// keeping them separate prevents "bad manifest / built-in can't be edited / stale state" from
// collapsing into one vague error.

package connector

import "errors"

// ErrNotFound — unknown connector id (not in the built-in manifests).
var ErrNotFound = errors.New("connector not found")

// ErrNoOAuthClient — an oauth connector hasn't had client_id saved yet (credentials must be
// saved before connect).
var ErrNoOAuthClient = errors.New("connector oauth client_id not set")

// ErrNoConnection — this owner has no row yet for this connector (credentials were never saved
// even once), so there's nothing to mark connected / active. Kept separate from ErrNotFound:
// that one says "no such connector exists", this one says "the connector exists, you just
// haven't put anything into it yet" — the owner's next step differs (the former has no
// remedy, the latter means go fill in the form).
//
// It's the non-dance-side counterpart of the dance side's long-standing ErrNoOAuthClient: that
// side has always checked its precondition before connecting; this side didn't, so "mark
// connected" ran against a nonexistent row and still reported success.
var ErrNoConnection = errors.New("connector has no stored connection for this owner")

// ErrConnectionFailed — a protocol connector's connection test failed (host/port/auth/TLS
// error).
var ErrConnectionFailed = errors.New("connector connection test failed")

// ErrInvalidManifest — an uploaded spec/binding failed assembly-time validation (bad JSONata /
// unknown op / missing category, etc.).
var ErrInvalidManifest = errors.New("invalid connector spec/binding")

// ErrBuiltinReadonly — modifying/deleting a built-in connector (editing its spec, deleting it):
// built-ins come from embedded data and can't be changed. Kept separate from
// ErrInvalidManifest — "you sent a bad manifest" and "this is a built-in and can't be changed"
// are two different things.
var ErrBuiltinReadonly = errors.New("built-in connector is read-only")

// ErrInvalidOAuthState — the OAuth return trip's state is empty/expired/mismatched (failed the
// anti-replay check). An expected state (user replayed it, double-clicked, state expired), not
// a missing client config — kept separate from ErrNoOAuthClient.
var ErrInvalidOAuthState = errors.New("invalid or expired oauth state")
