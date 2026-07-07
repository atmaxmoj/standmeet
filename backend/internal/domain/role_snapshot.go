// role_snapshot.go —— RoleSnapshot：session 起 freeze 的 Role 状态。
//
// 设计 [[iam-role-pivot-plan]] · Session freeze 节：
//   - Session issue 时把 Role 完整状态（corpus URIs / prompt body / skill prompts
//     / allowed tools / skill ids / mcp server ids / role id+name+frozen_at）
//     拍下来塞 session_data
//   - Session 整个生命周期不再回头读 role 行
//   - Owner 改 role / prompt / skill / mcp → 不影响在跑 session；只影响后续新
//     issue 的 session
//   - 唯一补救 = revoke code（access_code.status='revoked'）
//
// ACL 评估：positive-list only，raw://** hardcode deny；其他走 glob 匹配。
// Glob 方言跟 [[path_acl]] 共享（compileGlob 在 path_acl.go）。

package domain

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

// RoleSnapshot —— session 起 freeze 的 Role 状态。所有字段不可变；通过
// NewRoleSnapshot 构造，slice 容器走 defensive clone。
type RoleSnapshot struct {
	frozenAt       time.Time
	roleID         string
	roleName       string
	promptBody     string
	codePromptBody string
	corpusURIs     []string
	skillPrompts   []string
	allowedTools   []string
	// deniedCapabilities —— ACL code 层：这张 code 显式 deny 的 capability id。
	// 跟 allowedTools 正交：能力暴露门 = baseGrant(ACL=always 或 allowedTools 含它)
	// **且 不在 deniedCapabilities**。单独存（不从 allowedTools 减），因为 ACL=always
	// 的能力(retrieval/ask_visitor)根本不进 allowedTools，减不掉，只能在门上挡。
	deniedCapabilities []string
	skillIDs           []string
	mcpServerIDs       []string
	// dockButtons —— #109/#110 owner 在 role 上配的 ≤2 个 chat dock 按钮（冻结）。
	dockButtons []DockButtonConfig
	// waypoints —— ghost-steering 的引导目的地（冻结）。构造前经 FilterWaypointsByCorpus
	// 过滤：evidence_refs 全越授权 glob 的 waypoint 在冻结那刻整条丢弃（feasibility floor）。
	waypoints []Waypoint
}

// Waypoint —— ghost-steering 的一个引导目的地（owner per-role 写，冻结进 RoleSnapshot）。
// 字段顺序按 fieldalignment：两个 string 在前、slice 中、int/bool 末（最后一个指针字落早）。
type Waypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
}

// RoleSnapshotInit —— NewRoleSnapshot 入参。
type RoleSnapshotInit struct {
	FrozenAt           time.Time
	RoleID             string
	RoleName           string
	PromptBody         string
	CodePromptBody     string
	CorpusURIs         []string
	SkillPrompts       []string
	AllowedTools       []string
	DeniedCapabilities []string
	SkillIDs           []string
	MCPServerIDs       []string
	DockButtons        []DockButtonConfig
	Waypoints          []Waypoint
}

// NewRoleSnapshot —— 从 Init 构造。slice 字段 defensive clone；空 input → 空切片。
func NewRoleSnapshot(i *RoleSnapshotInit) RoleSnapshot {
	return RoleSnapshot{
		frozenAt:           i.FrozenAt,
		roleID:             i.RoleID,
		roleName:           i.RoleName,
		promptBody:         i.PromptBody,
		codePromptBody:     i.CodePromptBody,
		corpusURIs:         cloneStrings(i.CorpusURIs),
		skillPrompts:       cloneStrings(i.SkillPrompts),
		allowedTools:       cloneStrings(i.AllowedTools),
		deniedCapabilities: cloneStrings(i.DeniedCapabilities),
		skillIDs:           cloneStrings(i.SkillIDs),
		mcpServerIDs:       cloneStrings(i.MCPServerIDs),
		dockButtons:        cloneDockButtons(i.DockButtons),
		waypoints:          cloneWaypoints(i.Waypoints),
	}
}

// Waypoints —— 冻下的引导目的地（defensive copy，evidence_refs 也各自 clone）。
func (s *RoleSnapshot) Waypoints() []Waypoint { return cloneWaypoints(s.waypoints) }

