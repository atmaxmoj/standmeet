// connection_repo.go — the block connection-state repo (block_connections). Encryption
// happens at the repo boundary: creds/tokens are encrypted on write, decrypted into a Connection
// on read (plaintext lives only in memory within this package).

package credentials

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials/db"
)

// Repo — reads/writes block_connections.
type Repo struct{ pool *pgstore.Pool }

// NewRepo — composition root injects the connection pool.
func NewRepo(pool *pgstore.Pool) *Repo { return &Repo{pool: pool} }

// SaveCredentialsInput — input for saving credentials (plaintext credential JSON, encrypted
// inside the repo).
type SaveCredentialsInput struct {
	OwnerID     string
	BlockID     string
	Seam        string
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

// SaveTokensInput — input for saving OAuth tokens (plaintext, encrypted inside the
// repo).
type SaveTokensInput struct {
	ExpiresAt    time.Time
	OwnerID      string
	BlockID      string
	AccessToken  string
	RefreshToken string
	Scopes       []string
}

// tokenBlob — the shape of the encrypted JSON stored in token_enc.
type tokenBlob struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// SaveCredentials — save/overwrite a block's credentials (owner-entered app creds / apiKey /
// smtp config).
func (r *Repo) SaveCredentials(ctx context.Context, in *SaveCredentialsInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	enc, eerr := encBytes(in.Credentials, []byte(in.OwnerID))
	if eerr != nil {
		return eerr
	}
	_, qerr := db.New(r.pool).UpsertBlockCredentials(ctx, db.UpsertBlockCredentialsParams{
		OwnerID: ownerUUID, BlockID: in.BlockID,
		Seam: in.Seam, Kind: in.Kind, CredentialsEnc: enc,
		ResetConnected: in.ResetConnected,
	})
	if qerr != nil {
		return fmt.Errorf("upsert block credentials: %w", qerr)
	}
	return nil
}

// SaveTokens — save an OAuth token (first grant or refresh). First token received → connected.
func (r *Repo) SaveTokens(ctx context.Context, in *SaveTokensInput) error {
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
	_, qerr := db.New(r.pool).UpdateBlockTokens(ctx, db.UpdateBlockTokensParams{
		TokenEnc:       tokEnc,
		TokenExpiresAt: pgtype.Timestamptz{Time: in.ExpiresAt, Valid: !in.ExpiresAt.IsZero()},
		Scopes:         scopesJSON, OwnerID: ownerUUID, BlockID: in.BlockID,
	})
	if qerr != nil {
		return fmt.Errorf("update block tokens: %w", qerr)
	}
	return nil
}

// MarkConnected — a protocol supplier passed verification (no oauth dance) → mark connected.
//
// **Check the row count.** The UPDATE below hits 0 rows and returns no error when the owner has
// no row yet (credentials were never saved). Without checking the count, this function would
// return nil for a call that wrote nothing, and the caller would report `connected: true` — the
// card flips green on the spot, and the next GET /status says not connected. The row count is
// the only receipt this write has.
func (r *Repo) MarkConnected(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, derr := db.New(r.pool).MarkBlockConnected(ctx, db.MarkBlockConnectedParams{
		OwnerID: ownerUUID, BlockID: blockID,
	})
	if derr != nil {
		return fmt.Errorf("mark block connected: %w", derr)
	}
	if rows == 0 {
		return fmt.Errorf("mark block connected %q: %w", blockID, ErrNoConnection)
	}
	return nil
}

// ClearTokens — soft disconnect: wipes token+connected+active, keeps credentials.
func (r *Repo) ClearTokens(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).ClearBlockTokens(ctx,
		db.ClearBlockTokensParams{OwnerID: ownerUUID, BlockID: blockID}); derr != nil {
		return fmt.Errorf("clear block tokens: %w", derr)
	}
	return nil
}

// SetActive — set the target active and every other supplier of the same seam inactive
// (§9 slot rule).
//
// **The receipt is the name, not the row count.** This UPDATE scans the whole seam: when
// the target row doesn't exist, the rest of the seam still gets set inactive — the row
// count is greater than 0, while the actual result of "activating" is that this seam ends
// up with **zero active suppliers**. So check whether the target's block_id is in the
// returned set; if not, that's ErrNoConnection — don't report "all off" as success.
func (r *Repo) SetActive(
	ctx context.Context, ownerID, blockID, seam string,
) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	touched, derr := db.New(r.pool).SetActiveSupplier(ctx, db.SetActiveSupplierParams{
		BlockID: blockID, OwnerID: ownerUUID, Seam: seam,
	})
	if derr != nil {
		return fmt.Errorf("set active supplier: %w", derr)
	}
	if !slices.Contains(touched, blockID) {
		return fmt.Errorf("set active supplier %q: %w", blockID, ErrNoConnection)
	}
	return nil
}

// Delete — hard disconnect: deletes the row, back to a never-connected state.
func (r *Repo) Delete(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if derr := db.New(r.pool).DeleteBlockConnection(ctx,
		db.DeleteBlockConnectionParams{OwnerID: ownerUUID, BlockID: blockID}); derr != nil {
		return fmt.Errorf("delete block connection: %w", derr)
	}
	return nil
}

// Get — load and decrypt one block's connection state. No row → an empty Connection
// (never connected).
func (r *Repo) Get(
	ctx context.Context, ownerID, blockID string,
) (Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return Connection{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetBlockConnection(ctx,
		db.GetBlockConnectionParams{OwnerID: ownerUUID, BlockID: blockID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return Connection{BlockID: blockID}, nil
		}
		return Connection{}, fmt.Errorf("get block connection: %w", qerr)
	}
	return decodeConnection(&row)
}

// ListByOwner — connection state of all of an owner's blocks (admin list).
func (r *Repo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListBlockConnectionsByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list block connections: %w", qerr)
	}
	return decodeConnections(rows)
}

// ListBySeam — an owner's suppliers of one seam (slot resolution).
func (r *Repo) ListBySeam(
	ctx context.Context, ownerID, seam string,
) ([]Connection, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListBlockConnectionsBySeam(ctx,
		db.ListBlockConnectionsBySeamParams{OwnerID: ownerUUID, Seam: seam})
	if qerr != nil {
		return nil, fmt.Errorf("list block connections by seam: %w", qerr)
	}
	return decodeConnections(rows)
}

// SeamConnected — whether an owner has an active, connected supplier for a seam
// (§9 slot).
func (r *Repo) SeamConnected(
	ctx context.Context, ownerID, seam string,
) (bool, error) {
	conns, err := r.ListBySeam(ctx, ownerID, seam)
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
