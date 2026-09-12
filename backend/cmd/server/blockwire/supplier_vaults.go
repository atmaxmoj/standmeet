// supplier_vaults.go —— the credentials repo, seen through each port a supplier declares.
//
// Split out of supplier_register.go, which had grown past the max-lines ceiling, and along a
// real seam rather than wherever the lines ran out: everything here is **one adapter per
// narrow port** (connection state, SMTP config, CalDAV config, which supplier is active for a
// seam), while the file it came from answers a different question — how a manifest becomes a
// live supplier and which seams get declared.
//
// Every adapter here does the same two things and nothing else: swap the argument order, and
// decode one JSON credential blob into the typed struct that port asks for. Decryption already
// happened inside the repo; nothing on this side ever sees ciphertext or holds a key.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// connectionStoreAdapter —— credentials.Repo → adapters.ConnectionStore (swaps arg order).
type connectionStoreAdapter struct{ repo *credentials.Repo }

func (a connectionStoreAdapter) Get(
	ctx context.Context, blockID, ownerID string,
) (credentials.Connection, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return conn, fmt.Errorf("connection store get: %w", err)
	}
	return conn, nil
}

// SaveTokens —— writes back a silent oauth2 refresh (adapters.TokenRefresh → storage).
func (a connectionStoreAdapter) SaveTokens(
	ctx context.Context, blockID, ownerID string, tok *adapters.TokenRefresh,
) error {
	if err := a.repo.SaveTokens(ctx, &credentials.SaveTokensInput{
		OwnerID: ownerID, BlockID: blockID,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		ExpiresAt: tok.ExpiresAt, Scopes: tok.Scopes,
	}); err != nil {
		return fmt.Errorf("connection store save tokens: %w", err)
	}
	return nil
}

// MarkDisconnected —— on revocation, clears token/connected/active; owner must reconnect.
func (a connectionStoreAdapter) MarkDisconnected(
	ctx context.Context, blockID, ownerID string,
) error {
	if err := a.repo.ClearTokens(ctx, ownerID, blockID); err != nil {
		return fmt.Errorf("connection store mark disconnected: %w", err)
	}
	return nil
}

// smtpCredJSON —— the JSON shape inside the smtp supplier's credentials_enc.
type smtpCredJSON struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	FromName    string `json:"from_name"`
	TLS         string `json:"tls"`
}

// smtpVaultAdapter —— credentials.Repo → adapters.SMTPVault (decodes the smtp config JSON).
type smtpVaultAdapter struct{ repo *credentials.Repo }

func (a smtpVaultAdapter) Connected(
	ctx context.Context, blockID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return false, fmt.Errorf("smtp vault connected: %w", err)
	}
	return conn.Connected, nil
}

func (a smtpVaultAdapter) SMTPConfig(
	ctx context.Context, blockID, ownerID string,
) (adapters.SMTPConfig, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return adapters.SMTPConfig{}, fmt.Errorf("smtp vault config: %w", err)
	}
	var c smtpCredJSON
	if len(conn.Credentials) > 0 {
		if uerr := json.Unmarshal(conn.Credentials, &c); uerr != nil {
			return adapters.SMTPConfig{}, fmt.Errorf("decode smtp credentials: %w", uerr)
		}
	}
	port, perr := strconv.Atoi(c.Port)
	if perr != nil {
		port = 0 // parse failed → 0, fails at connect time (graceful degradation)
	}
	return adapters.SMTPConfig{
		Host: c.Host, Port: port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}, nil
}

// caldavCredJSON —— JSON shape in the caldav supplier's credentials_enc (owner url/user/pass).
type caldavCredJSON struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// caldavVaultAdapter —— credentials.Repo → adapters.CalDAVVault (decodes caldav config JSON).
type caldavVaultAdapter struct{ repo *credentials.Repo }

func (a caldavVaultAdapter) Connected(
	ctx context.Context, blockID, ownerID string,
) (bool, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return false, fmt.Errorf("caldav vault connected: %w", err)
	}
	return conn.Connected, nil
}

func (a caldavVaultAdapter) CalDAVConfig(
	ctx context.Context, blockID, ownerID string,
) (adapters.CalDAVConfig, error) {
	conn, err := a.repo.Get(ctx, ownerID, blockID)
	if err != nil {
		return adapters.CalDAVConfig{}, fmt.Errorf("caldav vault config: %w", err)
	}
	var c caldavCredJSON
	if len(conn.Credentials) > 0 {
		if uerr := json.Unmarshal(conn.Credentials, &c); uerr != nil {
			return adapters.CalDAVConfig{}, fmt.Errorf("decode caldav credentials: %w", uerr)
		}
	}
	return adapters.CalDAVConfig{URL: c.URL, Username: c.Username, Password: c.Password}, nil
}

// seamStoreAdapter —— the credentials repo, narrowed to the one question SeamStore asks.
type seamStoreAdapter struct{ repo *credentials.Repo }

func (a seamStoreAdapter) ActiveSupplierID(
	ctx context.Context, ownerID, seam string,
) (string, error) {
	conns, err := a.repo.ListBySeam(ctx, ownerID, seam)
	if err != nil {
		return "", fmt.Errorf("active supplier id: %w", err)
	}
	for i := range conns {
		if conns[i].Active {
			return conns[i].BlockID, nil
		}
	}
	return "", nil
}
