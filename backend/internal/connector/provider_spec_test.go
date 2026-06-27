// provider_spec_test.go —— #155 装配验证：拉一条 simov/grant（MIT，config/oauth.json）的
// 真实 google 条目，喂进我们的 ProviderSpec，看是否真能装配出一个能跑 OAuth 的 connector
// 配置（拼出 Google 的同意页 URL）。证明「蹭社区 MIT catalog → 装配」这条缝是通的，且
// 不碰任何 ELv2 代码/文件。
//
// 来源：simov/grant config/oauth.json 的 "google" 条目（MIT）。proxy base + scopes 从
// Google Calendar API 自己的公开文档补（事实，catalog 不带）。

package connector_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// grantGoogleJSON —— grant config/oauth.json 里 "google" 那条的原样（MIT）。
const grantGoogleJSON = `{
  "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
  "access_url": "https://oauth2.googleapis.com/token",
  "oauth": 2,
  "scope_delimiter": " "
}`

func TestAssembleFromGrantCatalog_Google(t *testing.T) {
	t.Parallel()

	var e connector.GrantEntry
	if err := json.Unmarshal([]byte(grantGoogleJSON), &e); err != nil {
		t.Fatalf("parse grant entry: %v", err)
	}

	// proxy base + scope 从 Google Calendar API 公开文档补（事实）。
	spec, serr := connector.SpecFromGrant("google_calendar", e,
		"https://www.googleapis.com/calendar/v3",
		[]string{"https://www.googleapis.com/auth/calendar"})
	if serr != nil {
		t.Fatalf("SpecFromGrant: %v", serr)
	}

	cfg := spec.OAuthConfig("client-id", "client-secret", "https://me.example/callback")
	url := cfg.AuthCodeURL("state-xyz")

	// 装配出来的 OAuth config 真能拼出 Google 的同意页 URL，字段都对。
	assertContainsAll(t, url, []string{
		"https://accounts.google.com/o/oauth2/v2/auth",
		"client_id=client-id",
		"scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar",
		"state=state-xyz",
		"redirect_uri=https%3A%2F%2Fme.example%2Fcallback",
	})
	if spec.ProxyBaseURL != "https://www.googleapis.com/calendar/v3" {
		t.Fatalf("proxy base not assembled: %q", spec.ProxyBaseURL)
	}
}

func TestSpecFromGrant_RejectsOAuth1(t *testing.T) {
	t.Parallel()

	_, err := connector.SpecFromGrant("legacy", connector.GrantEntry{OAuth: 1}, "https://api", nil)
	if err == nil {
		t.Fatal("expected oauth1 entry to be rejected, got nil")
	}
}

func assertContainsAll(t *testing.T, s string, wants []string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(s, want) {
			t.Fatalf("assembled value missing %q\ngot: %s", want, s)
		}
	}
}
