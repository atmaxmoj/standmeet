// writings_multipart.go —— admin POST/PATCH /writings 接的 multipart 解析。
//
// 形态：
//   field "data"            —— JSON writing fields（原样往下传,不在这一层解形状）
//   field "file:<pending>"  —— 每张内联 image 一个 form field，pending-id
//                              对应 body_md / cover_image_ref 里的占位
//
// 这一层**只拆信封**:JSON 段原样交给 op(schema 是 op 的事,不是路由的),字节段变成
// 随行文件(dispatcher.File)。以前它解成域的 corpus.FileInput、再自己调 SaveWriting ——
// 那是绕过收口的那条路,原因是收口当时没有携带字节的通道。

package admin

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

const maxWritingMultipartSize = 50 << 20

// filePendingPrefix —— 内联图片的 form field 前缀。op 那边按同一个前缀取 pending-id
// (见 corpus/ops/writings_create.go 的 carriedFilePrefix) —— **两处必须一致**,
// 不一致的表现是:图传上去了、正文里的占位没被替换,页面上一个空图位。
const filePendingPrefix = "file:"

// parsedMultipart —— 拆开的信封:JSON 段 + 随行字节。
type parsedMultipart struct {
	Data  json.RawMessage
	Files []dispatcher.File
}

func parseWritingMultipart(w http.ResponseWriter, r *http.Request) (parsedMultipart, error) {
	// ParseMultipartForm 自身只 cap 内存里那段；用 MaxBytesReader 限 reader
	// 上游，超过返 413 不爆内存。w 传过去让 net/http 在超限时把连接标记为
	// 已损坏 (返 413 后客户端不再尝试 keepalive)。gosec G120 的告警跟这层
	// 防御冲突 —— 已经有 MaxBytesReader 兜底，suppress 标记说明性 nolint。
	r.Body = http.MaxBytesReader(w, r.Body, maxWritingMultipartSize)
	// #nosec G120 -- 上游已有 MaxBytesReader bound。
	if err := r.ParseMultipartForm(maxWritingMultipartSize); err != nil {
		return parsedMultipart{}, parseMultipartErr(err)
	}
	return decodeWritingFromForm(r)
}

func decodeWritingFromForm(r *http.Request) (parsedMultipart, error) {
	data, perr := writingDataField(r)
	if perr != nil {
		return parsedMultipart{}, perr
	}
	files, ferr := readUploadedFiles(r)
	if ferr != nil {
		return parsedMultipart{}, ferr
	}
	return parsedMultipart{Data: data, Files: files}, nil
}

func parseMultipartErr(err error) error {
	return errors.New("parse multipart: " + err.Error())
}

// writingDataField —— 取出 JSON 段。**只验它是不是合法 JSON**,字段对不对是 op 的事:
// 在这儿再验一遍就是第二份 schema,而两份 schema 迟早说不到一块儿去。
func writingDataField(r *http.Request) (json.RawMessage, error) {
	raw := r.FormValue("data")
	if raw == "" {
		return nil, errors.New("missing 'data' field")
	}
	if !json.Valid([]byte(raw)) {
		return nil, errors.New("data: invalid JSON")
	}
	return json.RawMessage(raw), nil
}

// writingSaveArgs —— 面板递上来的 JSON → op 的入参。
//
// 只做两件事:补上 URL 上的 writing_id,和把 `cover_image_ref` 改名成 op 的
// `cover_image_asset_id`。**其余字段原样透传** —— 逐字段抄一遍就是在这一层再造一份形状,
// 而那正是同一个能力在两个面长成两个样子的开头。
//
// 那个改名本身是一笔小债:面板的字段叫 ref(它可以是 `pending-<id>` 占位),op 的叫
// asset_id。同一个东西两个名字,先在这里对上,别让它继续往下传。
func writingSaveArgs(data json.RawMessage, writingID string) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, errors.New("data: expected a JSON object")
	}
	renameCoverRef(fields)
	putWritingID(fields, writingID)
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, errors.New("data: " + err.Error())
	}
	return out, nil
}

// renameCoverRef —— 面板叫 cover_image_ref(可以是 `pending-<id>` 占位),op 叫
// cover_image_asset_id。同一个东西两个名字,在这里对上,别让它继续往下传。
func renameCoverRef(fields map[string]json.RawMessage) {
	ref, ok := fields["cover_image_ref"]
	if !ok {
		return
	}
	delete(fields, "cover_image_ref")
	fields["cover_image_asset_id"] = ref
}

// putWritingID —— 改的时候 id 在 URL 上,不在 body 里;建的时候没有。
func putWritingID(fields map[string]json.RawMessage, writingID string) {
	if writingID == "" {
		return
	}
	fields["writing_id"] = json.RawMessage(strconv.Quote(writingID))
}

func readUploadedFiles(r *http.Request) ([]dispatcher.File, error) {
	if r.MultipartForm == nil {
		return []dispatcher.File{}, nil
	}
	return collectFileFields(r.MultipartForm.File)
}

func collectFileFields(
	files map[string][]*multipart.FileHeader,
) ([]dispatcher.File, error) {
	out := make([]dispatcher.File, 0)
	for name, fhs := range files {
		next, err := appendOneFile(out, name, fhs)
		if err != nil {
			return nil, err
		}
		out = next
	}
	return out, nil
}

// errSkipFile —— sentinel：这个 form field 不是 file:<pending> 形态，跳过。
// 用 sentinel 避免 nilnil lint （返 (nil, nil) 没意义）。
var errSkipFile = errors.New("skip-non-file-field")

func appendOneFile(
	out []dispatcher.File, name string, fhs []*multipart.FileHeader,
) ([]dispatcher.File, error) {
	fi, err := readUploadedFileEntry(name, fhs)
	if errors.Is(err, errSkipFile) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	return append(out, fi), nil
}

func readUploadedFileEntry(
	name string, fhs []*multipart.FileHeader,
) (dispatcher.File, error) {
	if !filePendingFieldMatch(name, fhs) {
		return dispatcher.File{}, errSkipFile
	}
	return readOneFile(name, fhs[0])
}

func filePendingFieldMatch(name string, fhs []*multipart.FileHeader) bool {
	return strings.HasPrefix(name, filePendingPrefix) && len(fhs) > 0
}

// readOneFile —— field 名**原样**带过去(`file:<pending-id>`)。这一层不拆它:
// pending-id 怎么跟正文里的占位对上,是 op 的知识。
func readOneFile(field string, fh *multipart.FileHeader) (dispatcher.File, error) {
	f, oerr := fh.Open()
	if oerr != nil {
		return dispatcher.File{}, errors.New("open file: " + oerr.Error())
	}
	body, rerr := io.ReadAll(f)
	closeFileBestEffort(f)
	if rerr != nil {
		return dispatcher.File{}, errors.New("read file: " + rerr.Error())
	}
	return dispatcher.File{
		Field: field, ContentType: fh.Header.Get("Content-Type"),
		Filename: fh.Filename, Body: body,
	}, nil
}

func closeFileBestEffort(f multipart.File) {
	if err := f.Close(); err != nil {
		_ = err
	}
}
