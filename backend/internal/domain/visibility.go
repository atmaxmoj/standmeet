// visibility.go —— Writing 的可见性 sub-object。
//
// Visibility 决定 visitor (无 code 或 code 不匹) 看到 writing 时的形态：
//   - Public：body_md 全开
//   - Private：前端只渲 LockedBody 字段当 teaser，body_md 不返
//
// 真 access control 走 [[iam-role-pivot-plan]] 的 corpus URI ACL（A.3-IAM
// 实做）；这里的 Visibility 只是"前端按啥渲"提示。

package domain

import "strings"

// VisibilityMode —— 可见性模式枚举。pre-launch 只两档，未来可扩 unlisted /
// timed-release 等。
const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

// VisibilityOwner —— **corp 笔记**(wiki/subjectivity/raw)的 frontmatter `visibility: owner`：
// 这条笔记对**任何 visitor session 都不可达**，无视 role glob（gate-1 的笔记级 owner 层，见
// subjectivity-owner-visibility）。
//
// 一个 key 两种语义，靠 **genre 消歧**（D.1 复用而非新造 owner_only:）：
//   - writing 上的 `visibility` = public/private，是「前端按啥渲」的发布语义（本文件上方）；
//   - corp 笔记上的 `visibility: owner` = 「服务端根本不给读」的准入语义。
//
// 为什么必须在 gate 1 而不是 gate 2：gate 2(show_as_source)只挡**署名**不挡**信息** —— 读到了
// CV 的 agent 照样能在答案里说出雇主。PII 要挡就得挡在「进不进 context」这一关。
const VisibilityOwner = "owner"

// IsOwnerOnly —— corp 笔记的 frontmatter visibility 是否声明了 owner 层。
// 大小写不敏感 + 去空白：owner 手写的 `Visibility: Owner ` 不该静默失效（静默失效正是这个
// 机制最危险的失败模式 —— owner 以为挡住了 PII，其实没挡）。
func IsOwnerOnly(visibility string) bool {
	return strings.EqualFold(strings.TrimSpace(visibility), VisibilityOwner)
}

// Visibility —— Writing 的可见性 + 锁定状态下的 teaser 文本。
type Visibility struct {
	mode       string
	lockedBody string // private 时显示给 visitor 的 teaser
}

// VisibilityInit —— 构造参数。
type VisibilityInit struct {
	Mode       string
	LockedBody string
}

// NewVisibility —— 从 Init 构造；Mode 不在白名单 → fallback public。
func NewVisibility(i *VisibilityInit) Visibility {
	return Visibility{
		mode:       normalizeMode(i.Mode),
		lockedBody: i.LockedBody,
	}
}

func normalizeMode(m string) string {
	if m == VisibilityPrivate {
		return VisibilityPrivate
	}
	return VisibilityPublic
}

// Mode —— 可见性模式字符串 (public / private)。
func (v Visibility) Mode() string { return v.mode }

// LockedBody —— private 模式下展示的 teaser；public 时无意义。
func (v Visibility) LockedBody() string { return v.lockedBody }

// IsPublic —— 是否 public 模式。
func (v Visibility) IsPublic() bool { return v.mode == VisibilityPublic }

// IsPrivate —— 是否 private 模式。
func (v Visibility) IsPrivate() bool { return v.mode == VisibilityPrivate }
