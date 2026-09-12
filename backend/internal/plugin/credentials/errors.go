// errors.go — the sentinel this store owns.
//
// Sentinels travel with the block that raises them. This one is a fact about
// STORAGE — "there is no row for this owner yet" — so it lives beside the repo that
// discovers it, not in the service layer that translates it into an HTTP envelope.
// Leaving it behind would have been the quiet kind of breakage: the move compiles,
// the caller's errors.Is stops matching, and a missing connection starts reading as
// an unknown one.

package credentials

import "errors"

// ErrNoConnection — this owner has no row yet for this block (credentials were never
// saved even once), so there is nothing to mark connected or active.
//
// Kept distinct from "no such block exists": that one has no remedy, this one means
// the owner should go and fill in the form. It is the non-dance-side counterpart of
// the dance side's ErrNoOAuthClient — that side always checked its precondition
// before connecting; this side did not, so "mark connected" once ran against a
// nonexistent row and still reported success.
var ErrNoConnection = errors.New("block has no stored connection for this owner")
