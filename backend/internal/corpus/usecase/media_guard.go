// media_guard.go —— 按 owner 给的地址取一份素材回来,以及取回时的全部守卫。
//
// 地址是 **owner 递进来的**,服务端拿它发请求 —— 这一步天然是 SSRF 的口子,取回来的字节
// 又要由我们自己的地址发出去。所以守卫有两半:
//
// 出去那一半
//   - 只认 https
//   - BlockInternalEgress:公网长相的域名也可能解析/跳转到内网
//
// 回来那一半
//   - **白名单,不是前缀匹配**。`image/*` 会放 image/svg+xml 进来,而 SVG 里能塞 <script>,
//     存下来再由我们的地址发出去就是存储型 XSS。前缀匹配读着像白名单,不是。
//   - **不信对方声明的类型**。Content-Type 是对方说的,不是证据:声明 image/png、实际发 SVG
//     字节,只看 header 的实现会放它过去,然后这份"PNG"以 SVG 的身份被浏览器执行。所以要按
//     **字节签名**核对,声明与实际不一致就拒。
//   - **上限按读到的字节算**,不信 Content-Length —— 声明一个小的、发一个大的是最基本的绕法。
//   - **上限按 kind 分**。一段视频天生比一张图大;拿同一个数卡它等于禁掉视频。

package usecase

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const mediaFetchTimeout = 15 * time.Second

// mediaFetchUA —— 取素材时自报家门。**不是装饰**：好几个大站（Wikimedia 最典型）
// 的机器人策略要求描述性 UA，对 HTTP 库的默认值直接 403。带上产品名和项目地址，
// 是这类抓取的通行做法 —— 对方要限流或者要联系我们时找得到人。
const mediaFetchUA = "StandMeet/0.1 (self-hosted; +https://github.com/atmaxmoj/standmeet)"

// 按 kind 的体积上限。一段视频天生比一张图大 —— 同一个数卡两者等于禁掉视频。
const (
	maxImageBytes      = 10 << 20 // 配图 / hero
	maxAttachmentBytes = 25 << 20 // 附件(PDF 等)
	maxVideoBytes      = 50 << 20 // 视频(正文里的短片 / 演示录屏)
)

// mediaKinds —— 每种用途收哪些类型。**显式白名单**:前缀匹配会把 image/svg+xml 放进来。
//
// svg 不在表里,而且永远不该进来:它是可执行文档,不是图片。
var mediaKinds = map[string]map[string]int64{
	entity.AssetKindImage: {
		"image/png":  maxImageBytes,
		"image/jpeg": maxImageBytes,
		"image/gif":  maxImageBytes,
		"image/webp": maxImageBytes,
		"image/avif": maxImageBytes,
		"video/mp4":  maxVideoBytes, // 正文里放一段短视频跟放一张动图是同一件事
		"video/webm": maxVideoBytes,
	},
	entity.AssetKindAttachment: {
		"application/pdf": maxAttachmentBytes,
		"text/plain":      maxAttachmentBytes,
		"text/markdown":   maxAttachmentBytes,
		"text/csv":        maxAttachmentBytes,
		"application/zip": maxAttachmentBytes,
		"video/mp4":       maxVideoBytes,
		"image/png":       maxImageBytes,
		"image/jpeg":      maxImageBytes,
	},
}

// FetchedMedia —— 取回来的一份素材。
type FetchedMedia struct {
	ContentType string
	Filename    string
	Body        []byte
}

// FetchMediaInput —— 取一份素材要的东西。
type FetchMediaInput struct {
	URL      string
	Kind     string
	Filename string
}

// FetchMedia —— 按地址取一份素材,过全部守卫。
func FetchMedia(ctx context.Context, in *FetchMediaInput) (FetchedMedia, error) {
	allowed, kerr := allowedTypes(in.Kind)
	if kerr != nil {
		return FetchedMedia{}, kerr
	}
	if verr := httpsOnly(in.URL); verr != nil {
		return FetchedMedia{}, verr
	}
	resp, ferr := getOverHTTP(ctx, in.URL)
	if ferr != nil {
		return FetchedMedia{}, ferr
	}
	defer closeBestEffort(resp.Body)
	return readGuarded(resp, in, allowed)
}

// AcceptMediaInput —— owner 从自己机器上选的一份文件。**没有地址**,字节已经在手里。
type AcceptMediaInput struct {
	Filename   string
	Kind       string
	DeclaredCT string
	Body       []byte
}

