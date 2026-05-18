// Package domain 是 DDD 的内核：纯实体、值对象、错误。
// 不依赖任何 internal 包；不依赖任何 infra 库。
package domain

import (
	"errors"
	"time"
)

// Owner 是单 owner instance 的 owner profile。
// 字段顺序按 pointer/int/string 对齐 fieldalignment。
type Owner struct {
	CreatedAt time.Time
	ID        string
	Email     string
	Handle    string
	FullName  string
	Location  string
}

// CreateOwnerInput 是 usecase 层传入 Repository 的创建参数。
// PasswordHash 已经 hash 好（usecase 负责调 hasher），Repository 不碰明文。
type CreateOwnerInput struct {
	Email        string
	PasswordHash string
	Handle       string
	FullName     string
}

// InstanceSettings 是 singleton 行的快照。
type InstanceSettings struct {
	DeployedAt  time.Time
	IsClaimed   bool
	MultiTenant bool
}

// APIToken 是 owner 的 MCP 鉴权 token（metadata 字段；明文/hash 在 session 包）。
// 对齐 youteacher 简化：无 prefix，无 scope 字段（schema 占位 *）。
type APIToken struct {
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ID         string
	Name       string
}

// RawEntry —— owner 通过 MCP push 进 corpus 的"半成品"，未整理。
type RawEntry struct {
	CreatedAt      time.Time
	PromotedTo     *string
	ID             string
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
	Archived       bool
}

// WikiEntry —— curated 内容，树状组织（parent_id 形成森林，root = ParentID==nil）。
// Path 是 induced —— 从 ParentID 链 walk 出来，repo 提供 ComputePath() 算。
// SEO 字段在 M9 加入：seo_slug 启用 /<handle>/wiki/<slug> landing；
// seo_indexed=true 才会进 sitemap.xml。
type WikiEntry struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ParentID       *string
	SEOSlug        *string
	ID             string
	OwnerID        string
	Title          string
	Body           string
	Visibility     string // 'public' | 'on_request' | 'private'
	SEODescription string
	Tags           []string
	SourceRawIDs   []string
	SEOIndexed     bool
}

