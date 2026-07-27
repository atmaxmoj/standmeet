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
	"github.com/atmaxmoj/standmeet/internal/owner"
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
	Apps     CommitStore
	Owners   OwnerLookup
	Roles    *access.RoleRepo
	Renderer PDFRenderer
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
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string,
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
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string,
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
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string,
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
			ID: appID, ResumeContent: data.Resume, JobSnapshot: data.Job,
		},
		qrURL: buildQRURL(ownerRow.PublicURL, code), code: code, appID: appID,
	}, nil
}

func runCommitTx(
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string, rp *renderPrep,
) (CommitOutput, error) {
	expires := time.Now().AddDate(0, 0, applicationCodeDays)
	maxMembers := applicationMaxMembers
	maxTurns := applicationMaxTurns
	// A.3-IAM-5: application 自动 issue code 默认挂 owner 的 public role。
	public, verr := deps.Roles.GetByName(ctx, ownerID, access.PublicRoleName)
	if verr != nil {
		return CommitOutput{}, fmt.Errorf("get public role: %w", verr)
	}
	in := &CommitInput{
		OwnerID:            ownerID,
		DraftID:            draftID,
		ApplicationID:      rp.appID,
		CodePlaintext:      rp.code,
		CodeLabel:          applicationCodePrefix,
		CodePurpose:        "application invitation",
		CodeExpiresAt:      &expires,
		MaxMembers:         &maxMembers,
		MaxTurnsPerSession: &maxTurns,
		AssumedRoleID:      public.ID(),
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
