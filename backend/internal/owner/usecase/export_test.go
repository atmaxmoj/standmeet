package usecase

import (
	"context"
	"log/slog"
)

func discardLog() *slog.Logger { return slog.New(slog.DiscardHandler) }

// Test-only handles on the Sigv1 internals (keypairs_nonce_test.go).

// NonceStoreErrorRefuses —— runs the nonce check against store; nil means "allowed".
func NonceStoreErrorRefuses(ctx context.Context, store NonceStore) error {
	return checkNonceFresh(ctx, KeypairDeps{Nonce: store, Log: discardLog()},
		&parsedSigv1{keyID: "k", nonce: "n"})
}

// BoundChallenge —— the signed payload for keyID k, ts 1, nonce n, in the given form.
func BoundChallenge(version string, req *SignedRequest) string {
	return challengeFor(&parsedSigv1{keyID: "k", ts: 1, nonce: "n", version: version}, req)
}
