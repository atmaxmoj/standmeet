// cmd_password_reset.go —— implementation of the `standmeet password-reset` subcommand.
//
// Fallback for when the owner forgets their password: run this subcommand via
// docker exec on the server, the server process starts up briefly, writes a one-time
// reset token to the DB, prints the plaintext + URL to stdout, then exits. The owner
// copies the link into a browser and goes to /account/reset?t=... to change the
// password.
//
// Design:
//   - token is 32 random bytes, base64url-encoded with a "smr_" prefix (standmeet
//     reset). hash = SHA-256(plaintext), stored in owners.password_reset_hash (bytea).
//     password_reset_at = NOW(), TTL checked on verify (30min).
//   - goes through owner.Repo, never imports dbq directly (arch-lint forbids it).

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

	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	passwordResetTokenBytes  = 32
	passwordResetTokenPrefix = "smr_"
	// passwordResetTTLMinutes —— the operator reads stdout to know how many minutes
	// they have to use it; kept in sync with usecases.PasswordResetTTL.
	passwordResetTTLMinutes = 30
)

// resetToken —— the struct generateResetToken returns, to stay under
// function-result-limit.
type resetToken struct {
	plaintext string
	hash      []byte
}

// runPasswordReset —— the subcommand entry point. Connects to pg → fetches the sole
// owner → issues a token → prints the URL. Any failure returns an error; the caller
// (main) decides the exit code.
func runPasswordReset(log *slog.Logger, cfg *config.Config) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db, err := pgstore.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect pg: %w", err)
	}
	defer db.Close()
	return issueAndPrint(ctx, log, db)
}

func issueAndPrint(ctx context.Context, log *slog.Logger, db *pgstore.Pool) error {
	repo := owner.NewRepo(db)
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
			// Give up if stdout can't be written to; this shouldn't fail the
			// subcommand on its own.
			return
		}
	}
}

// passwordResetSubcommand —— main() dispatch: when argv[1] == "password-reset",
// runs the reset and returns an exit code (0 / 1). Any other argv takes the server
// path and returns -1.
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
