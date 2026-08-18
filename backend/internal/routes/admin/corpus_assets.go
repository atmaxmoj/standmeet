// corpus_assets.go —— 面板往一条语料上挂文件、把挂错的撤下来。
//
// 挂文件有**两条来路,同一件事**:
//
//	owner 通过 AI    给的是一个 https 地址(图在图床上)—— JSON body,直接走收口那条 op
//	owner 在面板上   给的是字节(文件在他机器里)—— multipart,走这里
//
// 为什么不逼面板也交地址:那要求 owner 先把文件传到别处、拿到公网链接、再贴回来。
// 那不是一个人会用的东西 —— 面板上他手里只有一个文件挑选框。
//
// 两条走的是**同一个 op**(assets.upload)。字节不塞进 args,而是作为随行文件挂在这次调用
// 上(fp.WithFiles),op 那边合流。这样面板这条也在收口的账上,装饰器链照套 ——
// 而不是像 writings 那条 multipart 一样直连域、绕过收口(它还在基线里欠着)。
//
// 这一层只负责把 multipart 拆开,不判能不能收 —— 判两遍就是两套判据,迟早分叉。

package admin

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// maxAssetUploadSize —— 这一层的粗闸,拦住"整台机器被一个请求吃掉"。
// 真正按 kind 分的上限在 usecase 的素材守卫里 —— 那才是判据,这里只是别让内存先炸。
const maxAssetUploadSize = 60 << 20

const assetFileField = "file"

const opAssetsUpload = "assets.upload"

// attachCorpusAsset —— POST /corpus/{genre}/{id}/assets。按 Content-Type 分两条来路,
// **同一个 op**:JSON 走普通取用,multipart 走 OpFiles(这个面的档案得载得动 fp.Multipart,
// 载不动就在组装期炸,而不是运行时静静回一个 404)。
func (h *Handlers) attachCorpusAsset() http.HandlerFunc {
	byURL := h.dispatchOp(h.Corpus.Face, opAssetsUpload, corpusEntryArgs, jsonCreated)
	withFiles := h.Corpus.Face.MustOpFiles(opAssetsUpload)
	byBytes := h.attachUploadedFile(&withFiles)
	return func(w http.ResponseWriter, r *http.Request) {
		if !isMultipart(r) {
			byURL(w, r)
			return
		}
		byBytes(w, r)
	}
}

func isMultipart(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data")
}

func (h *Handlers) attachUploadedFile(op *dispatcher.Op) http.HandlerFunc {
	invoke := op.Invoke
	return func(w http.ResponseWriter, r *http.Request) {
		req, perr := readAssetRequest(w, r)
		if perr != nil {
			writeError(h.Log, w, envBadReq(perr.Error()))
			return
		}
		h.runAssetUpload(w, r, invoke, &req)
	}
}

// assetRequest —— 这次上传的两半:路径/表单来的入参,加上随行的那份字节。
type assetRequest struct {
	Args   json.RawMessage
	Upload assetUpload
}

func readAssetRequest(w http.ResponseWriter, r *http.Request) (assetRequest, error) {
	upload, perr := readAssetUpload(w, r)
	if perr != nil {
		return assetRequest{}, perr
	}
	args, aerr := uploadArgs(r, upload.Kind)
	if aerr != nil {
		return assetRequest{}, aerr
	}
	return assetRequest{Args: args, Upload: upload}, nil
}

// uploadArgs —— 这次上传的 op 入参：路径上的 genre + id，外加表单里选的类别。
func uploadArgs(r *http.Request, kind string) (json.RawMessage, error) {
	args, err := corpusEntryArgs(r)
	if err != nil {
		return nil, err
	}
	return argsWithKind(args, kind)
}

