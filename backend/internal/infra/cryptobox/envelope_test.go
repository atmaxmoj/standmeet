// envelope_test.go —— connector-deps-tests.md §四 E5:凭据解密失败(vault 损坏 / 换错 key)
// 必须 friendly 降级,且**错误里绝不含密文/明文**。cryptobox 是 connector 凭据 no-leak 的
// 最后一道:secret 只以密文落库,解密只在 connector 层内。这里守住 decrypt 失败路径。

package cryptobox_test

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

const (
	e5Secret    = "super-secret-smtp-password-xyz-9f3a"
	flipTagByte = 0xFF // 翻转密文尾字节 → GCM auth tag 校验失败
)

// TestDecryptFailure_NoSecretLeak —— E5:换错 key / 密文损坏 / 截断 都返 ErrTampered,
// 错误串里不含明文密钥、也不含密文字节,且截断输入不 panic;同 key round-trip 正常。
func TestDecryptFailure_NoSecretLeak(t *testing.T) {
	t.Parallel()
	keyA, err := cryptobox.DeriveSessionKey("session-token-A", "connector-cred")
	require.NoError(t, err)
	keyB, err := cryptobox.DeriveSessionKey("session-token-B", "connector-cred")
	require.NoError(t, err)

	secret := []byte(e5Secret)
	blob, err := cryptobox.EncryptWithKey(keyA, secret)
	require.NoError(t, err)

	// 正例:同 key round-trip 还原。
	out, rerr := cryptobox.DecryptWithKey(keyA, blob)
	require.NoError(t, rerr)
	require.Equal(t, secret, out, "same key round-trips")

	// 换错 key(key mismatch)→ ErrTampered,错误不泄密。
	_, kerr := cryptobox.DecryptWithKey(keyB, blob)
	require.ErrorIs(t, kerr, cryptobox.ErrTampered, "wrong key → ErrTampered")
	requireNoLeak(t, kerr.Error(), secret, blob)

	// vault 损坏(翻转 auth tag 尾字节)→ ErrTampered。
	corrupt := append([]byte(nil), blob...)
	corrupt[len(corrupt)-1] ^= flipTagByte
	_, cerr := cryptobox.DecryptWithKey(keyA, corrupt)
	require.ErrorIs(t, cerr, cryptobox.ErrTampered, "corrupt blob → ErrTampered")
	requireNoLeak(t, cerr.Error(), secret, blob)

	// 截断到比 nonce 还短 → ErrTampered,不 panic。
	_, serr := cryptobox.DecryptWithKey(keyA, []byte("x"))
	require.ErrorIs(t, serr, cryptobox.ErrTampered, "truncated blob → ErrTampered, no panic")
}

func requireNoLeak(t *testing.T, msg string, secret, blob []byte) {
	t.Helper()
	require.NotContains(t, msg, string(secret), "error must not leak the plaintext secret")
	require.False(t, bytes.Contains([]byte(msg), blob), "error must not leak ciphertext bytes")
}
