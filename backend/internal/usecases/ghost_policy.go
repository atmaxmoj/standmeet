// ghost_policy.go —— ghost-steering P3: 单个 steering ghost 的 policy(纯 prompt + parse + 落库封装)。
//
// 分工:LLM 调用(Generate)在 route 闭包(有 cred);本文件出 prompt(versioned,受 hash-regression
// 纪律约束)、解析 LLM 输出、把 policy ghost 落库(route 不碰 postgres,守 arch)。
// 设计骨架见 [[ghost-steering]] §"The prompt skeleton"。"ONE GHOST MESSAGE" 是骨架开头,也是
// mock gateway 认 GhostPolicy 调用的标记 —— 改这句要同步 mock。
//
// ghost 是 conversation 的能力(不是外置 plugin):policy/telemetry 跟 conversation 代码一起住核心。
// inference 只发通用 EpilogueFrame;route 把本文件出的候选包成 Kind="ghost" 的 epilogue。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// GhostPolicyPrompt —— platform-owned、稳定、versioned 的机制 prompt(part_ids + hash 纪律)。
// owner 只写 destinations(waypoints),不写机制。骨架开头的 "ONE GHOST MESSAGE" 双重身份:mock
// 识别标记 + 设计骨架首句。
const GhostPolicyPrompt = `You generate at most ONE GHOST MESSAGE: a candidate next message the
VISITOR might send — written in the visitor's voice, not the owner's.

RULES:
1. VOICE — something a curious visitor would plausibly say next: short, first-person,
   their register. Never marketing, never pressure.
2. COHERENCE — it must hook onto something concrete in the assistant's last message
   (name what it follows from).
3. HEADING — tag it with exactly ONE unvisited waypoint it advances. No tag → do not emit.
4. ONE OR NONE — if no natural hook advances any unvisited waypoint, emit NOTHING.
   Silence is an action.
5. SELECTION — follow the visitor's momentum when their own message already
   points at an unvisited waypoint; otherwise the highest-weight waypoint
   coherently reachable in one hop.
6. EVIDENCE — only propose questions the corpus can answer well.
7. NO-REPEAT — a declined waypoint may not be re-offered.
8. TERMINAL — when the goal action is one natural step away, the slot goes to the ask, plainly.

OUTPUT a single JSON object {"text","target_waypoint","follows_from","is_bridge"}
or the literal null.`

// GhostCandidate —— GhostPolicy LLM 输出解析后的候选(nil = silence)。
type GhostCandidate struct {
	Text           string `json:"text"`
	TargetWaypoint string `json:"target_waypoint"`
	FollowsFrom    string `json:"follows_from"`
	IsBridge       bool   `json:"is_bridge"`
}

// UnvisitedWaypoints —— 冻结 waypoints 里还没到访的(policy 只推这些;全到 → 空 → silence)。
func UnvisitedWaypoints(waypoints []access.Waypoint, visited []string) []access.Waypoint {
	out := make([]access.Waypoint, 0, len(waypoints))
	for i := range waypoints {
		if !slices.Contains(visited, waypoints[i].WaypointID) {
			out = append(out, waypoints[i])
		}
	}
	return out
}

// SteeringCandidates —— 从冻结 snapshot 取本轮可推的 steering waypoints:先去掉已访问的,再(当
// snapshot 要求证据时)剔除空证据的非终点 waypoint。F-A-10。开关读自 snapshot(role 值,code 可覆盖),
// 不作 flag 形参穿过边界。
func SteeringCandidates(snap *access.RoleSnapshot, visited []string) []access.Waypoint {
	unvisited := UnvisitedWaypoints(snap.Waypoints(), visited)
	if !snap.RequireGhostEvidence() {
		return unvisited
	}
	return filterSteeringByEvidence(unvisited)
}

// filterSteeringByEvidence —— 把**非终点**(steering)且 evidence_refs 为空的 waypoint 剔除 —— 让
// prompt 规则6("no refs → not proposable")从"写着不强制"变成真强制。**终点/工具 waypoint(预约)永远
// 保留** —— 它们靠工具而非语料完成,本就没有语料证据。
func filterSteeringByEvidence(waypoints []access.Waypoint) []access.Waypoint {
	out := make([]access.Waypoint, 0, len(waypoints))
	for i := range waypoints {
		if waypoints[i].IsTerminal || len(waypoints[i].EvidenceRefs) > 0 {
			out = append(out, waypoints[i])
		}
	}
	return out
}

// BuildGhostContext —— GhostPolicy 的 user 侧上下文:未访问 waypoints(id/描述/权重/terminal)+
// 本轮末条 assistant 回复(COHERENCE 挂点)。system 侧是 GhostPolicyPrompt。
func BuildGhostContext(unvisited []access.Waypoint, lastMsg string) string {
	lines := make([]string, 0, len(unvisited)+4)
	lines = append(lines, "UNVISITED WAYPOINTS (advance exactly one):")
	for i := range unvisited {
		lines = append(lines, fmt.Sprintf("- id=%s weight=%d terminal=%v: %s",
			unvisited[i].WaypointID, unvisited[i].Weight,
			unvisited[i].IsTerminal, unvisited[i].Description))
	}
	lines = append(lines, "", "THE ASSISTANT'S LAST MESSAGE:", lastMsg)
	return strings.Join(lines, "\n")
}

// ParseGhost —— LLM 输出(JSON object 或 "null")→ 候选。解析失败 / null / 缺 text|target → nil。
func ParseGhost(raw string) *GhostCandidate {
	s := strings.TrimSpace(raw)
	if s == "" || s == "null" {
		return nil
	}
	var c GhostCandidate
	if json.Unmarshal([]byte(s), &c) != nil {
		return nil
	}
	if !validGhost(&c) {
		return nil
	}
	return &c
}

// validGhost —— HEADING 规则:policy ghost 必须有正文 + 恰一个 target_waypoint 标签。
func validGhost(c *GhostCandidate) bool {
	return c.Text != "" && c.TargetWaypoint != ""
}

// PolicyGhostInput —— 落一条 policy ghost 的入参。
type PolicyGhostInput struct {
	OwnerID        string
	ConversationID string
	Text           string
	TargetWaypoint string
	FollowsFrom    string
}

// RecordPolicyGhost —— 落一条 policy ghost，返回 row id(帧回填给前端 accept)。route 经此不碰 postgres。
func RecordPolicyGhost(ctx context.Context, deps GhostDeps, in *PolicyGhostInput) (string, error) {
	row, err := deps.Repo.RecordPolicy(ctx, &postgres.RecordPolicyInput{
		OwnerID: in.OwnerID, ConversationID: in.ConversationID, GhostText: in.Text,
		TargetWaypoint: in.TargetWaypoint, FollowsFrom: in.FollowsFrom,
	})
	if err != nil {
		return "", fmt.Errorf("record policy ghost: %w", err)
	}
	return row.ID, nil
}
