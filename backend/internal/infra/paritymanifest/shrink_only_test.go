package paritymanifest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
)

// remainingOps —— 这张手写对照表**当前还剩多少条**。
//
// 这个数字只能变小,变大就红。
//
// 为什么:这张表存在的唯一理由是过去没有出站收口 —— MCP 和 admin 两个面各自手写,谁也不是谁的
// 投影,于是只能靠一张人肉台账事后对账。收口一旦接手一个 op,它的 parity 就是结构的性质
// (MCP 面遍历收口生成、admin 面只能经 Face 取能力且取用即登记、启动时 Conform 拿 Reach 对账),
// 台账里再留一行只是重复声明。
//
// 所以迁移的每一步都从这里删行,删到 0,**整个包连同这个测试一起删掉**。
// 数字变大 = 又有人往手写台账里加东西,而不是把能力搬进收口 —— 那是往回走。
const remainingOps = 111

func TestManifestOnlyShrinks(t *testing.T) {
	t.Parallel()

	require.LessOrEqualf(t, len(paritymanifest.Manifest()), remainingOps,
		"the hand-written parity ledger grew. Declare new capability in the outbound "+
			"convergence point (internal/routes/dispatcher) instead — parity for anything "+
			"declared there is a property of the structure, so it needs no row here.")
}

// TestManifestIsGoneWhenEmpty —— 台账清空的那一刻,这个包就该消失,而不是留一个空壳继续被 import。
// 到 0 时这个测试红,红的内容就是删除指令。
func TestManifestIsGoneWhenEmpty(t *testing.T) {
	t.Parallel()

	require.NotEmptyf(t, paritymanifest.Manifest(),
		"the ledger is empty — every capability now lives in the outbound convergence "+
			"point. Delete the whole internal/infra/paritymanifest package (and its last "+
			"references in ownercore); parity is answered by the dispatcher's structure alone.")
}
