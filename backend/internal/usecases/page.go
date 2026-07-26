// page.go —— public page 内容查询 usecase。
// GetPublicPage：单 owner instance → 拿 sole owner → page_content。owner 不存在
// → ErrOwnerNotFound（pre-claim）；page_content 行不存在 → 返默认值（让访客
// 打开新建 instance 也能看到一份缺省内容，而不是空页）。
// 默认值来自设计稿 docs/design/project/page-content.js。
//
// 删 handle URL 之后：所有"按 handle 反查 owner"路径下沉成"拿 sole owner"，
// 公开页 / wiki landing / custom page 等全部走 LoadSoleOwner。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// PageDeps —— page usecase 所需。PageContent 是 Owner aggregate 的内容
// 切面，所以 GetPageContent / UpsertPageContent 都是 OwnerRepo 方法；
// usecase 这里不再持有独立 PageRepo。Wiki 给 pin join 用(GetPublicPage);
// 只调 LoadSoleOwner 的 caller 可不填。
type PageDeps struct {
	Owners *owner.Repo
	Wiki   *corpus.WikiRepo
}

// PublicPageView —— GET /api/v1/page 返回的形状。
// Owner 部分挑公开字段，content 是渲染视图(insights/projects 已 join 成卡)，
// 时间戳是页面 last-updated。
type PublicPageView struct {
	Owner   PublicOwnerView `json:"owner"`
	Content PageContentView `json:"content"`
}

// PageContentView —— page_content 的渲染视图:存储形的 pin 列表(wiki id)
// join 成 PagePinCard(title + excerpt + path)。AI(page.get)和访客看同一形。
// 字段顺序按 govet fieldalignment。
type PageContentView struct {
	UpdatedAt    time.Time           `json:"updated_at"`
	Where        owner.PageWhere     `json:"where"`
	Contact      owner.PageContact   `json:"contact"`
	OwnerID      string              `json:"owner_id"`
	HeroProse    string              `json:"hero_prose"`
	HeroExamples []string            `json:"hero_examples"`
	Insights     []owner.PagePinCard `json:"insights"`
	Projects     []owner.PagePinCard `json:"projects"`
}

// PublicOwnerView —— 暴露给访客的 owner 切片（不含 email / password_hash）。
// handle 字段保留 —— admin UI / 显示用，但**不再决定路由**。
type PublicOwnerView struct {
	Handle   string `json:"handle"`
	FullName string `json:"full_name"`
	Location string `json:"location"`
}

// LoadSoleOwner —— v1 单 owner instance：取唯一的 owner。pre-claim
// （未 claim） → ErrOwnerNotFound。app 根路径 / SEO / public routes 都走这条。
func LoadSoleOwner(ctx context.Context, deps PageDeps) (owner.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return owner.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return owner.Owner{}, owner.ErrOwnerNotFound
	}
	sole, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return owner.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return sole, nil
}

// SetupTokenIssuer —— EnsureUnclaimedSetupToken 用的最小接口（包裹
// session.IssueSetupToken + InstanceRepo）。让 usecase 层不直接 import
// session 包 → routes 层。
type SetupTokenIssuer interface {
	// HasLiveTokenHash —— DB 里是否还有有效的 setup_token_hash。claim
	// 成功后 TryClaimInstance 会把它清成 NULL；e2e flip is_claimed=false
	// 时不动 hash，所以这个 check 区分"刚启动 / 还没人 claim 过"和"claim 过
	// 但被回退"两种 unclaimed 状态。
	HasLiveTokenHash(ctx context.Context) (bool, error)
	// IssueAndStore —— 生成新 plaintext + 写 DB hash + 写 holder。
	IssueAndStore(ctx context.Context) error
	// HolderPlaintext —— 当前 holder 持有的 plaintext。
	HolderPlaintext() string
}

// EnsureUnclaimedSetupToken —— /api/v1/instance handler 在 unclaimed 期调它，
// 拿回一个一定可用的 setup_token plaintext（让前端能 redirect 到 /setup?t=...）。
//
// 决策树：
//   - DB 里 setup_token_hash 还在 + holder 有值 → 直接返 holder.Plaintext()
//   - DB hash 为 NULL（claim 后清掉了 / e2e 回退 is_claimed=false）→ 重新
//     IssueAndStore，holder + DB 同步更新成新 token，返新 plaintext
//   - DB hash 在 + holder 为空（server restart 之类）→ 同上重新 issue
//
// 这是 production-meaningful self-heal：任何让 unclaimed instance 失去 live
// token 的情况都自愈，不靠 e2e-only 路径。
func EnsureUnclaimedSetupToken(ctx context.Context, issuer SetupTokenIssuer) (string, error) {
	hasHash, err := issuer.HasLiveTokenHash(ctx)
	if err != nil {
		return "", fmt.Errorf("check setup token hash: %w", err)
	}
	plaintext := issuer.HolderPlaintext()
	if hasHash && plaintext != "" {
		return plaintext, nil
	}
	if ierr := issuer.IssueAndStore(ctx); ierr != nil {
		return "", fmt.Errorf("issue setup token: %w", ierr)
	}
	return issuer.HolderPlaintext(), nil
}

