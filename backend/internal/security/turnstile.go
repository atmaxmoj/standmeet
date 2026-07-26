// turnstile.go —— Cloudflare Turnstile siteverify 实现。
//
// API 文档：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// 请求：POST https://challenges.cloudflare.com/turnstile/v0/siteverify
//   body (application/x-www-form-urlencoded):
//     secret   — server-side secret
//     response — 前端 widget callback 得到的 token
//     remoteip — 客户端 IP（可选，建议给）
// 响应 JSON：
//   { success: bool, error-codes: [...], hostname, action, cdata }
//
// 失败 → 一律包成 ErrCaptchaFailed 抛回；handler 翻成 401。详细错误码写日志
// 不外吐，避免给攻击者侧通道。

package security

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

const turnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

type turnstileVerifier struct {
	client *http.Client
	secret string
}

func newTurnstileVerifier(secret string, client *http.Client) *turnstileVerifier {
	if client == nil {
		client = defaultHTTPClient()
	}
	return &turnstileVerifier{client: client, secret: secret}
}

type turnstileResp struct {
	Hostname   string   `json:"hostname"`
	ErrorCodes []string `json:"error-codes"`
	Success    bool     `json:"success"`
}

func (v *turnstileVerifier) Verify(ctx context.Context, token, remoteIP string) error {
	if token == "" {
		return fmt.Errorf("%w: missing token", ErrCaptchaFailed)
	}
	resp, err := v.postVerify(ctx, token, remoteIP)
	if err != nil {
		return err
	}
	if !resp.Success {
		slog.Default().Warn(
			"turnstile verify rejected",
			"error_codes", resp.ErrorCodes, "hostname", resp.Hostname,
		)
		return fmt.Errorf("%w: %v", ErrCaptchaFailed, resp.ErrorCodes)
	}
	return nil
}

func (v *turnstileVerifier) postVerify(
	ctx context.Context, token, remoteIP string,
) (turnstileResp, error) {
	form := url.Values{}
	form.Set("secret", v.secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, rerr := http.NewRequestWithContext(
		ctx, http.MethodPost, turnstileVerifyURL,
		strings.NewReader(form.Encode()),
	)
	if rerr != nil {
		return turnstileResp{}, fmt.Errorf("%w: build request: %w", ErrCaptchaFailed, rerr)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpResp, derr := v.client.Do(req)
	if derr != nil {
		return turnstileResp{}, fmt.Errorf("%w: siteverify unreachable: %w", ErrCaptchaFailed, derr)
	}
	defer closeAndIgnore(httpResp.Body)
	var parsed turnstileResp
	if jerr := json.NewDecoder(httpResp.Body).Decode(&parsed); jerr != nil {
		return turnstileResp{}, fmt.Errorf("%w: decode response: %w", ErrCaptchaFailed, jerr)
	}
	return parsed, nil
}

func closeAndIgnore(c io.Closer) {
	if err := c.Close(); err != nil {
		slog.Default().Warn("close response body", "err", err)
	}
}
