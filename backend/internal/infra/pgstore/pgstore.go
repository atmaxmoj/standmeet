// Package pgstore —— 共享 DB store 原语:pgx pool 别名、最小 DBTX 接口、uuid 转换、
// owner-id 解析错误前缀、边界加解密。各领域模块的 repo 用它 + 自己的 <domain>/db(sqlc)持久层。
// (对应结构设计里 domain-less 的 "pgxpool" 共享 infra:只留链接一类真基建,不含任何领域 DAO。)
package pgstore

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool —— pgx pool 别名(便于 mock 替换)。
type Pool = pgxpool.Pool

// DBTX —— 最小 query 接口(pgxpool.Pool / pgx.Tx 都满足);与各领域 sqlc 生成包的 DBTX
// 结构一致,故可互相传递。基建只持这条 DB 原语,不再依赖任一领域的生成 DAO。
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

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

// 这里以前有 MaybeEncrypt / DecryptOrEmpty 一对通用 helper —— **零调用方**,
// 从建好起就没人用过。删掉不只是清理:DecryptOrEmpty 让 internal/infra 这个
// 谁都能 import 的底座上挂着一个开封口,而底座恰恰是最不该有开封口的地方。

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

// UUIDStrOrEmpty —— 可空 uuid → 字符串,NULL → 空串。
// 用在"没指 = 空串"的领域字段上(可空外键那一类:NULL 和"指着的那条被删了"是同一件事)。
func UUIDStrOrEmpty(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return FormatUUID(u)
}

// UUIDOrNull —— 字符串 → 可空 uuid。空串(或不合法)= NULL,不是错误:调用方给的是
// "没指着谁"这件事,可空外键收的正是它。
func UUIDOrNull(s string) pgtype.UUID {
	if s == "" {
		return pgtype.UUID{}
	}
	u, err := ParseUUID(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return u
}

// —— pgx pool 连接管理（从退役的 internal/postgres/conn.go 迁入）——

const (
	poolMaxConns       = 20
	poolMinConns       = 2
	poolMaxConnLife    = 30 * time.Minute
	poolMaxConnIdle    = 5 * time.Minute
	connectPingTimeout = 5 * time.Second
	pingTimeout        = 2 * time.Second
)

// Connect 建立 pool。connStr 通常来自 config.DatabaseURL。调用方负责退出时 pool.Close()。
func Connect(ctx context.Context, connStr string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("parse pg dsn: %w", err)
	}
	cfg.MaxConns = poolMaxConns
	cfg.MinConns = poolMinConns
	cfg.MaxConnLifetime = poolMaxConnLife
	cfg.MaxConnIdleTime = poolMaxConnIdle
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pg: %w", err)
	}
	// fail-fast 验证一次连接，避免 server "起来了" 但其实连不上 DB。
	pingCtx, cancel := context.WithTimeout(ctx, connectPingTimeout)
	defer cancel()
	if pingErr := pool.Ping(pingCtx); pingErr != nil {
		pool.Close()
		return nil, fmt.Errorf("ping pg: %w", pingErr)
	}
	return pool, nil
}

// Ping 用最短路径校验 pool 还活着，给 healthz 用。
func Ping(ctx context.Context, pool *Pool) error {
	pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		return fmt.Errorf("pg ping: %w", err)
	}
	return nil
}
