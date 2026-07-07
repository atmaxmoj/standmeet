// aad_test.go —— at-rest 密文的 AAD 绑定(owner-scoped)。持久化凭据(connector creds / owner LLM
// key / gcal token)必须绑到 owner_id:能写 DB 的攻击者把 owner A 的密文塞进 owner B 的行时,
// decrypt 必须失败(AAD mismatch),不能被静默调包。
//
// 迁移纪律:AAD 是**破坏性 wire-format 变更**(老密文用 nil AAD 封的)。Decrypt 必须先按新 AAD
// 试,失败再退回无-AAD 解(decrypt-with-then-without),让升级前落库的行继续可解、新写入才绑 AAD。
//
// RED(实现前):Encrypt/Decrypt 还不收 aad 参数 → 编译不过 → 红。

package cryptobox_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/cryptobox"
)

const (
	// at-rest 路径(Encrypt/Decrypt)读 INSTANCE_SECRET 派生 key;单测 t.Setenv 塞 ≥32 字节的。
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long-xyz"
	aadOwnerA          = "owner-aaaaaaaa-1111"
	aadOwnerB          = "owner-bbbbbbbb-2222"
	aadSecret          = "smtp-password-do-not-leak-7c1f"
)

// TestAAD_CrossOwnerSwapBlocked —— owner A 的密文用 owner B 的 AAD 解 → ErrTampered(调包被挡);
// 同 owner AAD → round-trip。
func TestAAD_CrossOwnerSwapBlocked(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := cryptobox.Encrypt([]byte(aadSecret), []byte(aadOwnerA))
	require.NoError(t, err)

	out, rerr := cryptobox.Decrypt(blob, []byte(aadOwnerA))
	require.NoError(t, rerr, "same-owner AAD round-trips")
	require.Equal(t, aadSecret, string(out))

	_, serr := cryptobox.Decrypt(blob, []byte(aadOwnerB))
	require.ErrorIs(t, serr, cryptobox.ErrTampered,
		"swapping A's ciphertext into B's row must fail")
	require.NotContains(t, serr.Error(), aadSecret, "error must not leak the plaintext")
}

// TestAAD_EmptyMismatchAlsoFails —— aad 严格性:空 AAD 封的密文用非空 AAD 解也必须 fail(没有
// legacy fallback)。守住"未发版 → 全库密文都带正确 owner AAD,不给无绑定留后门"。
func TestAAD_EmptyMismatchAlsoFails(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := cryptobox.Encrypt([]byte(aadSecret), nil) // 无绑定封
	require.NoError(t, err)

	_, serr := cryptobox.Decrypt(blob, []byte(aadOwnerA))
	require.ErrorIs(t, serr, cryptobox.ErrTampered,
		"no-AAD ciphertext must NOT decrypt under a real AAD")
}
