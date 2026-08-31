// custom_page_serve.go —— 把一次构建的产物发出去，两边共用的那一份。
//
// 两个调用方，**差别只在看哪一次构建**：
//   - `/p/{slug}`                          → live build，任何人
//   - `/custom-pages/{slug}/preview/{tok}`  → 最近一次构建成功的，凭令牌
//
// 抽出来是因为下面那段里有**路径逃逸校验**（joinSafeAssetPath）。抄第二份的话，
// 迟早只有一边被修 —— 而没被修的那一边是能读到 BuildsRoot 之外文件的那一边。
//
// **这个文件不认识域**：它要的只是三个值（哪一页、哪一次构建、给不给自带 key），
// 由调用方算好递进来。认识域就等于面绕过出站收口直接够到域
// （`check-routes-via-dispatcher`），而它本来也不需要 —— 它是个文件服务器。

package public

import (
	"log/slog"
	"net/http"
)

// BuiltAsset —— 要发的是哪一次构建的产物。
type BuiltAsset struct {
	PageID     string
	BuildID    string
	AllowBYOAI bool
}

// BuildAssetReq —— 发一次构建产物要的全部东西。
type BuildAssetReq struct {
	Log *slog.Logger
	// Resolve —— **这一次该看哪一版构建**。两个调用方的唯一区别。
	Resolve    func() (BuiltAsset, error)
	BuildsRoot string
	// AssetPath —— URL 里 `*` 那一段（空 = 根入口，要注 <base>）。
	AssetPath string
	// BaseHref —— 根入口时注进 <head> 的 base。浏览器地址跟这条路径一致，
	// vite emit 的 `./assets/...` 才解析得对。**必须带尾斜杠**：没有它
	// `./` 解析到父目录，路径最后一段被丢掉，脚本 404、页面一片空白。
	BaseHref string
}

// ServeBuildAsset —— 解析构建 → 拼安全路径 → 发文件。
func ServeBuildAsset(w http.ResponseWriter, _ *http.Request, req *BuildAssetReq) {
	asset, err := req.Resolve()
	if err != nil {
		writeAssetErr(req.Log, w, err)
		return
	}
	fp, perr := joinSafeAssetPath(req.BuildsRoot, asset.PageID, asset.BuildID, req.AssetPath)
	if perr != nil {
		writeAssetErr(req.Log, w, perr)
		return
	}
	serveFile(req.Log, w, fp, pageHead{base: baseOf(req), allowBYOAI: asset.AllowBYOAI})
}

// baseOf —— 只有根入口才注 base；子资源请求注了反而会把相对路径再拐一层。
func baseOf(req *BuildAssetReq) string {
	if req.AssetPath != "" {
		return ""
	}
	return req.BaseHref
}
