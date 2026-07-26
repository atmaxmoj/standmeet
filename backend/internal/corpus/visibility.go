// visibility.go —— Writing 的可见性 sub-object。
//
// Visibility 决定 visitor (无 code 或 code 不匹) 看到 writing 时的形态：
//   - Public：body_md 全开
//   - Private：前端只渲 LockedBody 字段当 teaser，body_md 不返
//
// 真 access control 走 [[iam-role-pivot-plan]] 的 corpus URI ACL（A.3-IAM
// 实做）；这里的 Visibility 只是"前端按啥渲"提示。

package corpus

// VisibilityMode —— 可见性模式枚举。pre-launch 只两档，未来可扩 unlisted /
// timed-release 等。
const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

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
