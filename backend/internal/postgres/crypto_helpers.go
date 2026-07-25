// crypto_helpers.go —— shared at-the-boundary encryption helpers for connector-credential repos
// (mail_connectors etc.). Plaintext secrets are encrypted with cryptobox (AES-256-GCM) before they
// hit the DB and decrypted on read; callers only ever see plaintext in memory.
//
// (These lived in the now-deleted calendar.go — the pre-#155 gcal connector repo — but the crypto
// helpers themselves are generic, so they moved here when that dead legacy was removed.)

package postgres

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/cryptobox"
)

func maybeEncrypt(plain string, aad []byte) ([]byte, error) {
	if plain == "" {
		return []byte{}, nil
	}
	out, err := cryptobox.Encrypt([]byte(plain), aad)
	if err != nil {
		return []byte{}, fmt.Errorf("encrypt: %w", err)
	}
	return out, nil
}

func decryptOrEmpty(blob, aad []byte) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	plain, err := cryptobox.Decrypt(blob, aad)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}
