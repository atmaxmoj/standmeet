// capreg_claim_gate.go —— 能力 manifest 里那份「说了就得做」的声明 → 装配结果。
//
// 声明在数据里（`claim_gate: {tool, phrases}`），判定在内核（inference/agent_claim_gate.go），
// 这里只是把它原样带过一道边界。拆出 capreg_mcp_app.go 守 max-lines 350。

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// claimGateOf —— manifest 声明的条件 → 装配面的条件。没声明（或声明不全）→ nil，也就是这个
// 能力不闸主张：判不了的时候「不闸」比「瞎闸」对，跟 quota 那份声明同一个取舍。
func claimGateOf(m *mcpplugin.Manifest) *capreg.ClaimGate {
	if !m.ClaimGate.Usable() {
		return nil
	}
	return &capreg.ClaimGate{Tool: m.ClaimGate.Tool, Phrases: m.ClaimGate.Phrases}
}
