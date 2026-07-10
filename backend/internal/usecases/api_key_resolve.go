// api_key_resolve.go —— API-key auth: resolve a presented `smk_…` secret to its key row. Split from
// api_key.go to keep the exported-type count within the per-file lint cap.

package usecases

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// APIKeyResolver —— the auth side: hash → key lookup (postgres.APIKeyRepo implements it).
type APIKeyResolver interface {
	GetBySecretHash(ctx context.Context, hash []byte) (domain.APIKey, error)
}

// ResolveAPIKey —— auth: hash the presented secret and look up the active key. A malformed or
// unknown secret → ErrAPIKeyNotFound (the middleware answers 401). Constant-time is unnecessary
// here: the lookup is by sha256 of the secret, so timing reveals nothing about a valid secret.
func ResolveAPIKey(
	ctx context.Context, store APIKeyResolver, rawSecret string,
) (domain.APIKey, error) {
	if !strings.HasPrefix(rawSecret, apiKeyPrefix) {
		return domain.APIKey{}, domain.ErrAPIKeyNotFound
	}
	sum := sha256.Sum256([]byte(rawSecret))
	key, err := store.GetBySecretHash(ctx, sum[:])
	if err != nil {
		return domain.APIKey{}, fmt.Errorf("resolve api key: %w", err)
	}
	return key, nil
}