// AcceptMedia —— 收一份直接递进来的字节,过**回来那一半**守卫。
//
// 出去那一半(https / BlockInternalEgress)在这里没有对应物:没有地址,服务端不发请求,
// SSRF 这个口子根本不存在。回来那一半一条都不能少 —— 一份 owner 亲手选的文件同样会由
// 我们的地址发出去,声明 image/png 实际是 SVG,照样是自家域上的存储型 XSS。owner
// 不是攻击者,但递给他的那个文件挑选框是。
//
// 两条路(按地址取 / 直接收字节)最后汇到同一处:白名单按 kind 查、上限按 kind 分、
// 真实字节跟声明对得上。分成两份实现,就等于给其中一条留了一条没人守的路。
func AcceptMedia(in *AcceptMediaInput) (FetchedMedia, error) {
	allowed, kerr := allowedTypes(in.Kind)
	if kerr != nil {
		return FetchedMedia{}, kerr
	}
	declared := baseType(in.DeclaredCT)
	limit, ok := allowed[declared]
	if !ok {
		return FetchedMedia{}, fmt.Errorf("%w: content-type %s is not accepted for %s",
			entity.ErrMediaRejected, declared, kindOrImage(in.Kind))
	}
	// 上限同样按**手里这些字节**算 —— 浏览器报的大小跟远端报的 Content-Length 一样不算证据。
	if int64(len(in.Body)) > limit {
		return FetchedMedia{}, fmt.Errorf(
			"%w: body exceeds the %d byte limit", entity.ErrMediaRejected, limit)
	}
	if serr := bytesAgree(in.Body, declared); serr != nil {
		return FetchedMedia{}, serr
	}
	return FetchedMedia{Body: in.Body, ContentType: declared, Filename: in.Filename}, nil
}

func allowedTypes(kind string) (map[string]int64, error) {
	if kind == "" {
		kind = entity.AssetKindImage
	}
	allowed, ok := mediaKinds[kind]
	if !ok {
		return nil, fmt.Errorf("%w: kind %q", entity.ErrMediaRejected, kind)
	}
	return allowed, nil
}

func httpsOnly(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: parse url: %s", entity.ErrMediaRejected, err.Error())
	}
	if u.Scheme != "https" {
		return fmt.Errorf("%w: only https URLs allowed, got %q", entity.ErrMediaRejected, u.Scheme)
	}
	return nil
}

func getOverHTTP(ctx context.Context, rawURL string) (*http.Response, error) {
	// BlockInternalEgress —— 地址是 owner 给的、没有白名单:这一步不能够到内网
	// (元数据端点 / 内部服务)。上面的 https 检查不够 —— 一个公网长相的域名可以解析
	// 或跳转到内网地址。
	client := httpx.NewClient(httpx.Options{
		Timeout: mediaFetchTimeout, BlockInternalEgress: true,
	})
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if rerr != nil {
		return nil, fmt.Errorf("%w: build request: %s", entity.ErrMediaRejected, rerr.Error())
	}
	// 自报家门。不带 UA 的话 Go 发的是 `Go-http-client/2.0`，而**要求描述性 UA 的主机
	// 会直接 403** —— Wikimedia 就是其中之一，而「从维基百科贴一张图」正是 owner 最常做的
	// 一件事。于是这条路在最常见的来源上不通，owner 只看到一句 `status 403`（F-P-7）。
	// 带上产品名和地址是这类抓取的通行做法：对方要限流或联系我们时找得到人。
	req.Header.Set("User-Agent", mediaFetchUA)
	resp, herr := client.Do(req)
	if herr != nil {
		return nil, fmt.Errorf("%w: fetch: %s", entity.ErrMediaRejected, herr.Error())
	}
	if resp.StatusCode != http.StatusOK {
		closeBestEffort(resp.Body)
		return nil, fmt.Errorf("%w: status %d", entity.ErrMediaRejected, resp.StatusCode)
	}
	return resp, nil
}

// readGuarded —— 读回来 + 三条守卫:声明的类型在白名单里、真实字节跟声明一致、没超上限。
func readGuarded(
	resp *http.Response, in *FetchMediaInput, allowed map[string]int64,
) (FetchedMedia, error) {
	declared := baseType(resp.Header.Get("Content-Type"))
	limit, ok := allowed[declared]
	if !ok {
		return FetchedMedia{}, fmt.Errorf("%w: content-type %s is not accepted for %s",
			entity.ErrMediaRejected, declared, in.Kind)
	}
	body, rerr := readAtMost(resp.Body, limit)
	if rerr != nil {
		return FetchedMedia{}, rerr
	}
	if serr := bytesAgree(body, declared); serr != nil {
		return FetchedMedia{}, serr
	}
	return FetchedMedia{
		Body: body, ContentType: declared,
		Filename: pickFilename(in.Filename, resp.Request.URL.Path),
	}, nil
}

