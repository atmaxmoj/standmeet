// custom_page_preview.go —— owner 在面板上看这一页长什么样。
//
//	GET /api/v1/custom-pages/{slug}/preview/{token}
//	GET /api/v1/custom-pages/{slug}/preview/{token}/*
//
// **为什么这一条要存在**：`/p/{slug}` 服务的是 **live**。而真正在写这些页的是 Claude
// （面板 intro 自己写着 "creates / builds / promotes via MCP"），于是 agent 建完到 owner
// 点头之间的那一版，owner 没有任何地方看得见 —— 而那恰恰是他要看的那一版。
// owner 的原话："让我有 panel 能看效果，然后我在指挥 agent 改的时候实时能让我看到就好。"
//
// **为什么凭令牌而不是 session**：预览跑在 `sandbox="allow-scripts"` 的 iframe 里
// （不给 allow-same-origin —— 否则 owner 的 AI 写出来的页面拿得到 owner 的 admin session）。
// 沙箱化的不透明来源**子资源不带 cookie**：文档 200，里面的 `<script>` 401，页面全白。
// 实测日志：`/preview` → 200 441B，`/preview/assets/index-*.js` → 401 70B。
// 所以凭据走**路径**（不是 query —— `<base href>` 上的 query 不被相对路径继承）。
//
// **这个文件不认识域**：验令牌和解析构建都是**注进来的函数**，装配根供给。
// 面直接够到域就是绕过出站收口（`check-routes-via-dispatcher`），而这一层本来
// 也只需要"给我一个 ownerID"和"给我那一次构建"两个答案。

package public

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// CustomPagePreviewHandlers —— 预览要的东西。两个函数由装配根注入。
type CustomPagePreviewHandlers struct {
	Log *slog.Logger
	// VerifyToken —— 令牌对得上就给出它属于哪个 owner。对不上返回 error。
	VerifyToken func(slug, token string) (string, error)
	// ResolveBuild —— 这个 owner 的这一页，最近一次构建成功的那一版。
	ResolveBuild func(ctx context.Context, ownerID, slug string) (BuiltAsset, error)
	BuildsRoot   string
}

// Mount 挂预览两条路到 /api/v1。
func (h *CustomPagePreviewHandlers) Mount(r chi.Router) {
	r.Get("/custom-pages/{slug}/preview/{token}", h.previewAsset())
	r.Get("/custom-pages/{slug}/preview/{token}/*", h.previewAsset())
}

func (h *CustomPagePreviewHandlers) previewAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 预览**永远不缓存**：owner 打开它就是为了看最新那一版，
		// 而一个被缓存住的预览会让他以为 agent 什么都没做。
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		slug, token := chi.URLParam(r, "slug"), chi.URLParam(r, "token")
		// ctx 在闭包**外面**取：闭包里再调 r.Context() 的话，静态检查看不出它
		// 传下去了（contextcheck），而人读起来也分不清用的是哪一刻的 ctx。
		ctx := r.Context()
		ServeBuildAsset(w, r, &BuildAssetReq{
			Log:        h.Log,
			BuildsRoot: h.BuildsRoot,
			Resolve:    func() (BuiltAsset, error) { return h.resolve(ctx, slug, token) },
			AssetPath:  chi.URLParam(r, "*"),
			BaseHref:   "/api/v1/custom-pages/" + slug + "/preview/" + token + "/",
		})
	}
}

// resolve —— 验令牌 → 解析构建。令牌不对时**照 not-found 说** ——
// 不告诉拿着错令牌的人他离对的形状有多远。
func (h *CustomPagePreviewHandlers) resolve(
	ctx context.Context, slug, token string,
) (BuiltAsset, error) {
	ownerID, verr := h.VerifyToken(slug, token)
	if verr != nil {
		return BuiltAsset{}, verr
	}
	return h.ResolveBuild(ctx, ownerID, slug)
}
