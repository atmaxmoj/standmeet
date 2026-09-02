// applications.go —— Phase 3：owner 通过 MCP `applications.commit` 把 preview
// draft 升成持久化 application：
//   1. 同事务里 issue AccessCode (180d / 10 sessions / 50 turns) + 落 application
//      行 + 删 draft（ApplicationRepo.Commit 包了事务）
//   2. 拼最终 QR URL = `<owner.public_url>?code=<plaintext>` —— v1 单 owner
//      instance，访客落到根域名就是这位 owner，URL 不带 handle。
//   3. 让注入的 PDFRenderer 把 application（含 resume_content + job_snapshot）+
//      qr_url 渲染成 final PDF bytes —— v1 实现是 gotenberg sidecar 调 headless
//      Chromium 抓 admin /print 路由，跟 owner live preview 同一份 React 组件
//   4. 返回 application + access_code + qr_url + PDF bytes 给 Claude
//
// L.13 决策：draft.job_snapshot 已是 commit 那一刻的快照，commit 路径不依赖
// jobcache TTL；commit 完即可 evict。

package jobsuc

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// PDFRenderer —— 渲染 application 的 final PDF（包含 QR）。usecase 不关心
// 实现走哪一条路（in-process / sidecar / 远程 service），只调一次。
// gotenberg.NoopClient 之前在 wireup 注入，commit 会以
// gotenberg.ErrNotConfigured 失败 —— 这是 task 13 完成前的预期行为。
type PDFRenderer interface {
	RenderApplicationPDF(
		ctx context.Context, app *jobsmodel.Application, qrURL string,
	) ([]byte, error)
}

const (
	// 设计文档 L: 180d 有效 / 10 个名字(人)/ 50 turns per session。
	// "10 sessions" 本来就是"10 个人"的意思(member=name=session),落到 max_members。
	applicationCodeDays     = 180
	applicationMaxMembers   = int32(10)
	applicationMaxTurns     = int32(50)
	applicationCodeRandLen  = 6 // base32 chars after the "app-" prefix
	applicationCodePrefix   = "app"
	applicationCodeRandSize = 4 // bytes → 6 base32 chars
)

// ApplicationsDeps —— applications.* usecase 依赖。
//
// 没有 PublicURL 字段：每条 application 的公开 URL 从 owner.PublicURL 读
// （claim 时写进 owners 行，admin 可改）。单一来源、no env / no fallback。
// Renderer 之前在 wireup 注入 —— v1 是 gotenberg client，测试用 fake。
type ApplicationsDeps struct {
	Apps   CommitStore
	Owners OwnerLookup
	Roles  *access.RoleRepo
	// Prompts —— 只为了把 builtin `hiring` 挂到自动签的码上。窄口:一个按名字查。
	// 集中管理的招聘语境放这一层,而不是发码时把文字冻进码里 —— 快照在 session 颁发时
	// 才拍,所以 owner 之后每次打磨都惠及所有还没被打开的申请码。
	Prompts PromptLookup
	// CVCheck —— 发码时问一句"hiring role 圈的那条 CV 在不在"。nil = 不问
	// （老装配路径 / 测试）；不在也**不阻断投递**，只在回执里说一句。
	CVCheck  CVPresence
	Renderer PDFRenderer
}

// PromptLookup —— 按名字取一条 prompt 的 id。窄到只够 job loop 用。
type PromptLookup interface {
	IDByName(ctx context.Context, ownerID, name string) (string, error)
}

// CommitStore —— the application persistence CommitApplication needs (narrow → the render-before-
// persist ordering is unit-testable with a spy that asserts Commit is not reached on render fail).
// *ApplicationRepo satisfies it.
type CommitStore interface {
	GetDraftRenderData(
		ctx context.Context, ownerID, draftID string,
	) (DraftRenderData, error)
	Commit(ctx context.Context, in *CommitInput) (CommitOutput, error)
}

// OwnerLookup —— 取 owner handle 用于拼 QR URL；用接口避开 usecases → postgres
// 的具体 OwnerRepo 直耦合（cmd 层 wireup 注入实际实现）。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (owner.Owner, error)
}

