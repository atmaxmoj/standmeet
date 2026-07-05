// applications.go —— Phase 3：owner 通过 MCP `applications.commit` 把 preview
// draft 升成持久化 application：
//   1. 同事务里 issue AccessCode (180d / 10 sessions / 50 turns) + 落 application
//      行 + 删 draft（postgres.ApplicationRepo.Commit 包了事务）
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

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// PDFRenderer —— 渲染 application 的 final PDF（包含 QR）。usecase 不关心
// 实现走哪一条路（in-process / sidecar / 远程 service），只调一次。
// gotenberg.NoopClient 之前在 wireup 注入，commit 会以
// gotenberg.ErrNotConfigured 失败 —— 这是 task 13 完成前的预期行为。
type PDFRenderer interface {
	RenderApplicationPDF(
		ctx context.Context, app *domain.Application, qrURL string,
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
	Apps     *postgres.ApplicationRepo
	Owners   OwnerLookup
	Roles    *postgres.RoleRepo
	Renderer PDFRenderer
}

// OwnerLookup —— 取 owner handle 用于拼 QR URL；用接口避开 usecases → postgres
// 的具体 OwnerRepo 直耦合（cmd 层 wireup 注入实际实现）。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (domain.Owner, error)
}

// CommitApplication —— 主入口。返回结构化 application + 同步 issue 的 access
// code + QR URL + 最终 PDF bytes。
func CommitApplication(
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string,
) (domain.CommittedApplication, error) {
	if ownerID == "" || draftID == "" {
		return domain.CommittedApplication{}, usecases.ErrEmptyField
	}
	prep, err := prepareCommit(ctx, deps, ownerID, draftID)
	if err != nil {
		return domain.CommittedApplication{}, err
	}
	qrURL := buildQRURL(prep.publicURL, prep.out.AccessCode.Code)
	pdf, err := deps.Renderer.RenderApplicationPDF(ctx, &prep.out.Application, qrURL)
	if err != nil {
		return domain.CommittedApplication{}, fmt.Errorf("render final pdf: %w", err)
	}
	return domain.CommittedApplication{
		Application: prep.out.Application,
		AccessCode:  prep.out.AccessCode,
		QRURL:       qrURL,
		PDF:         pdf,
	}, nil
}

// commitPrep —— prepareCommit 把 owner lookup + code gen + DB tx 三步打包，
// 让 CommitApplication 的 cyclomatic complexity 控在 ≤5。
type commitPrep struct {
	publicURL string
	out       postgres.CommitOutput
}

func prepareCommit(
	ctx context.Context, deps ApplicationsDeps, ownerID, draftID string,
) (commitPrep, error) {
	owner, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return commitPrep{}, fmt.Errorf("get owner: %w", err)
	}
	if owner.PublicURL == "" {
		return commitPrep{}, domain.ErrPublicURLNotSet
	}
	code, err := generateApplicationCode()
	if err != nil {
		return commitPrep{}, err
	}
	out, err := runCommitTx(ctx, deps, ownerID, draftID, code)
	if err != nil {
		return commitPrep{}, err
	}
	return commitPrep{out: out, publicURL: owner.PublicURL}, nil
}

func runCommitTx(
	ctx context.Context, deps ApplicationsDeps,
	ownerID, draftID, codePlaintext string,
) (postgres.CommitOutput, error) {
	expires := timestamptzFromTime(time.Now().AddDate(0, 0, applicationCodeDays))
	maxMembers := applicationMaxMembers
	maxTurns := applicationMaxTurns
	// A.3-IAM-5: application 自动 issue code 默认挂 owner 的 public role。
	public, verr := deps.Roles.GetByName(ctx, ownerID, domain.PublicRoleName)
	if verr != nil {
		return postgres.CommitOutput{}, fmt.Errorf("get public role: %w", verr)
	}
	in := &postgres.CommitInput{
		OwnerID:            ownerID,
		DraftID:            draftID,
		CodePlaintext:      codePlaintext,
		CodeLabel:          applicationCodePrefix,
		CodePurpose:        "application invitation",
		CodeExpiresAt:      &expires,
		MaxMembers:         &maxMembers,
		MaxTurnsPerSession: &maxTurns,
		AssumedRoleID:      public.ID(),
	}
	out, err := deps.Apps.Commit(ctx, in)
	if err != nil {
		if errors.Is(err, domain.ErrResumeDraftNotFound) {
			return postgres.CommitOutput{},
				fmt.Errorf("draft missing: %w", domain.ErrResumeDraftNotFound)
		}
		return postgres.CommitOutput{}, fmt.Errorf("commit application: %w", err)
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

func timestamptzFromTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
