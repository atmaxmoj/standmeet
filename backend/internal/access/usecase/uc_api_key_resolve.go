// api_key_resolve.go —— API-key auth: resolve a presented `smk_…` secret to its key row. Split from
// api_key.go to keep the exported-type count within the per-file lint cap.

package usecase

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

// APIKeyResolver —— the auth side: hash → key lookup (APIKeyRepo implements it).
type APIKeyResolver interface {
	GetBySecretHash(ctx context.Context, hash []byte) (entity.APIKey, error)
}

// ResolveAPIKey —— auth: hash the presented secret and look up the active key. A malformed or
// unknown secret → ErrAPIKeyNotFound (the middleware answers 401). Constant-time is unnecessary
// here: the lookup is by sha256 of the secret, so timing reveals nothing about a valid secret.
func ResolveAPIKey(
	ctx context.Context, store APIKeyResolver, rawSecret string,
) (entity.APIKey, error) {
	if !strings.HasPrefix(rawSecret, apiKeyPrefix) {
		return entity.APIKey{}, entity.ErrAPIKeyNotFound
	}
	sum := sha256.Sum256([]byte(rawSecret))
	key, err := store.GetBySecretHash(ctx, sum[:])
	if err != nil {
		return entity.APIKey{}, fmt.Errorf("resolve api key: %w", err)
	}
	return key, nil
}
