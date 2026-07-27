// writings_multipart.go —— admin POST/PATCH /writings 接的 multipart 解析。
// 拆出来守 350-line cap。
//
// 形态：
//   field "data"            —— JSON writing fields (writingSaveRequest)
//   field "file:<pending>"  —— 每张内联 image 一个 form field，pending-id
//                              对应 body_md / cover_image_ref 里的占位

package admin

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

const maxWritingMultipartSize = 50 << 20 // 50MB

// parsedMultipart —— parseWritingMultipart 多返回打包（避开 funcresult-limit 2）。
// fieldalignment: slice 24B 先，struct 后。
type parsedMultipart struct {
	Files []corpus.FileInput
	Req   writingSaveRequest
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
	req, perr := decodeWritingJSON(r)
	if perr != nil {
		return parsedMultipart{}, perr
	}
	files, ferr := readUploadedFiles(r)
	if ferr != nil {
		return parsedMultipart{}, ferr
	}
	return parsedMultipart{Req: req, Files: files}, nil
}

func parseMultipartErr(err error) error {
	return errors.New("parse multipart: " + err.Error())
}

func decodeWritingJSON(r *http.Request) (writingSaveRequest, error) {
	raw := r.FormValue("data")
	if raw == "" {
		return writingSaveRequest{}, errors.New("missing 'data' field")
	}
	var req writingSaveRequest
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		return writingSaveRequest{}, errors.New("data: invalid JSON")
	}
	return req, nil
}

func readUploadedFiles(r *http.Request) ([]corpus.FileInput, error) {
	if r.MultipartForm == nil {
		return []corpus.FileInput{}, nil
	}
	return collectFileFields(r.MultipartForm.File)
}

func collectFileFields(
	files map[string][]*multipart.FileHeader,
) ([]corpus.FileInput, error) {
	out := make([]corpus.FileInput, 0)
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
	out []corpus.FileInput, name string, fhs []*multipart.FileHeader,
) ([]corpus.FileInput, error) {
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
) (corpus.FileInput, error) {
	if !filePendingFieldMatch(name, fhs) {
		return corpus.FileInput{}, errSkipFile
	}
	return readOneFile(strings.TrimPrefix(name, "file:"), fhs[0])
}

func filePendingFieldMatch(name string, fhs []*multipart.FileHeader) bool {
	return strings.HasPrefix(name, "file:") && len(fhs) > 0
}

func readOneFile(pendingID string, fh *multipart.FileHeader) (corpus.FileInput, error) {
	f, oerr := fh.Open()
	if oerr != nil {
		return corpus.FileInput{}, errors.New("open file: " + oerr.Error())
	}
	body, rerr := io.ReadAll(f)
	closeFileBestEffort(f)
	if rerr != nil {
		return corpus.FileInput{}, errors.New("read file: " + rerr.Error())
	}
	return corpus.FileInput{
		PendingID: pendingID, ContentType: fh.Header.Get("Content-Type"),
		OriginalFilename: fh.Filename, Body: body,
	}, nil
}

func closeFileBestEffort(f multipart.File) {
	if err := f.Close(); err != nil {
		_ = err
	}
}
