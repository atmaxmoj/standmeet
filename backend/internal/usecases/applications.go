// applications.go —— Phase 3：owner 通过 MCP `applications.commit` 把 preview
// draft 升成持久化 application：
//   1. 同事务里 issue AccessCode (180d / 10 sessions / 50 turns) + 落 application
//      行 + 删 draft（postgres.ApplicationRepo.Commit 包了事务）
//   2. 拼最终 QR URL = `<owner.public_url>?code=<plaintext>` —— v1 单 owner
//      instance，访客落到根域名就是这位 owner，URL 不带 handle。
//   3. 用 resumerender.Render 渲染 final PDF（同一渲染器，QR 现在装真的 access code）
//   4. 返回 application + access_code + qr_url + PDF bytes 给 Claude
//
// L.13 决策：draft.job_snapshot 已是 commit 那一刻的快照，commit 路径不依赖
// jobcache TTL；commit 完即可 evict。

package usecases

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

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/resumerender"
)

const (
	// 设计文档 L: 180d 有效 / 10 sessions per member / 50 turns per session。
	applicationCodeDays     = 180
	applicationMaxSessions  = int32(10)
	applicationMaxTurns     = int32(50)
	applicationCodeRandLen  = 6 // base32 chars after the "app-" prefix
	applicationCodePrefix   = "app"
	applicationCodeRandSize = 4 // bytes → 6 base32 chars
)

// ApplicationsDeps —— applications.* usecase 依赖。
//
// 没有 PublicURL 字段：每条 application 的公开 URL 从 owner.PublicURL 读
// （claim 时写进 owners 行，admin 可改）。单一来源、no env / no fallback。
type ApplicationsDeps struct {
	Apps   *postgres.ApplicationRepo
	Owners OwnerLookup
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
		return domain.CommittedApplication{}, ErrEmptyField
	}
	prep, err := prepareCommit(ctx, deps, ownerID, draftID)
	if err != nil {
		return domain.CommittedApplication{}, err
	}
	qrURL := buildQRURL(prep.publicURL, prep.out.AccessCode.Code)
	pdf, err := resumerender.Render(&prep.out.Application.ResumeContent, qrURL)
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
	maxSessions := applicationMaxSessions
	maxTurns := applicationMaxTurns
	in := &postgres.CommitInput{
		OwnerID:              ownerID,
		DraftID:              draftID,
		CodePlaintext:        codePlaintext,
		CodeLabel:            applicationCodePrefix,
		CodePurpose:          "application invitation",
		CodeExpiresAt:        &expires,
		MaxSessionsPerMember: &maxSessions,
		MaxTurnsPerSession:   &maxTurns,
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
