package axisconn

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// telegramVaultAdapter —— ConnectorRepo → connector.TelegramVault (connection state only;
// the bot token itself is read back by the /internal/im/config route, not by this
// connector — the connector does nothing but hold the credential).
type telegramVaultAdapter struct{ repo *connector.Repo }

func (a telegramVaultAdapter) Connected(
	ctx context.Context, connectorID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, connectorID)
	if err != nil {
		return false, fmt.Errorf("telegram vault connected: %w", err)
	}
	return conn.Connected, nil
}
