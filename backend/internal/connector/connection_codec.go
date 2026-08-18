// connection_codec.go —— 连接行的**存取编码**：at-rest 加解密 + 行 → Connection。
//
// 从 connection_repo.go 拆出来的（那边到了 350 行的上限，而闸门指的方向是对的）：
// repo 管的是「怎么读写这张表」，这里管的是「一行字节怎么变成一个 Connection」——
// 两件事，各自的理由不一样。AAD 绑 owner、`ErrTampered` 该翻译成什么状态，都住这边。

package connector

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ─── 加解密 helpers ───

// aad = owner_id: 密文绑到 owner，行被调包到别的 owner 时 decrypt tamper-fail(#AAD debt)。
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

// unreadableConn —— 密钥读不出来时的那一行：身份照给（明文列），密钥留空，带上 Unreadable。
// 见 Connection.Unreadable 那段。
func unreadableConn(row *db.OwnerConnector) Connection {
	return Connection{
		ConnectorID: row.ConnectorID, Category: row.Category, Kind: row.Kind,
		Scopes:     []string{},
		Connected:  row.ConnectedAt.Valid,
		Active:     row.Active,
		Unreadable: true,
	}
}

// secrets —— 一行里那两团密文解出来之后的样子。`Unreadable` 为真时另外两格没有意义。
type secrets struct {
	Token      tokenBlob
	Creds      []byte
	Unreadable bool
}

// decodeSecrets —— 解这一行的两团密文。
//
// **只有认证失败算「读不懂」**（换了密钥 / 密文被动过 —— AES-GCM 分不出这两者）。
// JSON 解不开之类仍然是错误：那是数据坏了，不是这台实例读不懂。
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
