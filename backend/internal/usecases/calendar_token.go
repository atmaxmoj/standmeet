// calendar_token.go —— Token refresh wrapper. BookMeeting 调用前确保
// access_token 不过期；invalid_grant 翻成 ErrCalendarRevoked (上层把
// connector mark disconnected)。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/gcal"
)

// ensureFreshToken —— 没过期就用现有 access_token；过期则 refresh + 持久化
// 新 token。返回 valid access_token (调用方传给 InsertEvent / FreeBusy)。
func ensureFreshToken(
	ctx context.Context, client CalendarClient, store CalendarStore,
	conn *domain.CalendarConnector,
) (string, error) {
	if !conn.AccessTokenStale() {
		return conn.AccessToken, nil
	}
	resp, err := client.RefreshToken(ctx, gcal.RefreshTokenInput{
		ClientID: conn.ClientID, ClientSecret: conn.ClientSecret,
		RefreshToken: conn.RefreshToken,
	})
	if err != nil {
		if errors.Is(err, gcal.ErrInvalidGrant) {
			return "", domain.ErrCalendarRevoked
		}
		return "", fmt.Errorf("refresh token: %w", err)
	}
	saveErr := store.SaveTokens(ctx, &SaveTokensInput{
		OwnerID:      conn.OwnerID,
		Provider:     conn.Provider,
		AccessToken:  resp.AccessToken,
		RefreshToken: resp.RefreshToken, // empty preserved by repo
		ExpiresAt:    resp.ExpiresAt,
		Scopes:       conn.Scopes, // refresh doesn't change scopes
	})
	if saveErr != nil {
		return "", fmt.Errorf("save refreshed token: %w", saveErr)
	}
	return resp.AccessToken, nil
}
