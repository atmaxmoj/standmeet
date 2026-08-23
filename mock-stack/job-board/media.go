// media.go —— 素材托管方的替身。
//
// owner 手上的图/视频在别人家(图床 / 网盘 / 随便哪个 https 地址),后端按地址去取。
// 这里就是那个"别人家"。
//
// 一半是**该收的**:png / gif / webp / mp4 / pdf —— "多媒体"不是只有 png。
// 另一半是**该拒的**,而且每一条都对应一种具体的绕法:
//
//	svg          image/* 前缀匹配会放它进来,但 SVG 里能塞 <script> —— 前缀匹配不是白名单
//	page.html    附件放宽之后的下界:HTML 存下来再由我们的域名发出去 = 自家域上的 XSS
//	lying.png    声明 image/png,实际是 SVG 字节 —— 声明的类型是**调用方说的**,不是证据
//	bulk?mb=&type= 发指定量的字节;上限按 kind 分,同样 11MB 当图片超标、当视频正常
//	missing.png  取不到就是取不到,不该落一行指向空处的 asset
//	not-an-image 当图片用却不是图片
//
// 只测得到 happy path 的守卫等于没有守卫。

package main

import (
	"net/http"
	"strconv"
	"strings"
)

// pixelPNG —— 1x1 透明 PNG,最小合法字节流。跟 e2e fixture 里那份是同一张图。
var pixelPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

// tinyGIF —— 1x1 GIF87a。owner 贴一张动图是再正常不过的事。
var tinyGIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
	0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x2c, 0x00, 0x00, 0x00, 0x00,
	0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
}

// tinyWebP —— 最小 WebP(RIFF....WEBPVP8 )。
var tinyWebP = append(
	[]byte("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00"),
	make([]byte, 14)...,
)

// tinyMP4 —— ftyp box。视频也是"多媒体"的一部分。
var tinyMP4 = append(
	[]byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"),
	make([]byte, 64)...,
)

// svgWithScript —— 合法 SVG,里面带脚本。image/* 前缀匹配会放它进来。
var svgWithScript = []byte(
	`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
)

// mediaFile —— 一条素材路径发什么。
type mediaFile struct {
	contentType string
	body        []byte
}

// mediaFiles —— 路径 → 发什么。声明的类型跟真实字节**故意在 lying.png 那条上不一致**。
var mediaFiles = map[string]mediaFile{
	"pixel.png":        {"image/png", pixelPNG},
	uaRequired:         {"image/png", pixelPNG},
	"anim.gif":         {"image/gif", tinyGIF},
	"shot.webp":        {"image/webp", tinyWebP},
	"clip.mp4":         {"video/mp4", tinyMP4},
	"paper.pdf":        {"application/pdf", append([]byte("%PDF-1.4\n"), make([]byte, 2048)...)},
	"vector.svg":       {"image/svg+xml", svgWithScript},
	"lying.png":        {"image/png", svgWithScript}, // 声明是 PNG,字节是 SVG
	"page.html":        {"text/html; charset=utf-8", []byte("<script>alert(1)</script>")},
	"not-an-image.txt": {"text/plain; charset=utf-8", []byte("this is not an image")},
}

// uaRequired —— 这个文件名**要求一个像样的 User-Agent**，否则 403。
//
// 真世界里这不是边角：Wikimedia 的机器人策略明确要求描述性 UA，对着默认的
// `Go-http-client/…` 直接 403 —— 而「从维基百科贴一张图」正是 owner 最可能做的一件事。
// 替身比真实世界客气的话，产品会一路绿到 owner 手里才第一次撞上
// （[[stand-in-is-politer-than-reality]]）。
const uaRequired = "ua-required.png"

// descriptiveUA —— 什么样算「像样」：非空，而且不是 HTTP 库的默认值。
// 判的是**默认值**而不是某个白名单：白名单会把「我们换了个 UA」也判成违规。
func descriptiveUA(ua string) bool {
	if ua == "" {
		return false
	}
	return !strings.HasPrefix(ua, "Go-http-client/") &&
		!strings.HasPrefix(ua, "python-requests/") &&
		!strings.HasPrefix(ua, "curl/")
}

// serveMedia —— 按文件名发。表里没有 → 404(missing.png 走这条)。
func (s *server) serveMedia(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("filename")
	if name == uaRequired && !descriptiveUA(r.Header.Get("User-Agent")) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("clients must send a descriptive User-Agent"))
		return
	}
	f, ok := mediaFiles[name]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", f.contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(f.body)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(f.body)
}

// serveMediaBulk —— 发指定 MB 数的字节,类型由 query 决定。
//
// 上限要按**读到的字节**算,不能信 Content-Length:声明一个小的、发一个大的是最基本的绕法,
// 所以这里干脆不发 Content-Length。
//
// 用它撑起"上限按 kind 分"这件事:同样 11MB,当图片是超标,当视频是正常 —— 一段视频天生
// 比一张图大,拿同一个数卡它等于禁掉视频。
func (s *server) serveMediaBulk(w http.ResponseWriter, r *http.Request) {
	mb, err := strconv.Atoi(r.URL.Query().Get("mb"))
	if err != nil || mb <= 0 {
		mb = 11
	}
	ct := r.URL.Query().Get("type")
	if ct == "" {
		ct = "image/png"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(http.StatusOK)
	// 头几个字节是**真的**:消费方按字节签名核对声明的类型(声明 png 发 SVG 是最基本的
	// 伪装),一份全零的"mp4"会被正当地拒掉,那样这条用例测的就不是体积了。
	head := bulkHeads[ct]
	if _, err := w.Write(head); err != nil {
		return
	}
	chunk := make([]byte, 64<<10)
	for sent := len(head); sent < mb<<20; sent += len(chunk) {
		if _, err := w.Write(chunk); err != nil {
			return
		}
	}
}

// bulkHeads —— 每种类型的真实开头。跟消费方那张签名表对应。
var bulkHeads = map[string][]byte{
	"image/png":  []byte("\x89PNG\r\n\x1a\n"),
	"image/jpeg": []byte("\xff\xd8\xff"),
	"image/gif":  []byte("GIF89a"),
	"image/webp": []byte("RIFF\x00\x00\x00\x00WEBP"),
	"video/mp4":  []byte("\x00\x00\x00\x18ftypmp42"),
}
