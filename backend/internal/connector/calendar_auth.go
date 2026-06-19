// calendar_auth.go —— Phase B：日历连接器的 OAuth 装配/换码也归连接器层。
// admin 路由不再直接碰 gcal —— 经 CalendarAuth 拿 consent URL + 用 code 换 token，
// gcal 的 OAuth 类型不外泄到 routes/admin。

package connector

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/gcal"
)

// CalendarAuthClient —— gcal OAuth 抽象（*gcal.Client 直接满足）。
type CalendarAuthClient interface {
	BuildAuthCodeURL(in gcal.AuthCodeURLInput) string
	ExchangeCode(ctx context.Context, in gcal.ExchangeCodeInput) (gcal.TokenResponse, error)
}

// CalendarAuth —— 连接器 OAuth：建 consent URL + code 换 token。
type CalendarAuth struct {
	client CalendarAuthClient
}

// NewCalendarAuth —— composition root 注入 gcal client。
func NewCalendarAuth(client CalendarAuthClient) *CalendarAuth {
	return &CalendarAuth{client: client}
}

// AuthURLInput —— 建 consent URL 入参（connector 级，无 gcal 类型）。
type AuthURLInput struct {
	ClientID    string
	RedirectURI string
	State       string
	Scopes      []string
}

// AuthURL —— owner 浏览器去 Google 授权的 consent URL。
func (a *CalendarAuth) AuthURL(in AuthURLInput) string {
	return a.client.BuildAuthCodeURL(gcal.AuthCodeURLInput{
		ClientID: in.ClientID, RedirectURI: in.RedirectURI,
		State: in.State, Scopes: in.Scopes,
	})
}

// ExchangeInput —— code 换 token 入参。
type ExchangeInput struct {
	ClientID     string
	ClientSecret string
	Code         string
	RedirectURI  string
}

// TokenResult —— 换到的 token（connector 级，无 gcal 类型）。
type TokenResult struct {
	ExpiresAt    time.Time
	AccessToken  string
	RefreshToken string
	Scope        string
}

// Exchange —— 拿 consent code 换 access/refresh token。
func (a *CalendarAuth) Exchange(ctx context.Context, in ExchangeInput) (TokenResult, error) {
	resp, err := a.client.ExchangeCode(ctx, gcal.ExchangeCodeInput{
		ClientID: in.ClientID, ClientSecret: in.ClientSecret,
		Code: in.Code, RedirectURI: in.RedirectURI,
	})
	if err != nil {
		return TokenResult{}, fmt.Errorf("exchange code: %w", err)
	}
	return TokenResult{
		ExpiresAt: resp.ExpiresAt, AccessToken: resp.AccessToken,
		RefreshToken: resp.RefreshToken, Scope: resp.Scope,
	}, nil
}
