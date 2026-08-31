// email_change.go —— 改邮箱：先证明新地址收得到信，才让它成为登录身份。
//
// **为什么不能当场换**：`owners.email` 这一列同时是**登录身份**和**恢复渠道**
// （recovery.go 的 `To:` 直接读它）。当场换就是把钥匙和备用钥匙一起交给一个还没被证明
// 存在的地址 —— 一个拼写错误同时拿掉两样。而 session 按 ownerID 发，owner 当场毫无感觉，
// 它在 session 过期那天才生效。
//
// **两条路，按出站通道分**：
//   - 有已验证的 mail connector → 走 pending：寄一封确认信，点开了才换。
//   - 没有 → 当场换。不能因为发不出信就把功能拿掉（那是把系统的限制转嫁成用户的纪律），
//     所以退化成前端的"输两遍" + 把后果说全。这跟 recovery phrase 那一行按 SMTP 灰/亮
//     是同一个模式（#115）。
//
// **pending 期间恢复短语仍寄旧地址** —— 新地址还没被证明，把救命通道交给它只是把洞
// 挪了个位置。这条不在这个文件里体现（recovery.go 读的是 Email 那一列，天然就对），
// 但它是这个设计成立的前提，有测试钉着。

package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

const (
	// emailTokenBytes —— 128-bit 随机。链接里那串就是它，猜不出来。
	emailTokenBytes = 16
	// emailConfirmWindow —— 确认链接的有效期。够 owner 换个设备去收信，
	// 又不至于让一封半年前的邮件还能换掉身份。
	emailConfirmWindow = 24 * time.Hour
	// confirmPath —— 信里那条链接的路径。前端有一页在这儿等着（app/confirm-email）。
	confirmPath = "/confirm-email?token="
)

// ErrPendingEmailExpired —— token 认得，但过期了。跟"认不出"分开，因为 owner
// 下一步该做什么取决于这两个词的区别：过期 → 再点一次保存；无效 → 这封信不是给你的。
var ErrPendingEmailExpired = errors.New("email confirmation link expired")

// EmailChangeDeps —— 改邮箱的依赖。Proxy 用来问"发得出信吗"以及把确认信送出去。
type EmailChangeDeps struct {
	Owners *repo.Repo
	Proxy  OutboundSender
}

// EmailChangeInput —— 请求改邮箱。
type EmailChangeInput struct {
	OwnerID         string
	CurrentPassword string
	NewEmail        string
}

// EmailChangeOutput —— 回执必须说清**发生了什么**，不是"成功了"。
// Pending 非空 = 寄了一封信，身份没动；空 = 当场换好了。界面上那两句话不一样。
type EmailChangeOutput struct {
	Email   string
	Pending string
}

// RequestEmailChange —— 验密码 → 校验邮箱 → 按出站通道决定走 pending 还是当场换。
func RequestEmailChange(
	ctx context.Context, deps EmailChangeDeps, in *EmailChangeInput,
) (EmailChangeOutput, error) {
	if verr := verifyCurrentPassword(ctx, AccountDeps{Owners: deps.Owners},
		in.OwnerID, in.CurrentPassword); verr != nil {
		return EmailChangeOutput{}, verr
	}
	normalized, nerr := normalizeEmail(in.NewEmail)
	if nerr != nil {
		return EmailChangeOutput{}, nerr
	}
	if !canConfirmByMail(ctx, deps, in.OwnerID) {
		return switchEmailNow(ctx, deps, in.OwnerID, normalized)
	}
	return startPendingEmailChange(ctx, deps, in.OwnerID, normalized)
}

// canConfirmByMail —— 这台实例现在发得出确认信吗。问不出来就当**发不出**：
// 这一步失败时如果按"发得出"走，owner 会看到"确认信已寄出"而那封信根本不存在，
// 然后他会一直等一封等不到的信。
func canConfirmByMail(ctx context.Context, deps EmailChangeDeps, ownerID string) bool {
	connected, err := deps.Proxy.Connected(ctx, ownerID)
	return err == nil && connected
}

