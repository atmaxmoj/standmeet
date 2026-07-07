// agent_ghost.go —— ghost-steering P3 的 inference 侧类型:单个 steering ghost 帧 + policy port。
//
// inference 只负责在 done 之后调注入的 BuildGhost 闭包(route 层的 GhostPolicy LLM + 落库),把返回
// 的 ghost 发成 `ghost` SSE 帧(sseSink.Ghost)。策略/落库都在 route/usecases,inference 不碰 DB。

package inference

import "context"

// GhostFrame —— policy 出的**单个** ghost,done 之后发一条 `ghost` SSE 帧。GhostID 是落库后的
// conversation_ghosts 行 id(前端 accept 回填用)。
type GhostFrame struct {
	Text           string `json:"text"`
	TargetWaypoint string `json:"target_waypoint"`
	FollowsFrom    string `json:"follows_from"`
	GhostID        string `json:"ghost_id"`
	IsBridge       bool   `json:"is_bridge"`
}

// BuildGhostFunc —— ghost-steering policy port。done 之后调:route 注入的闭包据本轮末条 assistant
// 回复 + 冻结 waypoints/visited,跑 GhostPolicy(owner 单模型顶 cheap-tier)出至多一个 ghost,落
// conversation_ghosts(source=policy)后返回(含 ghost_id)。返 nil = silence(不发帧)。
type BuildGhostFunc func(ctx context.Context, lastAssistantMsg string) *GhostFrame

// emitGhostPolicy —— ghost-steering P3(DriveAgentLoop 收尾调):调注入的 BuildGhost(route 闭包:
// GhostPolicy LLM + 落库),出 ghost 就发 `ghost` 帧;返 nil(silence / 未装 policy)不发。
func emitGhostPolicy(ctx context.Context, sink AgentSink, in *AgentTurnInput, state *turnState) {
	if in.BuildGhost == nil {
		return
	}
	if g := in.BuildGhost(ctx, state.assistantText); g != nil {
		sink.Ghost(g)
	}
}
