// access.go —— composition root 把 owner.Repo 适配成 access 模块的窄端口。
// access 只需要"sole owner 的 id",不该依赖整个 owner.Repo；这里满足 access.SoleOwnerLookup。

package port

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SoleOwnerLookup —— access.SoleOwnerLookup 的实现：复用 owner.LoadSoleOwner 取 sole owner 的 id。
type SoleOwnerLookup struct {
	owners *owner.Repo
}

// NewSoleOwnerLookup —— 构造。字段不导出:别处只该拿到一个能问 "sole owner 是谁" 的口子。
func NewSoleOwnerLookup(d *deps.Runtime) SoleOwnerLookup {
	return SoleOwnerLookup{owners: d.OwnerRepo}
}

// SoleOwnerID —— 单 owner instance:返回已 claim 的 sole owner id;未 claim 时透传 owner 的错误。
func (s SoleOwnerLookup) SoleOwnerID(ctx context.Context) (string, error) {
	o, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: s.owners})
	if err != nil {
		return "", fmt.Errorf("load sole owner: %w", err)
	}
	return o.ID, nil
}

// RecoveryDeps —— #100 account recovery 的窄依赖(owner repo + session store + mail proxy)。
func RecoveryDeps(d *deps.Runtime) owner.RecoveryDeps {
	return owner.RecoveryDeps{
		Owners: d.OwnerRepo, Sessions: d.SessionStore, Proxy: OutboundSender(d),
	}
}

// EmailChangeDeps —— 改邮箱的窄依赖。比 AccountDeps 多一个出站口：它要先问
// "发得出信吗"(有 mail connector 就走待确认,没有就当场换),再用它把确认信寄到**新**地址。
func EmailChangeDeps(d *deps.Runtime) owner.EmailChangeDeps {
	return owner.EmailChangeDeps{Owners: d.OwnerRepo, Proxy: OutboundSender(d)}
}

// PromptsByName —— 按名字取 prompt id 的窄口。job loop 用它把 builtin `hiring`
// 挂到自动签的码上;域只见到这个接口,不见 PromptRepo。
func PromptsByName(d *deps.Runtime) PromptNameLookup {
	return PromptNameLookup{repo: d.PromptRepo}
}

// PromptNameLookup —— 导出，因为 PromptsByName 返回它（revive unexported-return：
// 返回一个用不了名字的类型，caller 想声明变量都不行）。
type PromptNameLookup struct{ repo *owner.PromptRepo }

// IDByName —— 按名字取一条 prompt 的 id。job loop 用它把 builtin `hiring` 挂到自动签的码上。
func (p PromptNameLookup) IDByName(ctx context.Context, ownerID, name string) (string, error) {
	prompt, err := p.repo.GetByName(ctx, ownerID, name)
	if err != nil {
		return "", fmt.Errorf("prompt by name %q: %w", name, err)
	}
	return prompt.ID(), nil
}

// SubjectivityPresence —— "这条 subjectivity 笔记在不在"。job loop 发码时问一句：
// hiring role 圈着 `subjectivity://cv`，而那是个**约定的名字**，不是产品保证存在的东西。
// owner 把笔记叫别的，那条 glob 就静默匹配不到，招聘官那一路悄悄少一份 CV。
func SubjectivityPresence(d *deps.Runtime) SubjectivityLookup {
	return SubjectivityLookup{repo: d.SubjectivityRepo}
}

// SubjectivityLookup —— 导出，因为 SubjectivityPresence 返回它（revive unexported-return）。
type SubjectivityLookup struct{ repo *corpus.NoteRepo }

// Exists —— uri 形如 `subjectivity://cv`，比的是 slug 化之后的标题。
//
// **查不出来时返回 true（= 不报警）。** 拿不准就别说话：一句错的警告比没有警告更贵 ——
// owner 会去改一个本来没问题的东西。
func (s SubjectivityLookup) Exists(ctx context.Context, ownerID, uri string) bool {
	if s.repo == nil {
		return true
	}
	want := strings.TrimPrefix(uri, "subjectivity://")
	notes, err := s.repo.ListByOwner(ctx, ownerID, subjectivityScanLimit)
	if err != nil {
		return true
	}
	for i := range notes {
		if corpus.SlugifyTitle(notes[i].Title) == want {
			return true
		}
	}
	return false
}

// subjectivityScanLimit —— subjectivity 是 owner 手写的自我模型，条目是几十的量级。
const subjectivityScanLimit = 500
