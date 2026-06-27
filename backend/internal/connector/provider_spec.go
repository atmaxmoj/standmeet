// provider_spec.go —— #155: spec-driven connector 配方（取代手搓的 per-provider Go）。
// 蹭社区 catalog 的模型：一条声明式 spec 就装配出一个能跑 OAuth+proxy 的 connector，
// 加一个 SaaS = 加一条 spec，不写 Go。
//
// OAuth 半边（authorize/token/scope_delimiter）的「配方」直接吃 simov/grant 的
// config/oauth.json 格式（MIT，~380 provider，事实=各家公开 OAuth 文档）。grant 不带
// API base_url（proxy 要的）—— 那是各家 API 文档里的另一个事实，我们按 provider 补上。
//
// 不抄任何 ELv2 代码/文件；grant 是 MIT，可直接吃其格式。

package connector

import (
	"fmt"

	"golang.org/x/oauth2"
)

// ProviderSpec —— 一个 connector 的完整配方。OAuth 半边来自 catalog；ProxyBaseURL +
// DefaultScopes 从该 SaaS 自己的 API 文档补（catalog 不带）。
type ProviderSpec struct {
	Name           string
	AuthorizeURL   string
	AccessURL      string // token endpoint
	ScopeDelimiter string
	ProxyBaseURL   string // API root，proxy 注入用
	DefaultScopes  []string
}

// GrantEntry —— simov/grant config/oauth.json 一条的形状（MIT）。只用得上这几个字段。
type GrantEntry struct {
	AuthorizeURL   string `json:"authorize_url"`
	AccessURL      string `json:"access_url"`
	ScopeDelimiter string `json:"scope_delimiter"`
	OAuth          int    `json:"oauth"`
}

// SpecFromGrant —— grant 条目 + 我们补的 (proxyBase, scopes) → ProviderSpec。证明社区
// catalog 能直接喂进我们的 spec。只收 oauth:2（不做 oauth1）。
func SpecFromGrant(
	name string, e GrantEntry, proxyBase string, scopes []string,
) (ProviderSpec, error) {
	if e.OAuth != 2 {
		return ProviderSpec{}, fmt.Errorf(
			"connector: %s is oauth%d, only oauth2 supported", name, e.OAuth)
	}
	delim := e.ScopeDelimiter
	if delim == "" {
		delim = " "
	}
	return ProviderSpec{
		Name: name, AuthorizeURL: e.AuthorizeURL, AccessURL: e.AccessURL,
		ScopeDelimiter: delim, ProxyBaseURL: proxyBase, DefaultScopes: scopes,
	}, nil
}

// OAuthConfig —— spec + owner 应用凭据 → 通用 oauth2.Config。这就是「装配」OAuth 半边：
// 任意 catalog 条目都拼得出一个能跑授权/换 token 的 config，零 per-provider 代码。
func (s *ProviderSpec) OAuthConfig(clientID, clientSecret, redirectURL string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Scopes:       s.DefaultScopes,
		Endpoint:     oauth2.Endpoint{AuthURL: s.AuthorizeURL, TokenURL: s.AccessURL},
	}
}
