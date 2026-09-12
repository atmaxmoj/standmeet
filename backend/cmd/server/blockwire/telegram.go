package blockwire

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// telegramVaultAdapter —— credentials.Repo → adapters.TelegramVault (connection state only;
// the bot token itself is read back by the /internal/im/config route, not by this
// supplier — the supplier does nothing but hold the credential).
type telegramVaultAdapter struct{ repo *credentials.Repo }

func (a telegramVaultAdapter) Connected(
	ctx context.Context, blockID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return false, fmt.Errorf("telegram vault connected: %w", err)
	}
	return conn.Connected, nil
}
