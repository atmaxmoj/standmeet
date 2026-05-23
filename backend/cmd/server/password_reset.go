// password_reset.go —— `standmeet password-reset` 子命令实现。
//
// owner 忘了密码兜底：服务器上 docker exec 跑这个子命令，server 进程
// 短暂启起来、写 DB 一次性 reset token、stdout 打印 plaintext + URL，
// 然后退出。owner 拷链接到浏览器，进 /account/reset?t=... 改密码。
//
// 设计：
//   - token 32-byte random，base64url 编码 + "smr_" 前缀（standmeet reset）。
//     hash = SHA-256(plaintext)，落 owners.password_reset_hash（bytea）。
//     password_reset_at = NOW()，验时检 TTL (30min)。
//   - 通过 postgres.OwnerRepo 走，不直接 import dbq（arch-lint 拒）。

package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/wangsijie/standmeet/internal/config"
	"github.com/wangsijie/standmeet/internal/postgres"
)

const (
	passwordResetTokenBytes  = 32
	passwordResetTokenPrefix = "smr_"
	// passwordResetTTLMinutes —— operator 看 stdout 知道得在多少分钟内用掉；
	// 保持跟 usecases.PasswordResetTTL 一致。
	passwordResetTTLMinutes = 30
)

// resetToken —— generateResetToken 返结构，避开 function-result-limit。
type resetToken struct {
	plaintext string
	hash      []byte
}

// runPasswordReset —— 子命令入口。连 pg → 拿 sole owner → 颁发 token →
// 打印 URL。任何失败返 error，caller (main) 决定 exit code。
func runPasswordReset(log *slog.Logger, cfg *config.Config) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect pg: %w", err)
	}
	defer db.Close()
	return issueAndPrint(ctx, log, db)
}

func issueAndPrint(ctx context.Context, log *slog.Logger, db *postgres.Pool) error {
	repo := postgres.NewOwnerRepo(db)
	handle, err := repo.GetSoleOwnerHandle(ctx)
	if err != nil {
		return fmt.Errorf("find sole owner: %w (has anyone claimed yet?)", err)
	}
	tok, gerr := generateResetToken()
	if gerr != nil {
		return gerr
	}
	if serr := repo.SetPasswordResetHash(ctx, handle.OwnerID, tok.hash); serr != nil {
		return fmt.Errorf("write reset token: %w", serr)
	}
	if handle.PublicURL == "" {
		log.Warn("owner.public_url is empty; printed URL will need manual host")
	}
	printResetInstructions(os.Stdout, tok.plaintext, handle.PublicURL)
	return nil
}

func generateResetToken() (resetToken, error) {
	buf := make([]byte, passwordResetTokenBytes)
	if _, rerr := rand.Read(buf); rerr != nil {
		return resetToken{}, fmt.Errorf("read random: %w", rerr)
	}
	pt := passwordResetTokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(pt))
	return resetToken{plaintext: pt, hash: sum[:]}, nil
}

func printResetInstructions(w io.Writer, plaintext, publicURL string) {
	base := publicURL
	if base == "" {
		base = "<your-public-url>"
	}
	writeLines(w, []string{
		"",
		fmt.Sprintf("PASSWORD RESET TOKEN (one-time, expires in %d min):", passwordResetTTLMinutes),
		"",
		"  open in browser:",
		"  " + base + "/account/reset?t=" + plaintext,
		"",
		"after submitting a new password, the token is consumed and cannot be reused.",
		"",
	})
}

func writeLines(w io.Writer, lines []string) {
	for _, line := range lines {
		if _, err := fmt.Fprintln(w, line); err != nil {
			// stdout 写不出去就放弃；不应该 fail subcommand 因为这个。
			return
		}
	}
}

// passwordResetSubcommand —— main() 调度：argv[1] == "password-reset" 时
// 跑 reset 然后返 exit code（0 / 1）。其它 argv 走 server 路径返 -1。
func passwordResetSubcommand(log *slog.Logger) int {
	if len(os.Args) < 2 || os.Args[1] != "password-reset" {
		return -1
	}
	cfg, err := config.Load()
	if err != nil {
		log.Error("password-reset: load config", "err", err)
		return 1
	}
	if rerr := runPasswordReset(log, cfg); rerr != nil {
		log.Error("password-reset failed", "err", rerr)
		return 1
	}
	return 0
}
