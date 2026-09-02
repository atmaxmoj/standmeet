// facade_ops.go —— the operations this domain exposes outward, re-exported for convergence.
//
// Still just a facade: aliases only. Declared in internal/owner/ops.

package owner

import "github.com/atmaxmoj/standmeet/internal/owner/ops"

// Types needed when declaring ops (impl: ops).
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

// Op groups (impl: ops).
var (
	AccessRequestOps = ops.AccessRequests
	// HostOps —— exposed to sandboxed capabilities: reads owner's whitelisted fields.
	HostOps = ops.HostOps
	// FullNameOf —— the name persona's opening "who are you" line needs (UX-66).
	FullNameOf    = ops.FullNameOf
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
