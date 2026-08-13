// claimgate.go —— 装配面上的「说了就得做」条件。
//
// 能力在自己的 manifest 里声明（`claim_gate: {tool, phrases}`），装配把它搭在 Binding 上带
// 出来，内核在 turn 收尾判一次（inference/agent_claim_gate.go）：答案断言动作完成了，本轮就
// 必须有那个工具的成功回执。装配面不判，只搬。

package capreg

// ClaimGate —— 一个能力的必要条件：答案断言动作完成时，本轮必须有 Tool 的成功回执。
type ClaimGate struct {
	Tool    string
	Phrases []string
}