// argsWithKind —— 把表单里选的类别并进 op 的入参。
//
// 这一步以前不存在（F-L-48）：`kind` 从 multipart 里读进 `assetUpload.Kind`，然后**没有
// 任何人读那个字段** —— `corpusEntryArgs` 只从路径拼 genre + id。于是面板上传的每一份文件
// 到 op 那儿 kind 都是空的，媒体守卫按默认的 image 白名单查，PDF 一律被拒
// （*"content-type application/pdf is not accepted for image"*）。屏幕上那个 attachment
// 选项因此是个装饰：owner 在面板上永远挂不上一份 PDF，而 attachment 这个类别就是为它存在的。
//
// e2e 没抓到，是因为面板那几条用例**从没碰过那个下拉框**，一直用默认类别传图；MCP 那条路
// 自己在 JSON 里带 kind，所以那一侧一直是对的（[[test-covers-capability-not-face]]）。
func argsWithKind(args json.RawMessage, kind string) (json.RawMessage, error) {
	if kind == "" {
		return args, nil
	}
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(args, &fields); err != nil {
		return nil, dispatcher.BadInput("invalid request")
	}
	fields["kind"] = quoteJSON(kind)
	return marshalArgs(fields)
}

func (h *Handlers) runAssetUpload(
	w http.ResponseWriter, r *http.Request, invoke dispatcher.Invoke, req *assetRequest,
) {
	// 字节随行:op 那边靠它分辨这次是"面板递的文件"还是"AI 递的地址"。
	ctx := dispatcher.WithFiles(r.Context(), []dispatcher.File{{
		Field: assetFileField, Filename: req.Upload.Filename,
		ContentType: req.Upload.ContentType, Body: req.Upload.Body,
	}})
	out, err := invoke(ctx, middleware.OwnerIDFrom(r.Context()), req.Args)
	if err != nil {
		// 跟其它经收口的路由同一条翻译:收口只给协议无关的类别,状态码是本面的事。
		h.writeOpError(w, opAssetsUpload, err)
		return
	}
	writeStatusBody(h.Log, w, http.StatusCreated, out)
}

// assetUpload —— multipart 里拆出来的那一份文件。
type assetUpload struct {
	Filename    string
	ContentType string
	Kind        string
	Body        []byte
}

// readAssetUpload —— 拆 multipart:一个 file field,外加 kind(可选,默认 image)。
//
// ContentType 取**浏览器报的那个**,原样往下传 —— 下游按字节签名核对它,对不上就拒。
// 在这里先信一遍再传下去,等于给守卫喂一个已经被认可过的值。
func readAssetUpload(w http.ResponseWriter, r *http.Request) (assetUpload, error) {
	if err := parseAssetForm(w, r); err != nil {
		return assetUpload{}, err
	}
	return readAssetFileField(r)
}

func parseAssetForm(w http.ResponseWriter, r *http.Request) error {
	// ParseMultipartForm 只 cap 内存里那段;MaxBytesReader 限 reader 上游,
	// 超了返 413 而不是把内存吃光。
	r.Body = http.MaxBytesReader(w, r.Body, maxAssetUploadSize)
	// #nosec G120 -- 上游已有 MaxBytesReader bound。
	if err := r.ParseMultipartForm(maxAssetUploadSize); err != nil {
		return errors.New("could not read the uploaded file: " + err.Error())
	}
	return nil
}

func readAssetFileField(r *http.Request) (assetUpload, error) {
	file, hdr, ferr := r.FormFile(assetFileField)
	if ferr != nil {
		return assetUpload{}, errors.New("no file was attached to this upload")
	}
	defer closeUpload(file)
	body, rerr := io.ReadAll(file)
	if rerr != nil {
		return assetUpload{}, errors.New("could not read the uploaded file")
	}
	return assetUpload{
		Filename: hdr.Filename, ContentType: hdr.Header.Get("Content-Type"),
		Kind: r.FormValue("kind"), Body: body,
	}, nil
}

func closeUpload(f multipart.File) {
	if err := f.Close(); err != nil {
		_ = err
	}
}