// readAtMost —— **按读到的字节**判上限,不看 Content-Length:声明一个小的、发一个大的
// 是最基本的绕法。多读一个字节就知道超了,不必把整份读完。
func readAtMost(r io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %s", entity.ErrMediaRejected, err.Error())
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("%w: body exceeds the %d byte limit", entity.ErrMediaRejected, limit)
	}
	return body, nil
}

// bytesAgree —— 真实字节跟声明的类型对不对得上。**声明是对方说的,不是证据。**
//
// 判据是**字节签名**,不是 http.DetectContentType:后者认不出 webp / mp4 / avif,更认不出
// SVG(它没有 SVG 签名),于是 `声明 image/png、实际发 SVG 字节` 会被它读成 text/plain
// 一路放过去 —— 然后这份"PNG"由我们的地址发出去,以 SVG 的身份在浏览器里执行。
//
// 认得签名的类型就必须对上;认不得的(纯文本那几种)退回到"至少不能是可执行文档"。
func bytesAgree(body []byte, declared string) error {
	sigs, known := mediaMagic[declared]
	if !known {
		return notExecutableDoc(body, declared)
	}
	for _, sig := range sigs {
		if sig.matches(body) {
			return nil
		}
	}
	return fmt.Errorf(
		"%w: declared %s but the bytes are not %s — content mismatch",
		entity.ErrMediaRejected, declared, declared)
}

// notExecutableDoc —— 没有字节签名可查的类型(纯文本那几种)至少得挡住可执行文档:
// 声明 text/plain、实际发一页 HTML,存下来再由我们的地址发出去就是自家域上的 XSS。
func notExecutableDoc(body []byte, declared string) error {
	sniffed := baseType(http.DetectContentType(body))
	if !executableDoc(sniffed) {
		return nil
	}
	return fmt.Errorf(
		"%w: declared %s but the bytes are %s — a document that can execute is not media",
		entity.ErrMediaRejected, declared, sniffed)
}

// magic —— 一条字节签名:在 offset 处应当是 want 这几个字节。
type magic struct {
	want   []byte
	offset int
}

func (m magic) matches(body []byte) bool {
	end := m.offset + len(m.want)
	return len(body) >= end && bytes.Equal(body[m.offset:end], m.want)
}

// mediaMagic —— 认得签名的类型。任一条对上即可(gif 有两个版本号,avif 也是 ftyp 家族)。
var mediaMagic = map[string][]magic{
	"image/png":       {{want: []byte("\x89PNG\r\n\x1a\n")}},
	"image/jpeg":      {{want: []byte("\xff\xd8\xff")}},
	"image/gif":       {{want: []byte("GIF87a")}, {want: []byte("GIF89a")}},
	"image/webp":      {{want: []byte("RIFF")}},
	"image/avif":      {{offset: 4, want: []byte("ftyp")}},
	"video/mp4":       {{offset: 4, want: []byte("ftyp")}},
	"video/webm":      {{want: []byte("\x1a\x45\xdf\xa3")}},
	"application/pdf": {{want: []byte("%PDF")}},
	"application/zip": {{want: []byte("PK\x03\x04")}},
}

// executableDoc —— 浏览器会当文档执行的类型。SVG 和 HTML 都能带脚本。
func executableDoc(t string) bool {
	switch t {
	case "text/html", "image/svg+xml", "text/xml", "application/xml":
		return true
	default:
		return false
	}
}

func baseType(ct string) string {
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = ct[:i]
	}
	return strings.ToLower(strings.TrimSpace(ct))
}

func pickFilename(given, urlPath string) string {
	if given != "" {
		return given
	}
	if i := strings.LastIndex(urlPath, "/"); i >= 0 {
		return urlPath[i+1:]
	}
	return urlPath
}

func closeBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

// MediaRejected —— 这个错误是不是"这份素材不收"(调用方的输入问题,不是本机故障)。
func MediaRejected(err error) bool { return errors.Is(err, entity.ErrMediaRejected) }
