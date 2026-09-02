// connection_codec.go — the **storage encoding** for connection rows: at-rest
// encrypt/decrypt + row → Connection.
//
// Split out of connection_repo.go (which had hit the 350-line ceiling, and the gate
// was pointing the right way): repo owns "how to read/write this table", this file
// owns "how a row of bytes becomes a Connection" — two different concerns, each with
// its own reasoning. AAD binding to owner, and what status `ErrTampered` should
// translate into, both live here.

package connector

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
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
func unreadableConn(row *db.OwnerConnector) Connection {
	return Connection{
		ConnectorID: row.ConnectorID, Category: row.Category, Kind: row.Kind,
		Title:      row.Title,
		Scopes:     []string{},
		Connected:  row.ConnectedAt.Valid,
		Active:     row.Active,
		Unreadable: true,
	}
}

// secrets — what a row's two ciphertext blobs look like once decoded. When
// `Unreadable` is true the other two fields carry no meaning.
type secrets struct {
	Token      tokenBlob
	Creds      []byte
	Unreadable bool
}

// decodeSecrets — decode the two ciphertext blobs on this row.
//
// **Only an auth failure counts as "can't be read"** (key rotated / ciphertext
// tampered — AES-GCM can't tell these two apart). A JSON decode failure and the like
// still count as real errors: that means the data is corrupt, not that this instance
// merely can't read it.
func decodeSecrets(row *db.OwnerConnector, aad []byte) (secrets, error) {
	creds, err := decBytes(row.CredentialsEnc, aad)
	if errors.Is(err, cryptobox.ErrTampered) {
		return secrets{Unreadable: true}, nil
	}
	if err != nil {
		return secrets{}, err
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

func decodeConnectorConn(row *db.OwnerConnector) (Connection, error) {
	aad := []byte(pgstore.FormatUUID(row.OwnerID))
	sec, err := decodeSecrets(row, aad)
	if err != nil {
		return Connection{}, err
	}
	if sec.Unreadable {
		return unreadableConn(row), nil
	}
	creds, tok := sec.Creds, sec.Token
	scopes, serr := decodeScopes(row.Scopes)
	if serr != nil {
		return Connection{}, serr
	}
	conn := Connection{
		ConnectorID: row.ConnectorID, Category: row.Category, Kind: row.Kind,
		Title:       row.Title,
		AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
		Credentials: creds, Scopes: scopes,
		Connected: row.ConnectedAt.Valid, Active: row.Active,
	}
	if row.TokenExpiresAt.Valid {
		t := row.TokenExpiresAt.Time
		conn.TokenExpiresAt = &t
	}
	return conn, nil
}

func decodeConnectorConns(
	rows []db.OwnerConnector) ([]Connection, error,
) {
	out := make([]Connection, 0, len(rows))
	for i := range rows {
		conn, err := decodeConnectorConn(&rows[i])
		if err != nil {
			return nil, err
		}
		out = append(out, conn)
	}
	return out, nil
}