// cloneWaypoints —— 深拷贝（evidence_refs slice 也 clone），防冻结后被改。
func cloneWaypoints(in []Waypoint) []Waypoint {
	if len(in) == 0 {
		return []Waypoint{}
	}
	out := make([]Waypoint, len(in))
	for i, w := range in {
		out[i] = w
		out[i].EvidenceRefs = slices.Clone(w.EvidenceRefs)
	}
	return out
}

// FilterWaypointsByCorpus —— feasibility floor（冻结时调）：丢弃 evidence_refs 全落在授权 glob
// 之外的 waypoint —— role 看不到的证据不该被引导向。无 refs 的 waypoint（如 booking 终点，靠工具
// 事件而非 corpus）保留；≥1 条 ref 在界内 → 保留整条（policy 侧只会引用可见的那些）。
func FilterWaypointsByCorpus(waypoints []Waypoint, granted []string) []Waypoint {
	out := make([]Waypoint, 0, len(waypoints))
	for _, w := range waypoints {
		if len(w.EvidenceRefs) == 0 || anyRefAllowed(granted, w.EvidenceRefs) {
			out = append(out, w)
		}
	}
	return out
}

func anyRefAllowed(granted, refs []string) bool {
	for _, ref := range refs {
		if MatchesAnyCorpusGlob(granted, ref) {
			return true
		}
	}
	return false
}

// FrozenAt —— session issue 时刻；admin /admin/codes 卡上 "issued with role
// @ ... (frozen)" 显示用。
func (s *RoleSnapshot) FrozenAt() time.Time { return s.frozenAt }

// RoleID —— 拍下来的 role id（owner 改名后 admin 还能跳过去）。
func (s *RoleSnapshot) RoleID() string { return s.roleID }

// RoleName —— 拍下来那一刻的 role 名（display 用）。
func (s *RoleSnapshot) RoleName() string { return s.roleName }

// PromptBody —— 拍下来的 prompt.body 全文，0..1（public 时是 public body，
// 没挂 prompt 的 role 就是 ""）。visitor_chat.buildSystemPrompt 拼这条。
func (s *RoleSnapshot) PromptBody() string { return s.promptBody }

// CodePromptBody —— 这张 access code 自带的 prompt 全文，0..1（#104）。session persona
// 在 role persona 之后**叠加**它；没挂则空串（persona 逐字不变，守 prompt-hash 回归）。
func (s *RoleSnapshot) CodePromptBody() string { return s.codePromptBody }

// DockButtons —— 冻下的 ≤2 个 dock 按钮配置（defensive copy）。会话装配层据此解析 title +
// 过滤 code-deny 后，出到 session payload。
func (s *RoleSnapshot) DockButtons() []DockButtonConfig { return cloneDockButtons(s.dockButtons) }

// CorpusURIs —— 拍下来的 URI glob 白名单（defensive copy）。
func (s *RoleSnapshot) CorpusURIs() []string { return slices.Clone(s.corpusURIs) }

// SkillPrompts —— 拍下来的所有 skill.prompt 拼系统 prompt 用（defensive copy）。
func (s *RoleSnapshot) SkillPrompts() []string { return slices.Clone(s.skillPrompts) }

// AllowedTools —— 拍下来的 skill.allowed_tools 合并去重（defensive copy）。
func (s *RoleSnapshot) AllowedTools() []string { return slices.Clone(s.allowedTools) }

// DeniedCapabilities —— code 层显式 deny 的 capability id（defensive copy）。
// 能力暴露门据此把 baseGrant 通过的能力再挡掉（含 ACL=always 的）。
func (s *RoleSnapshot) DeniedCapabilities() []string { return slices.Clone(s.deniedCapabilities) }

// AllowsCapability —— ACL 三层里 frozen 那部分的能力暴露判定（global 活闸在外另算）：
// baseGrant（aclAlways 恒真，否则 allowedTools 含它）**且** 不被 code deny。这是
// 三层 ACL 的真值之锚（capability-acl-hierarchy.md §3）：code 只能减，连 ACL=always
// 的能力也能被 deny 挡下（它们不进 allowedTools，只能在门上挡）。
func (s *RoleSnapshot) AllowsCapability(capID string, aclAlways bool) bool {
	if slices.Contains(s.deniedCapabilities, capID) {
		return false
	}
	return aclAlways || slices.Contains(s.allowedTools, capID)
}

