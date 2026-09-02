// connectors.go — #155 unified connector connection-state repo (owner_connectors). Encryption
// happens at the repo boundary: creds/tokens are encrypted on write, decrypted into a Connection
// on read (plaintext lives only in memory within the connector layer). Replaces the gcal/smtp-
// specific repos in calendar.go/mail_connectors.go (delete those once the swap lands).

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Repo — reads/writes owner_connectors.
type Repo struct{ pool *pgstore.Pool }

// NewRepo — composition root injects the connection pool.
func NewRepo(pool *pgstore.Pool) *Repo { return &Repo{pool: pool} }

// SaveConnectorCredsInput — input for saving credentials (plaintext credential JSON, encrypted
// inside the repo).
type SaveConnectorCredsInput struct {
	OwnerID     string
	ConnectorID string
	Category    string
	Kind        string
	Credentials []byte
	// ResetConnected — set true only when the credentials **actually changed**: D-5 requires
	// re-verification after an identity/credential change, and that rule's premise is "it
	// changed". The panel saves credentials once every time Connect is clicked, so clearing
	// this unconditionally would show a good connection as "not connected" before
	// authorization even starts (F-C-30). The decision is made at the usecase layer; the repo
	// just carries it out.
	ResetConnected bool
}

// SaveConnectorTokensInput — input for saving OAuth tokens (plaintext, encrypted inside the
// repo).
type SaveConnectorTokensInput struct {
	ExpiresAt    time.Time
	OwnerID      string
	ConnectorID  string
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// tokenBlob — the shape of the encrypted JSON stored in token_enc.
type tokenBlob struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// SaveCredentials — save/overwrite connector credentials (owner-entered app creds / apiKey /
// smtp config).
func (r *Repo) SaveCredentials(ctx context.Context, in *SaveConnectorCredsInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	enc, eerr := encBytes(in.Credentials, []byte(in.OwnerID))
	if eerr != nil {
		return eerr
	}
	_, qerr := db.New(r.pool).UpsertConnectorCredentials(ctx, db.UpsertConnectorCredentialsParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID,
		Category: in.Category, Kind: in.Kind, CredentialsEnc: enc,
		ResetConnected: in.ResetConnected,
	})
	if qerr != nil {
		return fmt.Errorf("upsert connector credentials: %w", qerr)
	}
	return nil
}

// SaveTokens — save an OAuth token (first grant or refresh). First token received → connected.
func (r *Repo) SaveTokens(ctx context.Context, in *SaveConnectorTokensInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	tokEnc, terr := encryptToken(in.AccessToken, in.RefreshToken, []byte(in.OwnerID))
	if terr != nil {
		return terr
	}
	scopesJSON, serr := json.Marshal(in.Scopes)
	if serr != nil {
		return fmt.Errorf("marshal scopes: %w", serr)
	}
	_, qerr := db.New(r.pool).UpdateConnectorTokens(ctx, db.UpdateConnectorTokensParams{
		TokenEnc:       tokEnc,
		TokenExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
		Scopes:         scopesJSON, OwnerID: ownerUUID, ConnectorID: in.ConnectorID,
	})
	if qerr != nil {
		return fmt.Errorf("update connector tokens: %w", qerr)
	}
	return nil
}

// MarkConnected — a protocol connector passed verification (no oauth dance) → mark connected.
//
// **Check the row count.** The UPDATE below hits 0 rows and returns no error when the owner has
// no row yet (credentials were never saved). Without checking the count, this function would
// return nil for a call that wrote nothing, and the caller would report `connected: true` — the
// card flips green on the spot, and the next GET /status says not connected. The row count is
// the only receipt this write has.
func (r *Repo) MarkConnected(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, derr := db.New(r.pool).MarkConnectorConnected(ctx, db.MarkConnectorConnectedParams{
		OwnerID: ownerUUID, ConnectorID: connectorID,
	})
	if derr != nil {
		return fmt.Errorf("mark connector connected: %w", derr)
	}
	if rows == 0 {
		return fmt.Errorf("mark connector connected %q: %w", connectorID, ErrNoConnection)
	}
	return nil
}

// ClearTokens — soft disconnect: wipes token+connected+active, keeps credentials.
func (r *Repo) ClearTokens(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).ClearConnectorTokens(ctx,
		db.ClearConnectorTokensParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("clear connector tokens: %w", derr)
	}
	return nil
}

// SetActive — set the target active and every other connector in the same category inactive
// (§9 slot rule).
//
// **The receipt is the name, not the row count.** This UPDATE scans the whole category: when
// the target row doesn't exist, the rest of the category still gets set inactive — the row
// count is greater than 0, while the actual result of "activating" is that this category ends
// up with **zero active connectors**. So check whether the target's connector_id is in the
// returned set; if not, that's ErrNoConnection — don't report "all off" as success.
func (r *Repo) SetActive(
	ctx context.Context, ownerID, connectorID, category string,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	touched, derr := db.New(r.pool).SetActiveConnector(ctx, db.SetActiveConnectorParams{
		ConnectorID: connectorID, OwnerID: ownerUUID, Category: category,
	})
	if derr != nil {
		return fmt.Errorf("set active connector: %w", derr)
	}
	if !slices.Contains(touched, connectorID) {
		return fmt.Errorf("set active connector %q: %w", connectorID, ErrNoConnection)
	}
	return nil
}

// Delete — hard disconnect: deletes the row, back to a never-connected state.
func (r *Repo) Delete(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).DeleteConnector(ctx,
		db.DeleteConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID}); derr != nil {
		return fmt.Errorf("delete connector: %w", derr)
	}
	return nil
}

// Get — load and decrypt one connector's connection state. No row → empty ConnectorConnection
// (never connected).
func (r *Repo) Get(
	ctx context.Context, ownerID, connectorID string,
) (Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return Connection{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetConnector(ctx,
		db.GetConnectorParams{OwnerID: ownerUUID, ConnectorID: connectorID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Connection{ConnectorID: connectorID}, nil
		}
		return Connection{}, fmt.Errorf("get connector: %w", qerr)
	}
	return decodeConnectorConn(&row)
}

// ListByOwner — connection state of all of an owner's connectors (admin list).
func (r *Repo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListConnectorsByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list connectors: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// ListByCategory — an owner's connectors in one category (slot resolution).
func (r *Repo) ListByCategory(
	ctx context.Context, ownerID, category string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListConnectorsByCategory(ctx,
		db.ListConnectorsByCategoryParams{OwnerID: ownerUUID, Category: category})
	if qerr != nil {
		return nil, fmt.Errorf("list connectors by category: %w", qerr)
	}
	return decodeConnectorConns(rows)
}

// CategoryConnected — whether an owner has an active, connected connector in a category
// (§9 slot).
func (r *Repo) CategoryConnected(
	ctx context.Context, ownerID, category string,
) (bool, error) {
	conns, err := r.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return false, err
	}
	for i := range conns {
		if conns[i].Active && conns[i].Connected {
			return true, nil
		}
	}
	return false, nil
}
