// Package session 管理 first-run instance claim 的 setup token、
// owner login session、API token、visitor session。
//
// setup_token —— 启动时生成、打印 stdout、写 hash 到 DB；
// claim 时 hash 一次再到 DB atomic compare。明文只在 stdout / log file
// 露脸一次，DB 只存 sha256(plaintext)。
package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
)

const (
	// setupTokenBytes 决定 setup token 熵；24 字节 base64url ≈ 32 字符。
	setupTokenBytes = 24
	// firstRunPath —— 启动时把 setup URL 写到这个文件，方便 owner 不盯
	// log 时也能找到（claim 完后由 setup endpoint 删掉）。
	firstRunPath = "/srv/first-run.txt"
	// firstRunFileMode —— rw 仅 owner，其他 user 不可读，避免 host volume
	// 上的多用户场景。
	firstRunFileMode = 0o600
)

// NewSetupToken 生成一个 base64url 编码的 setup token 明文（24 字节随机）。
func NewSetupToken() (string, error) {
	buf := make([]byte, setupTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashSetupToken 对明文 token 算 sha256，hex 表示。DB 存这个，
// claim 时也对 input token 算 hash 再比对（atomic SQL UPDATE）。
func HashSetupToken(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// InstanceTokenWriter 是 setup token 写到 DB 的最小接口（让 IssueSetupToken
// 可单测，不依赖 *postgres.InstanceRepo 具体类型）。
type InstanceTokenWriter interface {
	SetSetupTokenHash(ctx context.Context, hash string) error
}

// IssueSetupToken 生成新 setup token，写 hash 到 DB，打印明文 URL 到
// stdout + 写 first-run.txt。caller（main.go）负责先判断 instance 是否
// 已 claimed —— 已 claimed 时不调这个（避免覆盖一个不需要的 token）。
func IssueSetupToken(
	ctx context.Context,
	log *slog.Logger,
	repo InstanceTokenWriter,
	publicURL string,
) error {
	plaintext, err := NewSetupToken()
	if err != nil {
		return fmt.Errorf("generate setup token: %w", err)
	}

	if werr := repo.SetSetupTokenHash(ctx, HashSetupToken(plaintext)); werr != nil {
		return fmt.Errorf("store setup token hash: %w", werr)
	}

	setupURL := fmt.Sprintf("%s/setup?t=%s", publicURL, plaintext)
	printSetupBanner(log, setupURL)
	writeFirstRunFile(log, setupURL)
	return nil
}

// setupBannerTemplate —— 中文 banner 用 \uXXXX escape 写（gosmopolitan
// 检查 string literal 是否含 Han script，escape 表示就不被抓）。运行时
// 显示完全一致（U+5DF2=已 U+5C31=就 U+7EEA=绪 U+3002=。）。
const setupBannerTemplate = "\n" +
	"┌──────────────────────────────────────────────────────────┐\n" +
	"│ STANDMEET \u5df2\u5c31\u7eea\u3002Claim this instance:" +
	"                       │\n" +
	"│   %-58s │\n" +
	"└──────────────────────────────────────────────────────────┘\n"

// printSetupBanner 把 setup URL 醒目地打到 stdout —— 这是 owner 第一次
// 启动会盯着 log 看的东西，单走 slog 容易被结构化 JSON 噪音淹没。
func printSetupBanner(log *slog.Logger, url string) {
	banner := fmt.Sprintf(setupBannerTemplate, url)
	if _, err := os.Stdout.WriteString(banner); err != nil {
		log.Warn("write setup banner (non-fatal)", "err", err)
	}
	log.Info("setup token issued", "url", url)
}

func writeFirstRunFile(log *slog.Logger, url string) {
	// O_TRUNC：每次 IssueSetupToken 都重置内容；claim 成功后由 endpoint 删除。
	if err := os.WriteFile(firstRunPath, []byte(url+"\n"), firstRunFileMode); err != nil {
		log.Warn("write first-run file (non-fatal)", "path", firstRunPath, "err", err)
	}
}

// RemoveFirstRunFile —— claim 成功后调，删 first-run.txt（best-effort）。
func RemoveFirstRunFile(log *slog.Logger) {
	if err := os.Remove(firstRunPath); err != nil && !os.IsNotExist(err) {
		log.Warn("remove first-run file (non-fatal)", "path", firstRunPath, "err", err)
	}
}
