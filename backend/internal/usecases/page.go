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

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// PageDeps —— page usecase 所需。PageContent 是 Owner aggregate 的内容
// 切面，所以 GetPageContent / UpsertPageContent 都是 OwnerRepo 方法；
// usecase 这里不再持有独立 PageRepo。
type PageDeps struct {
	Owners *postgres.OwnerRepo
}

// PublicPageView —— GET /api/v1/page 返回的形状。
// Owner 部分挑公开字段，page_content 全字段，时间戳是页面 last-updated。
type PublicPageView struct {
	Owner   PublicOwnerView    `json:"owner"`
	Content domain.PageContent `json:"content"`
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
func LoadSoleOwner(ctx context.Context, deps PageDeps) (domain.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return domain.Owner{}, domain.ErrOwnerNotFound
	}
	owner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return domain.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return owner, nil
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

// GetPublicPage —— sole owner → page_content。page_content 缺失时填默认。
func GetPublicPage(ctx context.Context, deps PageDeps) (PublicPageView, error) {
	owner, err := LoadSoleOwner(ctx, deps)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return PublicPageView{}, domain.ErrOwnerNotFound
		}
		return PublicPageView{}, err
	}
	content, err := loadPageContentOrDefault(ctx, deps, owner.ID)
	if err != nil {
		return PublicPageView{}, err
	}
	return PublicPageView{
		Owner: PublicOwnerView{
			Handle:   owner.Handle,
			FullName: owner.FullName,
			Location: owner.Location,
		},
		Content: content,
	}, nil
}

func loadPageContentOrDefault(
	ctx context.Context, deps PageDeps, ownerID string,
) (domain.PageContent, error) {
	content, err := deps.Owners.GetPageContent(ctx, ownerID)
	if errors.Is(err, domain.ErrPageNotFound) {
		return buildDefaultPage(ownerID), nil
	}
	if err != nil {
		return domain.PageContent{}, fmt.Errorf("get page content: %w", err)
	}
	return content, nil
}

// DefaultPageContent —— page-content.js 里的默认 hero / insights / projects /
// where / contact。新 instance 第一次被访问时返这个；admin 第一次保存就
// 覆盖。
func DefaultPageContent(ownerID string) domain.PageContent {
	return buildDefaultPage(ownerID)
}

func buildDefaultPage(ownerID string) domain.PageContent {
	return domain.PageContent{
		OwnerID:      ownerID,
		HeroProse:    defaultHeroProse,
		HeroExamples: defaultHeroExamples(),
		Insights:     defaultInsights(),
		Projects:     defaultProjects(),
		Where:        defaultWhere(),
		Contact:      defaultContact(),
	}
}

const defaultHeroProse = "" +
	"I'm Alice. I build indie products, write code with AI but fight " +
	"its defaults, learn German through Kafka, and think software " +
	"architecture is about to follow organizations into a new shape."

func defaultHeroExamples() []string {
	return []string{
		"What do you think about AI replacing engineers?",
		"How do you choose what to build as an indie founder?",
		"Why did you leave Hong Kong?",
		"What's wrong with vibe coding?",
	}
}

func defaultInsights() []domain.PageInsight {
	return []domain.PageInsight{
		{
			ID: "i-1",
			Thesis: "AI coding doesn't make engineers faster — " +
				"it makes codebases sicker.",
			Context: "from a conversation about indie tooling",
			Body: "Velocity feels real because typing is faster. But the codebase " +
				"accumulates the surface area of every prompt you sent — none of it " +
				"pruned, none of it pinned to a hierarchy of ideas. Six months later " +
				"you have a project that looks like a transcript, not a system.",
		},
		{
			ID: "i-2",
			Thesis: "Software architecture mirrors organization. " +
				"AI changes organization. So architecture will change.",
			Context: "a 5-year prediction",
			Body: "Microservices were Amazon's org chart in YAML. The next architecture " +
				"is whatever shape teams take once AI absorbs the bottom half of the " +
				"engineering pyramid. My bet: fewer services, much larger blast radius " +
				"per repo, more long-lived AI agents owning subsystems the way a team used to.",
		},
		{
			ID: "i-3",
			Thesis: "You can't measure expertise by years. " +
				"You measure it by feedback × time × willingness to update.",
			Context: "from a discussion on hiring",
			Body: "Two engineers with the same 10 years can be a decade apart in real " +
				"depth. The one who shipped, watched, and admitted being wrong has " +
				"compounded; the one who managed up for 10 years hasn't. The number " +
				"itself tells you nothing.",
		},
		{
			ID: "i-4",
			Thesis: "The hiring market loses people whose value doesn't fit " +
				"standard buckets. That's why StandMeet exists.",
			Context: "the founding observation",
			Body: "I'm not the engineer you find by filtering for 'staff IC, 8+ years, " +
				"ex-FAANG'. I'm closer than that for what I can do, further than that " +
				"on paper. StandMeet is the page that gets to argue back.",
		},
	}
}

func defaultProjects() []domain.PageProject {
	lucernaURL := "lucerna.dev"
	flexmeshURL := "flexmesh.ca"
	return []domain.PageProject{
		{
			URL:     &lucernaURL,
			ID:      "p-lucerna",
			Name:    "Lucerna",
			Tagline: "reading-first language learning",
			Lines: []string{
				"Indie. ~12 new users/day. D30 retention 6%, which is healthy for the strategy.",
				"I'm migrating it from monorepo to a 6-service architecture, solo.",
			},
		},
		{
			URL:     &flexmeshURL,
			ID:      "p-flexmesh",
			Name:    "FlexMesh",
			Tagline: "routing for Canadian delivery drivers",
			Lines: []string{
				"$29/driver/month. Has paying users.",
				"Built for fleet of 1, indexed by ChatGPT.",
			},
		},
		{
			ID:      "p-youteacher",
			Name:    "YouTeacher",
			Tagline: "ESL recruitment for China",
			Lines: []string{
				"Partnership with Pete. 151K LOC across 12 microservices, built in 2 months.",
				"Not public yet.",
			},
		},
		{
			ID:      "p-standmeet",
			Name:    "StandMeet",
			Tagline: "what you're reading right now",
			Lines: []string{
				"The corpus this site is built on grows from " +
					"every AI conversation I curate forward.",
			},
		},
	}
}

func defaultWhere() domain.PageWhere {
	return domain.PageWhere{
		LocationLine: "Based in Markham, Ontario. Canadian PR.",
		StatusProse: "Last 2 years I've been indie. I'm starting to look at employment " +
			"again, but selectively — I'm specifically looking for tech-driven companies " +
			"where staff IC is a real path, not where it ends at senior.",
		LookingFor: []string{
			"founding engineer or staff IC role",
			"Series A+ AI startup or similar",
			"long enough runway, real revenue",
			"< 30 people, technical founder",
		},
		Closing: "Otherwise — just here to think out loud.",
	}
}

func defaultContact() domain.PageContact {
	return domain.PageContact{
		Email: "hello@sijiewang.com",
		ChatLine: "Ask via the chat above. It knows my views on " +
			"most things and will answer in my voice.",
		RecruiterProse: "If you're a recruiter or hiring manager, consider sending what role + " +
			"company first, so we can both decide if a call makes sense. Generic outreach I " +
			"rarely respond to.",
		CasualProse: "If you just want to chat about ideas — indie building, German, modal " +
			"logic, Kafka, anything else here — I usually have time.",
	}
}