// SkillIDs —— 拍下来的 skill id 列表，agent invoke 时 capability gating 用。
func (s *RoleSnapshot) SkillIDs() []string { return slices.Clone(s.skillIDs) }

// MCPServerIDs —— 拍下来的 MCP server id 列表，mcp client wiring 用。
func (s *RoleSnapshot) MCPServerIDs() []string { return slices.Clone(s.mcpServerIDs) }

// IsZero —— session 没挂 RoleSnapshot（fallback path 用）。
func (s *RoleSnapshot) IsZero() bool {
	return s.roleID == "" && len(s.corpusURIs) == 0
}

// AllowsCorpus —— 评估 URI 准入。raw://** hardcode deny；其他走 positive-list
// glob 匹配。corpus_uris 空 = deny 全部。
//
// Pattern 跟 entry URI 都包含 scheme（"wiki://thinking/lucerna"）；compileGlob
// 把 "wiki://thinking/**" 转成 "^wiki://thinking/.*$" regex 直接 match URI。
func (s *RoleSnapshot) AllowsCorpus(uri string) bool {
	return MatchesAnyCorpusGlob(s.corpusURIs, uri)
}

// MarshalJSON / UnmarshalJSON —— session 存 Redis 用 JSON，encapsulation
// 类型默认不可序列化，sidecar wire 形态把字段映出来。
func (s *RoleSnapshot) MarshalJSON() ([]byte, error) {
	b, err := json.Marshal(roleSnapshotWire{
		FrozenAt:           s.frozenAt,
		RoleID:             s.roleID,
		RoleName:           s.roleName,
		PromptBody:         s.promptBody,
		CodePromptBody:     s.codePromptBody,
		CorpusURIs:         s.corpusURIs,
		SkillPrompts:       s.skillPrompts,
		AllowedTools:       s.allowedTools,
		DeniedCapabilities: s.deniedCapabilities,
		SkillIDs:           s.skillIDs,
		MCPServerIDs:       s.mcpServerIDs,
		DockButtons:        s.dockButtons,
		Waypoints:          s.waypoints,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal role snapshot: %w", err)
	}
	return b, nil
}

// UnmarshalJSON —— 反序列化走 NewRoleSnapshot defensive clone 路径。
func (s *RoleSnapshot) UnmarshalJSON(data []byte) error {
	var w roleSnapshotWire
	if err := json.Unmarshal(data, &w); err != nil {
		return fmt.Errorf("unmarshal role snapshot: %w", err)
	}
	*s = NewRoleSnapshot(&RoleSnapshotInit{
		FrozenAt:           w.FrozenAt,
		RoleID:             w.RoleID,
		RoleName:           w.RoleName,
		PromptBody:         w.PromptBody,
		CodePromptBody:     w.CodePromptBody,
		CorpusURIs:         w.CorpusURIs,
		SkillPrompts:       w.SkillPrompts,
		AllowedTools:       w.AllowedTools,
		DeniedCapabilities: w.DeniedCapabilities,
		SkillIDs:           w.SkillIDs,
		MCPServerIDs:       w.MCPServerIDs,
		DockButtons:        w.DockButtons,
		Waypoints:          w.Waypoints,
	})
	return nil
}

// roleSnapshotWire —— JSON sidecar。字段顺序按 fieldalignment：time 在前
// (time.Time = 24B with monotonic clock)、string 中、slice 末。
type roleSnapshotWire struct {
	FrozenAt           time.Time          `json:"frozen_at"`
	RoleID             string             `json:"role_id"`
	RoleName           string             `json:"role_name"`
	PromptBody         string             `json:"prompt_body,omitempty"`
	CodePromptBody     string             `json:"code_prompt_body,omitempty"`
	CorpusURIs         []string           `json:"corpus_uris,omitempty"`
	SkillPrompts       []string           `json:"skill_prompts,omitempty"`
	AllowedTools       []string           `json:"allowed_tools,omitempty"`
	DeniedCapabilities []string           `json:"denied_capabilities,omitempty"`
	SkillIDs           []string           `json:"skill_ids,omitempty"`
	MCPServerIDs       []string           `json:"mcp_server_ids,omitempty"`
	DockButtons        []DockButtonConfig `json:"dock_buttons,omitempty"`
	Waypoints          []Waypoint         `json:"waypoints,omitempty"`
}
