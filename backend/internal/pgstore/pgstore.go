// Package pgstore —— 共享 DB store 原语:pgx pool 别名、sqlc DBTX 别名、uuid 转换、
// owner-id 解析错误前缀、边界加解密。各领域模块的 repo 用它 + dbq 自持久层,不依赖 postgres 包。
// (对应结构设计里 domain-less 的 "pgxpool" 共享 infra;postgres god-package 溶解后这是唯一的 DB 原语家。)
package pgstore

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// Pool —— pgx pool 别名(便于 mock 替换)。
type Pool = pgxpool.Pool

// DBTX —— sqlc 生成的最小 query 接口(pgxpool.Pool / pgx.Tx 都满足)。
type DBTX = dbq.DBTX

// ErrParseOwnerIDPrefix —— owner_id 字符串解析失败的统一 wrap 前缀。
const ErrParseOwnerIDPrefix = "parse owner id: %w"

const (
	uuidStringLen = 36
	uuidDash1     = 8
	uuidDash2     = 13
	uuidDash3     = 18
	uuidDash4     = 23
)

// ParseUUID —— RFC 4122 字符串 → pgtype.UUID。无效输入返 error。
func ParseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, fmt.Errorf("scan uuid: %w", err)
	}
	return u, nil
}

// IsUUID —— s 是否合法 RFC 4122 uuid 串(slug 永不误判为 true)。
func IsUUID(s string) bool {
	var u pgtype.UUID
	return u.Scan(s) == nil
}

// FormatUUID —— pgtype.UUID → RFC 4122 字符串。无效 → ""。
func FormatUUID(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	src := u.Bytes[:]
	buf := make([]byte, uuidStringLen)
	hex.Encode(buf[0:uuidDash1], src[0:4])
	buf[uuidDash1] = '-'
	hex.Encode(buf[uuidDash1+1:uuidDash2], src[4:6])
	buf[uuidDash2] = '-'
	hex.Encode(buf[uuidDash2+1:uuidDash3], src[6:8])
	buf[uuidDash3] = '-'
	hex.Encode(buf[uuidDash3+1:uuidDash4], src[8:10])
	buf[uuidDash4] = '-'
	hex.Encode(buf[uuidDash4+1:uuidStringLen], src[10:16])
	return strings.ToLower(string(buf))
}

// MaybeEncrypt —— 非空 plaintext 用 cryptobox(AES-256-GCM)加密;空 → 空 blob。
func MaybeEncrypt(plain string, aad []byte) ([]byte, error) {
	if plain == "" {
		return []byte{}, nil
	}
	out, err := cryptobox.Encrypt([]byte(plain), aad)
	if err != nil {
		return []byte{}, fmt.Errorf("encrypt: %w", err)
	}
	return out, nil
}

// DecryptOrEmpty —— 非空 blob 解密回 plaintext;空 blob → ""。
func DecryptOrEmpty(blob, aad []byte) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	out, err := cryptobox.Decrypt(blob, aad)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(out), nil
}

// OptTime —— pgtype.Timestamptz → *time.Time(invalid → nil)。
func OptTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	tt := t.Time
	return &tt
}

// ToTimestamptz —— *time.Time → pgtype.Timestamptz(nil → invalid)。
func ToTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// uniqueViolationSQLState —— Postgres unique_violation 的 SQLSTATE。
const uniqueViolationSQLState = "23505"

// UniqueViolation —— err 是不是唯一约束冲突;是则返约束名 + true。
func UniqueViolation(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolationSQLState {
		return pgErr.ConstraintName, true
	}
	return "", false
}

// NilSafeStrings —— nil slice → 非 nil 空 slice(JSON/DB 边界防 null)。
func NilSafeStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// UUIDStrings —— []pgtype.UUID → []string(逐个 FormatUUID)。
func UUIDStrings(us []pgtype.UUID) []string {
	out := make([]string, 0, len(us))
	for _, u := range us {
		out = append(out, FormatUUID(u))
	}
	return out
}

// ParseOptionalUUID —— nil/空串 → 零值 UUID（无错）；否则解析。repo 层把可空外键
// 转 pgtype.UUID 的通用 helper。
func ParseOptionalUUID(s *string) (pgtype.UUID, error) {
	if s == nil || *s == "" {
		return pgtype.UUID{}, nil
	}
	return ParseUUID(*s)
}

// ParseUUIDArray —— 一批 id 串 → []pgtype.UUID；任一失败即返错。
func ParseUUIDArray(ids []string) ([]pgtype.UUID, error) {
	out := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		u, err := ParseUUID(id)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}

// FormatUUIDList —— []pgtype.UUID → []string。
func FormatUUIDList(uu []pgtype.UUID) []string {
	out := make([]string, 0, len(uu))
	for _, u := range uu {
		out = append(out, FormatUUID(u))
	}
	return out
}

// OptUUIDStr —— 可空 UUID → *string（invalid → nil）。repo 层把 nullable 外键
// 转前端可省略字段的通用 helper。
func OptUUIDStr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := FormatUUID(u)
	return &s
}