// CommitApplication —— 主入口。返回结构化 application + 同步 issue 的 access
// code + QR URL + 最终 PDF bytes。
func CommitApplication(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (jobsmodel.CommittedApplication, error) {
	if ownerID == "" || draftID == "" {
		return jobsmodel.CommittedApplication{}, apierr.ErrEmptyField
	}
	return renderThenCommit(ctx, deps, ownerID, draftID)
}

// renderThenCommit —— render the final PDF BEFORE the irreversible commit: all render inputs (draft
// content, a pre-generated code + application id, QR URL) are read/generated without persisting
// anything, so a render failure strands nothing and the owner can retry. Only after the PDF is in
// hand do we commit.
func renderThenCommit(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (jobsmodel.CommittedApplication, error) {
	rp, err := prepareRender(ctx, deps, ownerID, draftID)
	if err != nil {
		return jobsmodel.CommittedApplication{}, err
	}
	pdf, err := deps.Renderer.RenderApplicationPDF(ctx, &rp.renderApp, rp.qrURL)
	if err != nil {
		return jobsmodel.CommittedApplication{}, fmt.Errorf("render final pdf: %w", err)
	}
	out, err := runCommitTx(ctx, deps, ownerID, draftID, &rp)
	if err != nil {
		return jobsmodel.CommittedApplication{}, err
	}
	return jobsmodel.CommittedApplication{
		Application: out.Application,
		AccessCode:  out.AccessCode,
		QRURL:       rp.qrURL,
		PDF:         pdf,
		Warning:     cvWarning(ctx, deps, ownerID),
	}, nil
}

// renderPrep —— everything needed to render the final PDF, produced without persisting anything.
type renderPrep struct {
	qrURL     string
	code      string
	appID     string
	renderApp jobsmodel.Application
}

func prepareRender(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (renderPrep, error) {
	ownerRow, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return renderPrep{}, fmt.Errorf("get owner: %w", err)
	}
	if ownerRow.PublicURL == "" {
		return renderPrep{}, owner.ErrPublicURLNotSet
	}
	data, err := deps.Apps.GetDraftRenderData(ctx, ownerID, draftID)
	if err != nil {
		return renderPrep{}, fmt.Errorf("get draft render data: %w", err)
	}
	code, err := generateApplicationCode()
	if err != nil {
		return renderPrep{}, err
	}
	appID := uuid.NewString()
	return renderPrep{
		renderApp: jobsmodel.Application{
			ID: appID, ResumeContent: data.Resume, JobSnapshot: data.Job, Template: data.Template,
		},
		qrURL: buildQRURL(ownerRow.PublicURL, code), code: code, appID: appID,
	}, nil
}

func runCommitTx(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string, rp *renderPrep,
) (CommitOutput, error) {
	expires := time.Now().AddDate(0, 0, applicationCodeDays)
	maxMembers := applicationMaxMembers
	maxTurns := applicationMaxTurns
	// 这张码印在简历右上角的 QR 里 —— 是一次**定向邀请**，所以它不能挂给未受邀访客的
	// public 兜底档。挂错档的后果只有在 public 收窄成"只读已发布"之后才显形：
	// recruiter 扫码进来只看得到公开页（F-D-7 的下游）。
	//
	// 挂 `hiring` 而不是 `invited`：招聘官一定会问雇主、起止日期、工作许可，而那些事实
	// 在 subjectivity 里，不在 invited 的三条 glob 里。给 invited 加上 subjectivity
	// 等于把这份 PII 交给**每一张产品发出去的码**（gate 批准码也在内）—— 所以另开一条。
	// 这条 role 由本插件自己种（jobs_seed.go），不由内核的 roles_seed 管。
	hiring, verr := deps.Roles.GetByName(ctx, ownerID, hiringRoleName)
	if verr != nil {
		return CommitOutput{}, fmt.Errorf("get hiring role: %w", verr)
	}
	in := &CommitInput{
		OwnerID:            ownerID,
		DraftID:            draftID,
		ApplicationID:      rp.appID,
		CodePlaintext:      rp.code,
		CodeLabel:          applicationCodeLabel(&rp.renderApp.JobSnapshot),
		CodePurpose:        "application invitation",
		CodePromptID:       hiringPromptID(ctx, deps, ownerID),
		CodeExpiresAt:      &expires,
		MaxMembers:         &maxMembers,
		MaxTurnsPerSession: &maxTurns,
		AssumedRoleID:      hiring.ID(),
	}
	out, err := deps.Apps.Commit(ctx, in)
	if err != nil {
		if errors.Is(err, jobsmodel.ErrResumeDraftNotFound) {
			return CommitOutput{},
				fmt.Errorf("draft missing: %w", jobsmodel.ErrResumeDraftNotFound)
		}
		return CommitOutput{}, fmt.Errorf("commit application: %w", err)
	}
	return out, nil
}

// hiringRoleName / hiringPromptName —— 本插件自己种的那两条 builtin 的名字。
// 种它们的是同包的 seed.go，用它们的是这里 —— 一份常量，两处共用。
const (
	hiringRoleName   = "hiring"
	hiringPromptName = "hiring"
)

// applicationCodeLabel —— 侧栏和 codes 面板上那张牌子。
//
// ⚠️ 曾经是常量 `applicationCodePrefix` —— 每一份申请签出来的码都顶着同一句话，
// 而这个字段的设计意图是"说出访客进的是哪一片"。owner 打开 codes 面板看到十几张
// 一模一样的牌子，分不出哪张是投给谁的（[[names-that-lie]]）。职位和公司就在
// job_snapshot 里，一伸手的事。
func applicationCodeLabel(job *jobsmodel.FetchedJob) string {
	if role := describeRole(job.Title, job.Company); role != "" {
		return applicationCodePrefix + " · " + role
	}
	return applicationCodePrefix
}

// cvGlobSuffix —— hiring role 正列表里那条 CV glob 的地址部分。
//
// 它是一个**约定的名字**，不是产品保证存在的东西：owner 把那条 subjectivity 笔记
// 叫别的，这条 glob 就匹配不到，招聘官那一路悄悄少一份 CV —— 而少的正是他一定会问的
// 雇主和起止日期。原来这个失配是**完全静默**的。
const cvGlobSuffix = "subjectivity://cv"

// cvWarning —— 发码那一刻检查一次：hiring role 圈着 CV，那条笔记在不在。
//
// 检查落在 **commit** 而不是 seed：seed 在启动时跑，那时 owner 可能还没写 CV，
// 报警只会变成噪音。而 commit 是"这份申请要投出去了"的时刻 —— 有人在看，
// 而且这正是"招聘官待会儿问雇主，我答不出来"会造成损失的那一刻。
//
// 只**说**，不阻断：CV 不是投递的前置条件，owner 可能就是不想放。
func cvWarning(ctx context.Context, deps *ApplicationsDeps, ownerID string) string {
	if deps.CVCheck == nil {
		return ""
	}
	if deps.CVCheck.Exists(ctx, ownerID, cvGlobSuffix) {
		return ""
	}
	return "The `hiring` role grants " + cvGlobSuffix + ", but no such entry exists. " +
		"A recruiter asking about employers, dates or work authorization will be told " +
		"it is not in the notes. Write it with subjectivity_write titled \"cv\", or " +
		"narrow the role in /admin/roles if that is deliberate."
}

// hiringPromptID —— builtin `hiring` 的 id。取不到就返回 nil：**不阻断投递**。
// 这条路上唯一会失败的原因是这台实例还没种出 hiring（不该发生），
// 而为此让 owner 投不出简历是拿系统的毛病罚用户。
func hiringPromptID(ctx context.Context, deps *ApplicationsDeps, ownerID string) *string {
	if deps.Prompts == nil {
		return nil
	}
	id, err := deps.Prompts.IDByName(ctx, ownerID, hiringPromptName)
	if err != nil || id == "" {
		return nil
	}
	return &id
}

// generateApplicationCode —— "app-XXXXXX" lowercase base32（4 random bytes ≈ 6 chars）。
// 字符集只用 a-z2-7，URL-safe，肉眼可读。
func generateApplicationCode() (string, error) {
	buf := make([]byte, applicationCodeRandSize)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return applicationCodePrefix + "-" + strings.ToLower(enc)[:applicationCodeRandLen], nil
}

func buildQRURL(publicURL, code string) string {
	base := strings.TrimRight(publicURL, "/")
	return fmt.Sprintf("%s/?code=%s", base, url.QueryEscape(code))
}