// SEOSettings —— owner 维度全局 SEO 设置（M9）。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16），strings
// 中间（ptr at 0），slice 在尾（ptr at 0），bool 末尾占 tail padding。
type SEOSettings struct {
	UpdatedAt     time.Time
	OwnerID       string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// ErrSlugTaken —— wiki 的 seo_slug 已被同 owner 别的 entry 占用。
var ErrSlugTaken = errors.New("seo slug already taken in this owner")

// CustomPage —— owner 自定义 React 页面（M10）。
type CustomPage struct {
	CreatedAt           time.Time
	UpdatedAt           time.Time
	LiveBuildID         *string
	StagingBuildID      *string
	PreviousLiveBuildID *string
	ID                  string
	OwnerID             string
	Slug                string
	Title               string
	Status              string // 'active' | 'archived' | 'deleted'
}

// CustomPageBuild —— 一次 sandbox vite build 的状态 + 产物路径。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr）、pointer、
// strings、map 最后。
type CustomPageBuild struct {
	CreatedAt    time.Time
	BuiltAt      *time.Time
	SourceFiles  map[string]string
	ID           string
	PageID       string
	Status       string // 'pending' | 'building' | 'built' | 'failed'
	OutputPath   string
	ErrorMessage string
}

// ErrCustomPageNotFound —— slug / id 反查不到 custom_page。
var ErrCustomPageNotFound = errors.New("custom page not found")

// ErrCustomPageBuildNotFound —— build_id 反查不到 build。
var ErrCustomPageBuildNotFound = errors.New("custom page build not found")

// ErrCustomPageSlugTaken —— 同 owner 下 slug 已存在 active page。
var ErrCustomPageSlugTaken = errors.New("custom page slug already taken")

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")

// ErrRawNotFound —— 按 id 查 raw 未命中。
var ErrRawNotFound = errors.New("raw entry not found")

// ErrCodeInvalid —— access code 不存在或已撤销。
var ErrCodeInvalid = errors.New("access code invalid")

// ErrCodeExpired —— access code 过期。
var ErrCodeExpired = errors.New("access code expired")

// ErrConversationNotFound —— conversation 不存在。
var ErrConversationNotFound = errors.New("conversation not found")

// AccessCode —— 访客访问码（M6）。
type AccessCode struct {
	CreatedAt          time.Time
	ExpiresAt          *time.Time
	ID                 string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	Status             string
	IncludedTags       []string
	ExcludedTags       []string
	SuggestedQuestions []string
}

// VisitorSessionScope —— 访客 session 可见 corpus 范围。
type VisitorSessionScope struct {
	VisibilityMax string // 'public' | 'on_request' | 'private'
	IncludedTags  []string
	ExcludedTags  []string
}

// Conversation —— 一次 visitor chat 会话。
type Conversation struct {
	StartedAt     time.Time
	LastAt        time.Time
	CodeID        *string
	MemberID      *string
	BYOAIProvider *string
	ID            string
	OwnerID       string
	Tier          string // 'code' | 'byoai'
	VisitorName   string
	MessageCount  int32
	HitPrivate    bool
}

// PageContent —— owner public page 完整内容。各 section 留作 typed
// 结构（前端 + admin 编辑都按这个 shape），不让 jsonb 漏到上层。
// 设计稿 J / docs/design/project/page-content.js 是字段语义来源。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16）+ 嵌套
// 结构 + 字符串 + 切片在后，使 last pointer offset 尽量小。
type PageContent struct {
	UpdatedAt    time.Time     `json:"updated_at"`
	Where        PageWhere     `json:"where"`
	Contact      PageContact   `json:"contact"`
	OwnerID      string        `json:"owner_id"`
	HeroProse    string        `json:"hero_prose"`
	HeroExamples []string      `json:"hero_examples"`
	Insights     []PageInsight `json:"insights"`
	Projects     []PageProject `json:"projects"`
}

// PageInsight —— 一条"thesis + 背景 + 展开"的洞见。
type PageInsight struct {
	ID      string `json:"id"`
	Thesis  string `json:"thesis"`
	Context string `json:"context"`
	Body    string `json:"body"`
}

// PageProject —— "typography-only" 风格的项目卡。
type PageProject struct {
	URL     *string  `json:"url,omitempty"`
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Tagline string   `json:"tagline"`
	Lines   []string `json:"lines"`
}

// PageWhere —— "where I am" section（status + looking-for + closing）。
// 字段顺序按 govet fieldalignment：strings 先，slice 在尾（slice ptr 在 offset 0）。
type PageWhere struct {
	LocationLine string   `json:"location_line"`
	StatusProse  string   `json:"status_prose"`
	Closing      string   `json:"closing"`
	LookingFor   []string `json:"looking_for"`
}

// PageContact —— contact section（email + 多段 prose）。
type PageContact struct {
	Email          string `json:"email"`
	ChatLine       string `json:"chat_line"`
	RecruiterProse string `json:"recruiter_prose"`
	CasualProse    string `json:"casual_prose"`
}

// Message —— conversation 内一条消息。
type Message struct {
	CreatedAt      time.Time
	ID             string
	ConversationID string
	Role           string // 'visitor' | 'assistant'
	Body           string
	CitedWikiIDs   []string
}

// Sentinel errors 让 usecase / routes 层能 errors.Is 上做精确分支。
var (
	// ErrInstanceAlreadyClaimed —— 重复 claim 同一个 instance（已经过初次 setup）。
	ErrInstanceAlreadyClaimed = errors.New("instance already claimed")
	// ErrInvalidSetupToken —— setup token 不匹配（被改、被偷、过期 / 已消费）。
	ErrInvalidSetupToken = errors.New("invalid setup token")
	// ErrEmailTaken —— claim 时 email 已被占用（v1 不该发生但保留）。
	ErrEmailTaken = errors.New("email already taken")
	// ErrHandleTaken —— claim 时 handle 已被占用。
	ErrHandleTaken = errors.New("handle already taken")
	// ErrOwnerNotFound —— 按 id / email 查 owner 未命中（login 时不暴露"用户存在与否"）。
	ErrOwnerNotFound = errors.New("owner not found")
	// ErrUnauthorized —— 鉴权失败（密码错、session 失效、token 错等的统一外部码）。
	ErrUnauthorized = errors.New("unauthorized")
	// ErrPageNotFound —— 查 page_content 行不存在；usecase 层返默认值。
	ErrPageNotFound = errors.New("page content not found")
	// ErrInstanceSettingsNotFound —— instance_settings 单行查不到（v1 不该
	// 发生因为 migration 引导插入；保留 sentinel 给后续 multi-tenant 用）。
	ErrInstanceSettingsNotFound = errors.New("instance settings not found")
)
