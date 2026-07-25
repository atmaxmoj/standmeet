// store.go —— per-plugin 隔离文档存储的 DB 操作。每个 (kind,id) 一个独立 schema,一张通用
// `records(id, collection, doc jsonb, created_at)` 表。存的是不透明 JSONB 文档 —— capstore
// **不认识**任何业务概念(没有 "booking")。消费者按 collection + JSONB 字段 filter 查。
//
// ⚠️ schema 名一律经 schemaName((kind,id)) 推 + 校验(见 schema.go);DDL 里 schema 名只能内插
// (不能 $1 参数化),所以名字必须先被 droppableRe 约束死,才能安全拼进 SQL。Drop 见其三条硬规则。

package capstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store —— 落在共享 Postgres 上的 per-plugin 文档存储。
type Store struct {
	pool *pgxpool.Pool
}

// New —— composition root 注入共享连接池。
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Provision —— 装 connector/mcp 时建它的隔离 schema + records 表(幂等)。名字非法 → 错,不建。
func (s *Store) Provision(ctx context.Context, kind Kind, id string) error {
	schema, err := schemaName(kind, id)
	if err != nil {
		return err
	}
	q := schema // 已过 droppableRe:^(connector|mcp)_[a-z0-9_]+$,内插安全
	ddl := fmt.Sprintf(
		`CREATE SCHEMA IF NOT EXISTS %[1]s;
		 CREATE TABLE IF NOT EXISTS %[1]s.records (
		   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		   collection text NOT NULL,
		   doc jsonb NOT NULL,
		   created_at timestamptz NOT NULL DEFAULT now()
		 );
		 CREATE INDEX IF NOT EXISTS records_collection_idx ON %[1]s.records (collection);
		 CREATE INDEX IF NOT EXISTS records_doc_gin_idx ON %[1]s.records USING gin (doc);`,
		q)
	if _, eerr := s.pool.Exec(ctx, ddl); eerr != nil {
		return fmt.Errorf("capstore provision %q: %w", schema, eerr)
	}
	return nil
}

// Drop —— 卸 connector/mcp 时删它的整个 schema(CASCADE,连数据)。
//
// ⚠️ 删库级操作。三条硬规则:
//  1. schema 名从 host 可信的 (kind,id) 推,绝不取自 plugin 请求(本函数签名就不收裸名字)。
//  2. 推出的名字先过 assertDroppable:非保留前缀 / 空 / 核心 schema 一律拒,绝不 DROP。
//  3. 这里是**唯一**跑 `DROP SCHEMA` 的地方;别处不许 DROP schema。
func (s *Store) Drop(ctx context.Context, kind Kind, id string) error {
	schema, err := schemaName(kind, id) // rule 1+2:推导 + 内含 assertDroppable
	if err != nil {
		return err
	}
	if aerr := assertDroppable(schema); aerr != nil {
		return aerr // 双保险:即使 schemaName 变了,删前再挡一次核心
	}
	dropSQL := fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)
	if _, eerr := s.pool.Exec(ctx, dropSQL); eerr != nil {
		return fmt.Errorf("capstore drop %q: %w", schema, eerr)
	}
	return nil
}

// Insert —— 往 (kind,id) 的 collection 里塞一份 JSONB 文档,返回记录 id。
func (s *Store) Insert(
	ctx context.Context, kind Kind, id, collection string, doc json.RawMessage,
) (string, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return "", err
	}
	var recID string
	sql := fmt.Sprintf(
		"INSERT INTO %s.records (collection, doc) VALUES ($1, $2) RETURNING id", schema)
	if qerr := s.pool.QueryRow(ctx, sql, collection, doc).Scan(&recID); qerr != nil {
		return "", fmt.Errorf("capstore insert %q/%s: %w", schema, collection, qerr)
	}
	return recID, nil
}

// Query —— 取 collection 里 doc 满足 filter(JSONB containment `@>`)的所有文档。空 filter = 全取。
func (s *Store) Query(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return nil, err
	}
	sql := fmt.Sprintf(
		"SELECT doc FROM %s.records WHERE collection = $1 AND doc @> $2 ORDER BY created_at",
		schema)
	rows, qerr := s.pool.Query(ctx, sql, collection, containment(filter))
	if qerr != nil {
		return nil, fmt.Errorf("capstore query %q/%s: %w", schema, collection, qerr)
	}
	defer rows.Close()
	return scanDocs(rows)
}

// Count —— 数 collection 里 doc 满足 filter 的文档数(配额闸用)。
func (s *Store) Count(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) (int64, error) {
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf(
		"SELECT count(*) FROM %s.records WHERE collection = $1 AND doc @> $2", schema)
	var n int64
	if cerr := s.pool.QueryRow(ctx, sql, collection, containment(filter)).Scan(&n); cerr != nil {
		return 0, fmt.Errorf("capstore count %q/%s: %w", schema, collection, cerr)
	}
	return n, nil
}

// Delete —— 删 collection 里 doc 满足 filter 的记录,返删除行数。**只删本 cap schema 内的
// 行**(schema 名经 schemaName 校验),绝非 DROP schema —— 跟 Drop 的删库级操作两码事。
// 空 filter → 拒(不允许清空整个 collection,防手滑),要清空请显式传 `{}`? 不,这里空=拒。
func (s *Store) Delete(
	ctx context.Context, kind Kind, id, collection string, filter json.RawMessage,
) (int64, error) {
	if len(filter) == 0 {
		return 0, fmt.Errorf("capstore delete %s/%s: empty filter refused", kind, collection)
	}
	schema, err := schemaName(kind, id)
	if err != nil {
		return 0, err
	}
	sql := fmt.Sprintf("DELETE FROM %s.records WHERE collection = $1 AND doc @> $2", schema)
	tag, derr := s.pool.Exec(ctx, sql, collection, filter)
	if derr != nil {
		return 0, fmt.Errorf("capstore delete %q/%s: %w", schema, collection, derr)
	}
	return tag.RowsAffected(), nil
}

// containment —— 空 filter 归一成 `{}`(matches all);否则原样(调用方保证是 JSON object)。
func containment(filter json.RawMessage) json.RawMessage {
	if len(filter) == 0 {
		return json.RawMessage(`{}`)
	}
	return filter
}

func scanDocs(rows pgx.Rows) ([]json.RawMessage, error) {
	var out []json.RawMessage
	for rows.Next() {
		var doc json.RawMessage
		if serr := rows.Scan(&doc); serr != nil {
			return nil, fmt.Errorf("capstore scan doc: %w", serr)
		}
		out = append(out, doc)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("capstore rows: %w", rerr)
	}
	return out, nil
}