// switchEmailNow —— 没有出站通道时的那条路：当场换。
// 不能因为发不出信就把功能拿掉（那是把系统的限制转嫁成用户的纪律），
// 保护退化成前端的双录入 + 把后果说全。
func switchEmailNow(
	ctx context.Context, deps EmailChangeDeps, ownerID, normalized string,
) (EmailChangeOutput, error) {
	updated, err := deps.Owners.UpdateEmail(ctx, ownerID, normalized)
	if err != nil {
		return EmailChangeOutput{}, fmt.Errorf("update email: %w", err)
	}
	return EmailChangeOutput{Email: updated.Email}, nil
}

// startPendingEmailChange —— 记下待确认 + 把确认链接寄到**新**地址。
// 寄给新地址是全部意义所在：收得到，才证明这个地址是真的。
func startPendingEmailChange(
	ctx context.Context, deps EmailChangeDeps, ownerID, newEmail string,
) (EmailChangeOutput, error) {
	token, terr := newEmailToken()
	if terr != nil {
		return EmailChangeOutput{}, terr
	}
	owner, oerr := deps.Owners.SetPendingEmail(
		ctx, ownerID, newEmail, hashEmailToken(token), time.Now().Add(emailConfirmWindow),
	)
	if oerr != nil {
		return EmailChangeOutput{}, fmt.Errorf("record pending email: %w", oerr)
	}
	if serr := deps.Proxy.Send(ctx, ownerID, OutboundNotice{
		To:    newEmail,
		Title: "Confirm your new StandMeet email",
		Body:  confirmNoticeBody(owner.PublicURL, token),
	}); serr != nil {
		return EmailChangeOutput{}, fmt.Errorf("send email confirmation: %w", serr)
	}
	return EmailChangeOutput{Email: owner.Email, Pending: newEmail}, nil
}

// ConfirmEmailChange —— 点开链接。命中就换身份并作废这条 token（一次性）。
func ConfirmEmailChange(
	ctx context.Context, deps EmailChangeDeps, token string,
) (entity.Owner, error) {
	// 空 token 不去问库：它跟"这封信是编的"是同一个答案，而我们在这里就知道。
	// 也别给它一句专属的错误 —— 那会告诉探路的人他离对的形状有多远。
	if token == "" {
		return entity.Owner{}, entity.ErrPendingEmailNotFound
	}
	hash := hashEmailToken(token)
	owner, err := deps.Owners.ConfirmPendingEmail(ctx, hash)
	if err == nil {
		return owner, nil
	}
	if !errors.Is(err, entity.ErrPendingEmailNotFound) {
		return entity.Owner{}, fmt.Errorf("confirm pending email: %w", err)
	}
	return entity.Owner{}, classifyConfirmMiss(ctx, deps, hash)
}

// classifyConfirmMiss —— 没换成，到底是过期还是压根不认得。
// 只对 token **确实存在**的人分辨；不存在就统一说不认得，不告诉猜的人他猜得对不对。
func classifyConfirmMiss(ctx context.Context, deps EmailChangeDeps, hash string) error {
	found, ferr := deps.Owners.FindByPendingToken(ctx, hash)
	if ferr != nil {
		return entity.ErrPendingEmailNotFound
	}
	if time.Now().After(found.ExpiresAt) {
		return ErrPendingEmailExpired
	}
	return entity.ErrPendingEmailNotFound
}

// CancelEmailChange —— owner 反悔。清掉之后那封信里的链接也就死了（hash 没了）。
func CancelEmailChange(
	ctx context.Context, deps EmailChangeDeps, ownerID string,
) (entity.Owner, error) {
	owner, err := deps.Owners.ClearPendingEmail(ctx, ownerID)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("cancel pending email: %w", err)
	}
	return owner, nil
}

func newEmailToken() (string, error) {
	b := make([]byte, emailTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate email token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// hashEmailToken —— sha256，不是 bcrypt。这条 token 是**唯一的查找键**（WHERE 精确匹配），
// 所以必须是确定性的；而它本身就是 128-bit 随机，不需要慢哈希去防字典。
func hashEmailToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func confirmNoticeBody(publicURL, token string) string {
	link := strings.TrimSuffix(publicURL, "/") + confirmPath + token
	return strings.Join([]string{
		"Someone (probably you) asked to change the email on your StandMeet instance.",
		"",
		"Open this link to confirm — until you do, your sign-in and your recovery",
		"phrase both stay on the old address:",
		"",
		link,
		"",
		"The link works once and expires in 24 hours. If this wasn't you, ignore",
		"this message and nothing changes.",
	}, "\n")
}
