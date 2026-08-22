// runtime_body.go —— 请求体这一段：JSONata 求值 → 必填 pre-flight → **按 spec 声明的媒体类型编码**。
//
// 从 runtime.go 拆出来（那边到了 350 行的闸）。拆的是一整族，不是随手切一刀：
// 「这一次请求的 body 长什么样、怎么编」是一个话题，URL、认证、响应解析各是另一个。

package openapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

// renderBody —— request JSONata → 请求体 reader。pre-flight 校验必填字段（缺 → 拒，不发畸形
// 请求）。无体 → nil reader（合法空）。
func renderBody(ob *opBinding, input any, required []string, media string) (io.Reader, error) {
	body, err := ob.evalRequest(input)
	if err != nil {
		return nil, err
	}
	if verr := checkRequired(body, required); verr != nil {
		return nil, verr
	}
	if body == nil {
		return nil, nil
	}
	return encodeBody(body, media)
}

// encodeBody —— 按 **spec 声明的媒体类型**编码（F-C-54）。以前这里无条件 `json.Marshal`，
// 于是一个声明表单编码的 vendor 收到的是 JSON —— 它不会说「格式不对」，它只是看不见任何字段
// （真 Mailgun 的原话：`400 from parameter is missing`）。Mailgun / Twilio / Stripe 都是这一类。
//
// multipart 目前**明说不支持**而不是悄悄按别的发：发错编码在对面眼里是「你没给这些字段」，
// 那种错误会把排查的人送去检查一份完全正确的 binding。
func encodeBody(body any, media string) (io.Reader, error) {
	switch media {
	case "application/x-www-form-urlencoded":
		return encodeForm(body)
	case "multipart/form-data":
		return nil, fmt.Errorf("%w: this operation declares multipart/form-data",
			ErrUnsupportedBodyMedia)
	default:
		raw, merr := json.Marshal(body)
		if merr != nil {
			return nil, fmt.Errorf("marshal request body: %w", merr)
		}
		return bytes.NewReader(raw), nil
	}
}

// ErrUnsupportedBodyMedia —— spec 声明的请求体编码这台实例发不出来。**说出来**，别退回 JSON：
// 退回去的话对面回的是「字段没给」，而 binding 是对的。
var ErrUnsupportedBodyMedia = errors.New("unsupported request body media type")

// encodeForm —— 平对象 → `a=1&b=2`。表单没有嵌套，所以嵌套值是**绑定写错了**，直接说清楚，
// 不悄悄塞一段 JSON 进某个字段里。
func encodeForm(body any) (io.Reader, error) {
	m, ok := body.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: a form body must be a flat object", ErrUnsupportedBodyMedia)
	}
	form := url.Values{}
	for k, v := range m {
		s, serr := formValue(v)
		if serr != nil {
			return nil, fmt.Errorf("%w: field %q", serr, k)
		}
		form.Set(k, s)
	}
	return strings.NewReader(form.Encode()), nil
}

// formValue —— 一个表单字段的值。字符串/数字/布尔可以；嵌套不行。
func formValue(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case bool, float64, int, int64:
		return fmt.Sprint(t), nil
	default:
		return "", ErrUnsupportedBodyMedia
	}
}

// checkRequired —— body 缺任一必填字段（缺键或值 null）→ ErrMissingRequired（pre-flight 拒）。
func checkRequired(body any, required []string) error {
	if len(required) == 0 {
		return nil
	}
	m, ok := body.(map[string]any)
	if !ok {
		m = nil // 非对象 body → 视作所有必填都缺
	}
	for _, f := range required {
		if fieldMissing(m, f) {
			return fmt.Errorf("%w: %q", ErrMissingRequired, f)
		}
	}
	return nil
}
