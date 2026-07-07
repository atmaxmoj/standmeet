// Package search —— corpus 词法检索的 Meilisearch 封装(1b crawl face)。
//
// Postgres 是 source-of-truth,meili 是派生投影:写路径同步 upsert/delete(见
// usecases 的 index 传播),读走 Search。每次写操作后 WaitForTask,让"写完立刻搜得到"
// 强一致(不靠轮询,e2e 无 flake)。ACL 不在这层——这层只按 owner_id 过滤,细粒度
// path-glob ACL 由 caller(pgCorpusLister)复用既有 allowsCorpusURI 逐条过,保证与
// corpus_read 完全一致的准入。
package search

import (
	"context"
	"fmt"
	"time"

	"github.com/meilisearch/meilisearch-go"
)

const (
	corpusIndex  = "corpus_notes"
	waitInterval = 20 * time.Millisecond
	// defaultLimit —— 单次 Search 从 meili 取的上限(ACL 过滤前的候选池)。
	defaultLimit = 100
)

// Doc —— 一条 corpus note 在 meili index 里的形态。id = corpus_notes.id(raw 用 raw id)。
// searchable: title/body/tags;filterable: owner_id/genre/published。
type Doc struct {
	ID        string   `json:"id"`
	OwnerID   string   `json:"owner_id"`
	Genre     string   `json:"genre"`
	Path      string   `json:"path"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	ParentID  string   `json:"parent_id"`
	Tags      []string `json:"tags"`
	Published bool     `json:"published"`
}

// Client —— meili 封装。Search/Index/Delete 都 WaitForTask 做强一致。
type Client struct {
	mgr   meilisearch.ServiceManager
	index meilisearch.IndexManager
}

// New —— 建客户端。host/key 空 → 返 nil(caller 判 nil 走 Postgres 全文降级)。
func New(host, apiKey string) *Client {
	if host == "" {
		return nil
	}
	mgr := meilisearch.New(host, meilisearch.WithAPIKey(apiKey))
	return &Client{mgr: mgr, index: mgr.Index(corpusIndex)}
}

// EnsureIndex —— 建 index(primaryKey=id)+ 配 searchable/filterable。启动时调一次;
// 幂等(index 已存在时 CreateIndex 报错无害,忽略)。
func (c *Client) EnsureIndex(ctx context.Context) error {
	idxCfg := &meilisearch.IndexConfig{Uid: corpusIndex, PrimaryKey: "id"}
	if _, err := c.mgr.CreateIndexWithContext(ctx, idxCfg); err != nil {
		_ = err // 已存在等 → 无害
	}
	searchable := []string{"title", "body", "tags"}
	if _, err := c.index.UpdateSearchableAttributesWithContext(ctx, &searchable); err != nil {
		return fmt.Errorf("meili searchable attrs: %w", err)
	}
	//nolint:revive,modernize // meili SDK 的 UpdateFilterableAttributes 参数就是 []interface{};any 被 forbidigo 禁
	filterable := []interface{}{"owner_id", "genre", "published"}
	task, err := c.index.UpdateFilterableAttributesWithContext(ctx, &filterable)
	if err != nil {
		return fmt.Errorf("meili filterable attrs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Index —— upsert 一批 doc(primaryKey=id → 同 id 覆盖)。写完 WaitForTask。
func (c *Client) Index(ctx context.Context, docs []Doc) error {
	if len(docs) == 0 {
		return nil
	}
	pk := "id"
	opts := &meilisearch.DocumentOptions{PrimaryKey: &pk}
	task, err := c.index.AddDocumentsWithContext(ctx, docs, opts)
	if err != nil {
		return fmt.Errorf("meili add docs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Delete —— 按 id 删 doc(note 删/归档时)。
func (c *Client) Delete(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	task, err := c.index.DeleteDocumentsWithContext(ctx, ids, nil)
	if err != nil {
		return fmt.Errorf("meili delete docs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// DeleteOwner —— 清一个 owner 的全部 doc(reindex 回填前先清,防漂移残留)。
func (c *Client) DeleteOwner(ctx context.Context, ownerID string) error {
	filter := fmt.Sprintf("owner_id = %q", ownerID)
	task, err := c.index.DeleteDocumentsByFilterWithContext(ctx, filter, nil)
	if err != nil {
		return fmt.Errorf("meili delete owner: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Search —— owner 的 corpus 词法搜。只按 owner_id filter;细粒度 ACL(glob/published)
// 由 caller 逐条过。返命中 Doc(含 path/genre 供 caller 判 ACL + 建 CorpusMeta)。
func (c *Client) Search(ctx context.Context, ownerID, query string) ([]Doc, error) {
	resp, err := c.index.SearchWithContext(ctx, query, &meilisearch.SearchRequest{
		Filter: fmt.Sprintf("owner_id = %q", ownerID),
		Limit:  defaultLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("meili search: %w", err)
	}
	out := make([]Doc, 0, len(resp.Hits))
	if derr := resp.Hits.DecodeInto(&out); derr != nil {
		return nil, fmt.Errorf("meili decode hits: %w", derr)
	}
	return out, nil
}

// Healthy —— live 健康 ping。err != nil = degraded(admin 面板显示 + reconcile 判断用)。
func (c *Client) Healthy(ctx context.Context) error {
	if _, err := c.mgr.HealthWithContext(ctx); err != nil {
		return fmt.Errorf("meili health: %w", err)
	}
	return nil
}

func (c *Client) wait(ctx context.Context, taskUID int64) error {
	task, err := c.index.WaitForTaskWithContext(ctx, taskUID, waitInterval)
	if err != nil {
		return fmt.Errorf("meili wait task %d: %w", taskUID, err)
	}
	if task.Status != meilisearch.TaskStatusSucceeded {
		return fmt.Errorf("meili task %d not succeeded: %s", taskUID, task.Status)
	}
	return nil
}
