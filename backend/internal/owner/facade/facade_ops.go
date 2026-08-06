// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/owner/ops。

package owner

import "github.com/atmaxmoj/standmeet/internal/owner/ops"

// 声明操作时要的类型（实现:ops）.
type (
	AIPreset          = ops.AIPreset
	OpsAccountDeps    = ops.AccountDeps
	OpsAccessRequests = ops.AccessRequestsDeps
	OpsHostLookup     = ops.MetaLookup
	OpsPage           = ops.PageOpsDeps
	OpsSEO            = ops.SEODeps
	SettingsDeps      = ops.SettingsDeps
	OpsProviders      = ops.ProvidersDeps
)

// 操作组（实现:ops）.
var (
	AccessRequestOps = ops.AccessRequests
	// HostOps —— 开给沙箱能力的:读 owner 的白名单字段。
	HostOps       = ops.HostOps
	AccountOps    = ops.Account
	AppearanceOps = ops.Appearance
	CustomPageOps = ops.CustomPages
	DomainOps     = ops.Domains
	PageOps       = ops.Page
	PromptOps     = ops.Prompts
	SEOOps        = ops.SEO
	SettingsOps   = ops.Settings
	ProviderOps   = ops.Providers
)
