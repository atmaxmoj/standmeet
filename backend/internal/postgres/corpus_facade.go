// corpus_facade.go —— Corpus: 跨 Genre 的统一访问入口。
//
// 把 Raw / Wiki / Output / WritingRepo 4 个 repo 包到一个 facade 后面，
// 对外按 URI / Genre 寻址。集合操作返 []domain.Document（type-erased），
// caller 不再分 Genre 写对称代码。
//
// 类型本身就叫 Corpus（无 Repo 后缀） —— 它对应 corpus 集合本身。
// 调用方写 `corpus.Get(uri)` 自然，比 `corpusRepo.Get` 啰嗦少。
//
// **A.2 阶段不接进 retriever**（保持现有 retriever / route 调用不变），只立
// facade 骨架。A.3-IAM 把 retriever 内核切到 Document/Corpus + URI ACL 一起做。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// Corpus —— 统一 corpus 访问入口。
type Corpus struct {
	raw      *RawRepo
	wiki     *WikiRepo
	output   *OutputRepo
	writings *WritingRepo
}

// NewCorpus —— 构造 facade。caller (composition root) 把 4 个 repo 传进来。
func NewCorpus(
	raw *RawRepo, wiki *WikiRepo, output *OutputRepo, writings *WritingRepo,
) *Corpus {
	return &Corpus{raw: raw, wiki: wiki, output: output, writings: writings}
}

// ErrCorpusGenreNotSupported —— URI scheme 解析出非 4 个 genre 的形态。
// 通常是 caller 拼错 URI 或者新加 genre 后 facade 没扩 dispatch。
var ErrCorpusGenreNotSupported = errors.New("corpus genre not supported")

// Get —— 按 URI 拿一个 document。dispatch by Genre。
//
// URI 形态 (见 domain.ParseURI)：
//   - raw://<uuid>        → RawRepo.GetByID(ownerID, uuid)
//   - wiki://<path>       → WikiRepo 找 path 一样的 entry；fallback wiki://<id>
//   - output://<path>     → 同 wiki 逻辑
//   - writing://<slug>    → WritingRepo.GetBySlug(ownerID, slug)
//
// **注意**：这里需要 ownerID 因为所有 corpus 表都 owner-scoped；URI 本身不
// 带 owner（pre-launch single-owner instance，多 tenant 后 URI 也不会带 —
// owner scope 来自 visitor session）。
func (c *Corpus) Get(ctx context.Context, ownerID, uri string) (domain.Document, error) {
	ref, perr := domain.ParseURI(uri)
	if perr != nil {
		return nil, fmt.Errorf("parse uri: %w", perr)
	}
	getter, ok := c.getterFor(ref.Genre)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrCorpusGenreNotSupported, ref.Genre)
	}
	return getter(ctx, ownerID, ref.Path)
}

// genreGetter —— dispatch by genre 拍平到 map 里，避免 Get switch 的
// cyclomatic 上限。每个值是把对应 repo 包成统一签名的 closure。
type genreGetter func(ctx context.Context, ownerID, idOrPath string) (domain.Document, error)

// List —— 列 owner 的 documents，过滤指定 genres。空 genres → 全部 4 个 genre。
// 返 []domain.Document type-erased，caller 通过 Document.Genre() 知道每条来源。
//
// A.2 阶段 List 走 repo 现有 ListByOwner，未来要支持 limit/cursor 时改这里。
// **不接 retriever / route** —— 那是 A.3-IAM。
func (c *Corpus) List(
	ctx context.Context, ownerID string, genres []domain.DocumentGenre,
) ([]domain.Document, error) {
	want := genreSet(genres)
	out := []domain.Document{}
	if err := c.appendRawIfWanted(ctx, ownerID, want, &out); err != nil {
		return []domain.Document{}, err
	}
	if err := c.appendWikiIfWanted(ctx, ownerID, want, &out); err != nil {
		return []domain.Document{}, err
	}
	if err := c.appendOutputIfWanted(ctx, ownerID, want, &out); err != nil {
		return []domain.Document{}, err
	}
	if err := c.appendWritingsIfWanted(ctx, ownerID, want, &out); err != nil {
		return []domain.Document{}, err
	}
	return out, nil
}

