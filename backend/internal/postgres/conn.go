// Package postgres 包装 pgx pool 连接管理。Repository 实现也在这个包里
// （M2 起开始写），但本文件只暴露连接 + 探活。
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool 是 pgx pool 的别名，便于 mock 替换。
type Pool = pgxpool.Pool

const (
	poolMaxConns       = 20
	poolMinConns       = 2
	poolMaxConnLife    = 30 * time.Minute
	poolMaxConnIdle    = 5 * time.Minute
	connectPingTimeout = 5 * time.Second
	pingTimeout        = 2 * time.Second
)

// Connect 建立 pool。connStr 通常来自 config.DatabaseURL。
// 调用方负责在退出时 pool.Close()。
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
