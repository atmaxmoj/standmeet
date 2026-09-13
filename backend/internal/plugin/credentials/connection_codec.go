// connection_codec.go — the **storage encoding** for connection rows: at-rest
// encrypt/decrypt + row → Connection.
//
// Split out of connection_repo.go (which had hit the 350-line ceiling, and the gate
// was pointing the right way): repo owns "how to read/write this table", this file
// owns "how a row of bytes becomes a Connection" — two different concerns, each with
// its own reasoning. AAD binding to owner, and what status `ErrTampered` should
// translate into, both live here.

package credentials

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials/db"
)

// ─── encrypt/decrypt helpers ───

// aad = owner_id: ciphertext is bound to the owner, so if a row gets swapped onto a
// different owner, decrypt tamper-fails (#AAD debt).
func encBytes(b, aad []byte) ([]byte, error) {
	if len(b) == 0 {
		return []byte{}, nil
	}
	out, err := cryptobox.Encrypt(b, aad)
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}
	return out, nil
}

func decBytes(b, aad []byte) ([]byte, error) {
	if len(b) == 0 {
		return []byte{}, nil
	}
	out, err := cryptobox.Decrypt(b, aad)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}
	return out, nil
}

func encryptToken(access, refresh string, aad []byte) ([]byte, error) {
	raw, err := json.Marshal(tokenBlob{AccessToken: access, RefreshToken: refresh})
	if err != nil {
		return nil, fmt.Errorf("marshal token: %w", err)
	}
	return encBytes(raw, aad)
}

func decodeToken(enc, aad []byte) (tokenBlob, error) {
	var tb tokenBlob
	raw, err := decBytes(enc, aad)
	if err != nil {
		return tb, err
	}
	if len(raw) == 0 {
		return tb, nil
	}
	if uerr := json.Unmarshal(raw, &tb); uerr != nil {
		return tb, fmt.Errorf("decode token: %w", uerr)
	}
	return tb, nil
}

func decodeScopes(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var scopes []string
	if err := json.Unmarshal(raw, &scopes); err != nil {
		return nil, fmt.Errorf("decode scopes: %w", err)
	}
	return scopes, nil
}

// unreadableConn — the row shape for when the secrets can't be decoded: identity is
// still given (plaintext columns), secrets are left blank, Unreadable is set.
// See the Connection.Unreadable comment.
func unreadableConn(row *db.BlockConnection) Connection {
	return Connection{
		BlockID: row.BlockID, Seam: row.Seam, Kind: row.Kind,
		Title:      row.Title,
		Scopes:     []string{},
		Connected:  row.ConnectedAt.Valid,
		Active:     row.Active,
		Unreadable: true,
	}
}

// secrets — what a row's secrets look like once decoded. When `Unreadable` is true the other two
// fields carry no meaning.
type secrets struct {
	Token      tokenBlob
	Creds      []byte
	Unreadable bool
}

// errCredsUnreadable — the legacy credential blob failed to decrypt (key rotated / tampered —
// AES-GCM can't tell these apart). A sentinel so resolveCreds stays a two-result function.
var errCredsUnreadable = errors.New("credentials unreadable")

// resolveCreds — the credential VALUE for one row, from the credential-manager (credmgr) first,
// falling back to the legacy block_connections.credentials_enc column. A legacy value found this
// way self-heals: it is written into credmgr so future reads hit the new source. Returns
// errCredsUnreadable when the legacy blob won't decrypt.
func (r *Repo) resolveCreds(
	ctx context.Context, ownerID, blockID string, legacyEnc, aad []byte,
) ([]byte, error) {
	v, gerr := r.secrets.Get(ctx, ownerID, blockID)
	// A credmgr value that won't decrypt (the instance key rotated) is "unreadable", not a hard
	// error — same as a rotated legacy blob: the owner is asked to reconnect, and one unreadable
	// supplier must not sink the whole list.
	if errors.Is(gerr, cryptobox.ErrTampered) {
		return nil, errCredsUnreadable
	}
	if gerr != nil {
		return nil, fmt.Errorf("read credentials: %w", gerr)
	}
	if v != "" {
		return []byte(v), nil
	}
	return r.legacyCreds(ctx, ownerID, blockID, legacyEnc, aad)
}

// legacyCreds — the fallback: decrypt the row's legacy credentials_enc, and self-heal it into
// credmgr so the next read hits the new source. errCredsUnreadable on an auth failure.
func (r *Repo) legacyCreds(
	ctx context.Context, ownerID, blockID string, legacyEnc, aad []byte,
) ([]byte, error) {
	legacy, derr := decBytes(legacyEnc, aad)
	if errors.Is(derr, cryptobox.ErrTampered) {
		return nil, errCredsUnreadable
	}
	if derr != nil {
		return nil, derr
	}
	if len(legacy) > 0 {
		if serr := r.secrets.Set(ctx, ownerID, blockID, string(legacy)); serr != nil {
			slog.Default().Warn("credential self-heal failed", "block", blockID, "err", serr)
		}
	}
	return legacy, nil
}

// decodeRowSecrets — creds (credmgr/legacy) + tokens (row) for one row. Only an auth failure
// counts as "can't be read" (key rotated / tampered); a JSON decode failure is a real error.
func (r *Repo) decodeRowSecrets(
	ctx context.Context, row *db.BlockConnection, aad []byte,
) (secrets, error) {
	owner := pgstore.FormatUUID(row.OwnerID)
	creds, cerr := r.resolveCreds(ctx, owner, row.BlockID, row.CredentialsEnc, aad)
	if errors.Is(cerr, errCredsUnreadable) {
		return secrets{Unreadable: true}, nil
	}
	if cerr != nil {
		return secrets{}, cerr
	}
	tok, terr := decodeToken(row.TokenEnc, aad)
	if errors.Is(terr, cryptobox.ErrTampered) {
		return secrets{Unreadable: true}, nil
	}
	if terr != nil {
		return secrets{}, terr
	}
	return secrets{Creds: creds, Token: tok}, nil
}

func (r *Repo) decodeConnection(ctx context.Context, row *db.BlockConnection) (Connection, error) {
	aad := []byte(pgstore.FormatUUID(row.OwnerID))
	sec, err := r.decodeRowSecrets(ctx, row, aad)
	if err != nil {
		return Connection{}, err
	}
	if sec.Unreadable {
		return unreadableConn(row), nil
	}
	scopes, serr := decodeScopes(row.Scopes)
	if serr != nil {
		return Connection{}, serr
	}
	conn := Connection{
		BlockID: row.BlockID, Seam: row.Seam, Kind: row.Kind,
		Title:       row.Title,
		AccessToken: sec.Token.AccessToken, RefreshToken: sec.Token.RefreshToken,
		Credentials: sec.Creds, Scopes: scopes,
		Connected: row.ConnectedAt.Valid, Active: row.Active,
	}
	if row.TokenExpiresAt.Valid {
		t := row.TokenExpiresAt.Time
		conn.TokenExpiresAt = &t
	}
	return conn, nil
}

func (r *Repo) decodeConnections(
	ctx context.Context, rows []db.BlockConnection,
) ([]Connection, error) {
	out := make([]Connection, 0, len(rows))
	for i := range rows {
		conn, err := r.decodeConnection(ctx, &rows[i])
		if err != nil {
			return nil, err
		}
		out = append(out, conn)
	}
	return out, nil
}
