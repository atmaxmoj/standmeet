// migrate.go —— 部署时把这一版带来的 schema 改动打进库。
//
// **为什么必须由后端自己在启动时做**：`schema.sql` 只在**全新的 pg 卷**上被 postgres
// 跑一次（infra/db/Dockerfile 的注释写着这件事）。已经在跑的实例升级不走那条路 ——
// 而在这之前，`backend/db/migrations/` 里的文件**没有任何东西会去跑它们**：
// 那意味着自托管的 owner 拉个新镜像重启之后，代码要新列、库里没有，后端起不来。
// 让他自己去手打 SQL 是把系统的缺陷转嫁成他的纪律。
//
// **为什么用 go:embed 而不是读磁盘**：这样 migration 跟代码是**同一个产物**。
// 读磁盘的话它们能各自漂移 —— 而漂移出来的样子是"新代码配旧 schema"，那正是
// 后端启动不了的那一种。编进去之后，"部署了这一版"和"这一版的 schema 改动打过了"
// 是同一件事，没有第二个需要有人记得的步骤。
//
// **失败就不服务**：一个 schema 打了一半的实例，比一个起不来的实例更难查 ——
// 它会在某一条具体的查询上炸，而错误指向那条查询，不指向这里。
//
// # 账本
//
// `schema_migrations` 记下哪些跑过；没记过的就打一遍，**一条都不假设**。
//
// ⚠️ 这里曾经有一个"基线"分支：第一次见到一个库（账本表还不存在）时，把当下所有 migration
// 记成已应用而不跑 —— 理由是"新卷由 schema.sql 建、老实例之前手工打过，两种都已经包含了
// 它们的结果"。在 dev 上第一次跑就证伪了：那台实例没有账本，**而且真的缺一条**，
// 于是那一条被永久记成打过了，列还是不存在，什么都没报。而这正是每台老实例第一次
// 启动时走的分支 —— 最不该靠假设的那一个。
//
// 现在没有这个分支：所有 migration 都写成可重入的（`IF NOT EXISTS` / `DO $$` 守卫），
// 所以在一个已经是新形状的库上跑一遍等于什么都没做，而在一个缺东西的库上跑一遍就补上了。
// 唯一一条带数据回填的（`2026-08-16-cover-hue-never-chosen.sql`）重跑也安全 ——
// 它清的那种状态产品给不出来（封面只存在于 writing，而它的 WHERE 是 `genre <> 'writing'`）。

package pgstore

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/db"
)

// migrationsFS —— 编进二进制的那一份，声明在 migration 文件旁边
// （`go:embed` 够不到包目录以外，见 backend/db/embed.go）。
var migrationsFS = db.Migrations

const ledgerDDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
	name        text        PRIMARY KEY,
	applied_at  timestamptz NOT NULL DEFAULT now()
)`

// Migrate —— 把还没跑过的 migration 按文件名顺序打完。启动时调，**在开始服务之前**。
func Migrate(ctx context.Context, pool *Pool, log *slog.Logger) error {
	files, err := migrationNames()
	if err != nil {
		return err
	}
	if _, eerr := pool.Exec(ctx, ledgerDDL); eerr != nil {
		return fmt.Errorf("create migration ledger: %w", eerr)
	}
	return applyPending(ctx, pool, log, files)
}

// migrationNames —— 按文件名排序。文件名以 ISO 日期开头，所以字典序就是时间序；
// 同一天两条靠后缀区分，而那也是它们被写下的顺序。
func migrationNames() ([]string, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			out = append(out, e.Name())
		}
	}
	slices.Sort(out)
	return out, nil
}

// applyPending —— 只跑账本里没有的那些，每条一个事务。
func applyPending(ctx context.Context, pool *Pool, log *slog.Logger, files []string) error {
	done, err := appliedSet(ctx, pool)
	if err != nil {
		return err
	}
	for _, name := range files {
		if done[name] {
			continue
		}
		if aerr := applyOne(ctx, pool, name); aerr != nil {
			return aerr
		}
		log.Info("schema migration applied", "name", name)
	}
	return nil
}

func appliedSet(ctx context.Context, pool *Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT name FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read migration ledger: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if serr := rows.Scan(&name); serr != nil {
			return nil, fmt.Errorf("scan migration ledger: %w", serr)
		}
		out[name] = true
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate migration ledger: %w", rerr)
	}
	return out, nil
}

// applyOne —— 一条 migration 一个事务：**SQL 和它的账本行一起提交**。
// 分开提交的话，中间挂掉会留下"跑过但没记"或"记了但没跑"，两种都要人去猜。
func applyOne(ctx context.Context, pool *Pool, name string) error {
	body, err := migrationsFS.ReadFile("migrations/" + name)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", name, err)
	}
	tx, terr := pool.Begin(ctx)
	if terr != nil {
		return fmt.Errorf("begin migration %s: %w", name, terr)
	}
	// Rollback 的错误无处可去：提交成功时它必然返回 ErrTxClosed，而失败路径上
	// 真正要报的是**下面那个**错误，不是回滚本身。
	defer func() { _ = tx.Rollback(ctx) }() //nolint:errcheck // 见上
	if rerr := runInTx(ctx, tx, name, body); rerr != nil {
		return rerr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit migration %s: %w", name, cerr)
	}
	return nil
}

// runInTx —— 事务里的两句：migration 本体 + 它的账本行。
func runInTx(ctx context.Context, tx pgx.Tx, name string, body []byte) error {
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		return fmt.Errorf("apply migration %s: %w", name, err)
	}
	const record = `INSERT INTO schema_migrations (name) VALUES ($1)`
	if _, err := tx.Exec(ctx, record, name); err != nil {
		return fmt.Errorf("record migration %s: %w", name, err)
	}
	return nil
}