// genreSet —— 空 genres 列表当"全要"；否则按列表精确过滤。
func genreSet(genres []domain.DocumentGenre) map[domain.DocumentGenre]struct{} {
	if len(genres) == 0 {
		out := make(map[domain.DocumentGenre]struct{}, len(domain.AllGenres))
		for _, g := range domain.AllGenres {
			out[g] = struct{}{}
		}
		return out
	}
	out := make(map[domain.DocumentGenre]struct{}, len(genres))
	for _, g := range genres {
		out[g] = struct{}{}
	}
	return out
}

// listLimitDefault —— Corpus.List 调底层 repo 的 limit；A.2 阶段固定 1000，
// pre-launch 数据量级远低于这个。A.3 起加 cursor pagination 取代。
const listLimitDefault = 1000

func (c *Corpus) appendRawIfWanted(
	ctx context.Context, ownerID string, want map[domain.DocumentGenre]struct{},
	out *[]domain.Document,
) error {
	if _, ok := want[domain.GenreRaw]; !ok {
		return nil
	}
	rows, err := c.raw.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list raw: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendWikiIfWanted(
	ctx context.Context, ownerID string, want map[domain.DocumentGenre]struct{},
	out *[]domain.Document,
) error {
	if _, ok := want[domain.GenreWiki]; !ok {
		return nil
	}
	rows, err := c.wiki.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list wiki: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendOutputIfWanted(
	ctx context.Context, ownerID string, want map[domain.DocumentGenre]struct{},
	out *[]domain.Document,
) error {
	if _, ok := want[domain.GenreOutput]; !ok {
		return nil
	}
	rows, err := c.output.ListByOwner(ctx, ownerID, listLimitDefault)
	if err != nil {
		return fmt.Errorf("list output: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

func (c *Corpus) appendWritingsIfWanted(
	ctx context.Context, ownerID string, want map[domain.DocumentGenre]struct{},
	out *[]domain.Document,
) error {
	if _, ok := want[domain.GenreWriting]; !ok {
		return nil
	}
	rows, err := c.writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list writings: %w", err)
	}
	for i := range rows {
		*out = append(*out, &rows[i])
	}
	return nil
}

// ─── per-genre Get dispatchers ──────────────────────────────────────

// getterFor —— Get 的 dispatch entry。返 (genreGetter, true) 或 (nil, false)
// 表示不识别。switch 长度 = AllGenres 长度，加 genre 时需要在此扩 case。
func (c *Corpus) getterFor(g domain.DocumentGenre) (genreGetter, bool) {
	switch g {
	case domain.GenreRaw:
		return c.getRaw, true
	case domain.GenreWiki:
		return c.getWiki, true
	case domain.GenreOutput:
		return c.getOutput, true
	case domain.GenreWriting:
		return c.getWriting, true
	}
	return nil, false
}

func (c *Corpus) getRaw(
	ctx context.Context, ownerID, idOrPath string,
) (domain.Document, error) {
	r, err := c.raw.GetByID(ctx, ownerID, idOrPath)
	if err != nil {
		return nil, fmt.Errorf("corpus get raw: %w", err)
	}
	return &r, nil
}

// getWiki / getOutput —— 按 id 拿。地址树派生、不稳定,cite/寻址一律按
// wiki://<id> / output://<id>(见 domain.URI),所以 ref 永远是 uuid。
func (c *Corpus) getWiki(
	ctx context.Context, ownerID, id string,
) (domain.Document, error) {
	w, err := c.wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("corpus get wiki: %w", err)
	}
	return &w, nil
}

func (c *Corpus) getOutput(
	ctx context.Context, ownerID, id string,
) (domain.Document, error) {
	o, err := c.output.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("corpus get output: %w", err)
	}
	return &o, nil
}

func (c *Corpus) getWriting(
	ctx context.Context, ownerID, slug string,
) (domain.Document, error) {
	w, err := c.writings.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return nil, fmt.Errorf("corpus get writing: %w", err)
	}
	return &w, nil
}
