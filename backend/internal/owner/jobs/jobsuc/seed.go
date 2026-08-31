// jobs_seed.go —— job loop 需要在 owner 名下存在的那两条 builtin：`hiring` prompt + role。
//
// **为什么在这里而不是内核的 roles_seed**：`hiring` 是这个插件的概念，不是一档内核级
// 访问层。第一版把 `HiringRoleName` 摆进了 `access/entity`（`PublicRoleName` /
// `InvitedRoleName` 旁边），于是内核认识了一个插件的词，而 `check-core-agnostic` 的
// CORE_DIRS 不含 access/entity —— 那道锁结构上看不见这种泄漏，`make lint` 照样绿。
// 跟 PeriodicWorker 那条注释记的是同一个教训：插件的东西落在装配的地方，只因为钩子在那儿。
//
// **为什么另开一条 role 而不复用 `invited`**：两种邀请要看的东西不一样。批准 gate 申请
// 发出的码，对方是来聊天的；而扫简历 QR 进来的是招聘官，他一定会问雇主、起止日期、
// 工作许可 —— 那些事实在 subjectivity 里，而 `invited` 的三条 glob 里没有 subjectivity。
// 给 invited 加上等于把这份 PII 交给**每一张产品发出去的码**，gate 批准码也在内。

package jobsuc

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// HiringPromptName / HiringRoleName —— 这两条 builtin 的名字。owner 在
// /admin/prompts 和 /admin/roles 上看得见它们，也改得动。
// 名字跟 applications.go 里那两个私有常量必须一致 —— 同包，直接复用。

const hiringPromptDescription = "Visitors who arrived from a job application, a resume QR, " +
	"or a recruiter conversation."

const hiringRoleDescription = "System default for codes the job loop issues — the QR on a " +
	"résumé. Everything an invitee reads, plus the CV entry: the employers, dates and " +
	"logistics a recruiter always asks for. Narrow it here if applications should show less."

// hiringRoleCorpusURIs —— invited 那三条 + CV 那一条。
//
// ⚠️ `subjectivity://cv` 是一个**约定的名字**，不是产品保证存在的东西。owner 把那条
// 笔记叫别的，这条 glob 就静默匹配不到，招聘官那一路悄悄少一份 CV 而没有任何东西会响。
// 它之所以还能接受：这份正列表在 /admin/roles 上**看得见也改得动**，跟
// InvitedRoleCorpusURIs 是同一个姿势 —— 种子给起点，收窄或改名是 owner 的决定。
var hiringRoleCorpusURIs = []string{
	"wiki://**",
	"output://**",
	"writing://**",
	"subjectivity://cv",
}

// hiringPromptBody —— **只建立框架，不断言任何关于 owner 的事实。**
//
// 第一版正文里写着 "he"、"is actively looking"、"not a job-seeker" —— 那是我这台实例的
// 调参，却成了每台实例的默认值：任何人装 StandMeet 都会拿到一段用 "he" 指代自己、
// 替他宣布正在找工作的提示词。默认值只该说这条**通道**是什么（对方从一份申请来、
// 按候选人回答、不许编雇主），关于这个人的话由 owner 自己在 /admin/prompts 里写。
//
// 写成拼接而不是反引号块：源码行不能超 100 字符，而这段正文的换行有意义。
const hiringPromptBody = "This visitor arrived through a job application, a resume, or a\n" +
	"recruiter conversation. Treat that as established context for the whole session —\n" +
	"they are evaluating the owner as a candidate for a role.\n" +
	"\n" +
	"Answer as a strong candidate would: concrete, specific, evidence-first.\n" +
	"\n" +
	"- Lead with what the owner has actually built and what they did in it — the\n" +
	"  decision, the constraint, the trade-off, the measured outcome.\n" +
	"- Translate depth into the role's language. Say what the theory bought, not that\n" +
	"  they read it.\n" +
	"- When asked what they are suited for, answer with roles a company can actually\n" +
	"  hire for, and say why, from evidence. Not a personality verdict.\n" +
	"- The corpus's own marketing copy describes who the product serves. It is never a\n" +
	"  statement about the owner, and on this code it must not be read as one.\n" +
	"- When the corpus does not cover something a hiring manager reasonably needs —\n" +
	"  employment dates, titles, references, location, work authorization, compensation\n" +
	"  — say plainly that it is not in the notes and that the owner can answer it\n" +
	"  directly. Never guess these and never invent an employer.\n" +
	"- Say how much you looked at when the question is broad, so the visitor can judge\n" +
	"  the answer's base.\n" +
	"\n" +
	"Stay in the owner's voice, stay honest about gaps, and never oversell. A hiring\n" +
	"manager trusts specifics and distrusts adjectives."

// CVPresence —— hiring role 圈着的那条 CV 在不在。窄到只够发码时问一句。
//
// 放在 seed 这一侧而不是 applications.go：那条 glob 是**这里种下去的**
// （hiringRoleCorpusURIs），检查它兑不兑现的接口跟着它走。
type CVPresence interface {
	Exists(ctx context.Context, ownerID, uri string) bool
}

// SeedDeps —— 种这两条 builtin 要的两个仓储。外壳（internal/owner/jobs）持它，
// 但不认识域 facade：arch 规则里那个包只能碰 jobsuc 的类型。
type SeedDeps struct {
	Prompts *owner.PromptRepo
	Roles   *access.RoleRepo
}

// SeedOwner —— 幂等 upsert（claim 一次 + 每次启动一次）。
func SeedOwner(ctx context.Context, deps SeedDeps, ownerID string) error {
	prompt, err := deps.Prompts.UpsertBuiltin(
		ctx, ownerID, hiringPromptName, hiringPromptDescription, hiringPromptBody,
	)
	if err != nil {
		return fmt.Errorf("upsert hiring prompt: %w", err)
	}
	promptID := prompt.ID()
	role, rerr := deps.Roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        hiringRoleName,
		Description: hiringRoleDescription,
		PromptID:    &promptID,
	})
	if rerr != nil {
		return fmt.Errorf("upsert hiring role: %w", rerr)
	}
	if serr := deps.Roles.SetCorpusURIs(ctx, role.ID(), hiringRoleCorpusURIs); serr != nil {
		return fmt.Errorf("set hiring role corpus uris: %w", serr)
	}
	return nil
}