// GetPublicPage —— sole owner → page_content(缺失填默认)→ pin join 成渲染视图。
func GetPublicPage(ctx context.Context, deps PageDeps) (PublicPageView, error) {
	soleOwner, err := LoadSoleOwner(ctx, deps)
	if err != nil {
		if errors.Is(err, owner.ErrOwnerNotFound) {
			return PublicPageView{}, owner.ErrOwnerNotFound
		}
		return PublicPageView{}, err
	}
	content, err := loadPageContentOrDefault(ctx, deps, soleOwner.ID)
	if err != nil {
		return PublicPageView{}, err
	}
	view, err := BuildPageContentView(ctx, deps, soleOwner.ID, &content)
	if err != nil {
		return PublicPageView{}, err
	}
	return PublicPageView{
		Owner: PublicOwnerView{
			Handle:   soleOwner.Handle,
			FullName: soleOwner.FullName,
			Location: soleOwner.Location,
		},
		Content: view,
	}, nil
}

// BuildPageContentView —— 存储形 → 渲染视图(pin join)。page.get MCP 也走这条,
// AI 看到的和访客一致。
func BuildPageContentView(
	ctx context.Context, deps PageDeps, ownerID string, content *owner.PageContent,
) (PageContentView, error) {
	join, err := LoadPinJoin(ctx, PagePinDeps(deps), ownerID, content)
	if err != nil {
		return PageContentView{}, err
	}
	return PageContentView{
		UpdatedAt:    content.UpdatedAt,
		Where:        content.Where,
		Contact:      content.Contact,
		OwnerID:      content.OwnerID,
		HeroProse:    content.HeroProse,
		HeroExamples: content.HeroExamples,
		Insights:     ResolvePinCards(join.Cards, join.Paths, content.Insights),
		Projects:     ResolvePinCards(join.Cards, join.Paths, content.Projects),
	}, nil
}

func loadPageContentOrDefault(
	ctx context.Context, deps PageDeps, ownerID string,
) (owner.PageContent, error) {
	content, err := deps.Owners.GetPageContent(ctx, ownerID)
	if errors.Is(err, owner.ErrPageNotFound) {
		return buildDefaultPage(ownerID), nil
	}
	if err != nil {
		return owner.PageContent{}, fmt.Errorf("get page content: %w", err)
	}
	return content, nil
}

// DefaultPageContent —— page-content.js 里的默认 hero / insights / projects /
// where / contact。新 instance 第一次被访问时返这个；admin 第一次保存就
// 覆盖。
func DefaultPageContent(ownerID string) owner.PageContent {
	return buildDefaultPage(ownerID)
}

func buildDefaultPage(ownerID string) owner.PageContent {
	return owner.PageContent{
		OwnerID:      ownerID,
		HeroProse:    defaultHeroProse,
		HeroExamples: defaultHeroExamples(),
		Insights:     defaultInsights(),
		Projects:     defaultProjects(),
		Where:        defaultWhere(),
		Contact:      defaultContact(),
	}
}

// 默认 page content 是 placeholder，新 instance 第一次访问看到的占位文案。
// owner 在 /admin/page 改任意 section 后就持久化覆盖。所有内容请保持泛化
// 中立——这段会同时出现在所有自托管实例上，不要写真实个人信息。

// defaultHeroProse —— EMPTY on purpose (F-A-21). The hero prose is **visitor-facing** page content;
// its old default ("This is your StandMeet page. Open /admin/page to introduce yourself…") spoke to
// the OWNER, telling them to open an admin route — nonsensical/leaky to a visitor (esp. one who
// entered with a code and can't reach /admin). An unconfigured page shows no hero prose (visitors
// see nothing rather than owner onboarding copy); the owner's "set this up" nudge lives in the
// /admin/page editor, not on the public surface. og:description falls back to a neutral default
// when this is empty.
const defaultHeroProse = ""

func defaultHeroExamples() []string {
	return []string{
		"What are you working on?",
		"How do you spend your time?",
		"What have you written lately?",
	}
}

// defaultInsights / defaultProjects 默认空 pin 列表——owner pin 了 published
// 条目才显,空栏目整个不渲染(corpus-pinning 空态规则)。

func defaultInsights() []string {
	return []string{}
}

func defaultProjects() []string {
	return []string{}
}

// defaultWhere —— EMPTY on purpose (F-A-21 sweep). Like the hero prose, the where/status copy is
// visitor-facing; the old defaults ("Edit your location in /admin/page." / "Tell visitors what
// you're up to right now.") spoke to the OWNER. An unconfigured section shows nothing; the owner's
// nudge lives in the /admin/page editor.
func defaultWhere() owner.PageWhere {
	return owner.PageWhere{
		LocationLine: "",
		StatusProse:  "",
		LookingFor:   []string{},
		Closing:      "",
	}
}

func defaultContact() owner.PageContact {
	return owner.PageContact{
		Email:          "",
		ChatLine:       "Ask via the chat above.",
		RecruiterProse: "",
		CasualProse:    "",
	}
}
