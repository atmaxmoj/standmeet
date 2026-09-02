// writings_multipart.go — multipart parsing for admin POST/PATCH /writings.
//
// Shape:
//   field "data"            — JSON writing fields (passed straight through, this layer
//                              never parses their shape)
//   field "file:<pending>"  — one form field per inline image; the pending-id
//                              corresponds to a placeholder in body_md / cover_image_ref
//
// This layer **only unpacks the envelope**: the JSON segment is handed to the op verbatim
// (the schema is the op's business, not the route's), and the byte segment becomes a
// carried file (dispatcher.File). It used to parse into the domain's corpus.FileInput and
// call SaveWriting itself — that was the path that bypassed the convergence point, because
// the convergence point had no channel for carrying bytes back then.

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

// filePendingPrefix — the form field prefix for an inline image. The op side extracts
// the pending-id using the same prefix (see carriedFilePrefix in
// corpus/ops/writings_create.go) — **the two must stay in sync**; when they don't, the
// symptom is: the image uploads, the placeholder in the body never gets replaced, and
// the page shows an empty image slot.
const filePendingPrefix = "file:"

// parsedMultipart — the unpacked envelope: the JSON segment + the carried bytes.
type parsedMultipart struct {
	Data  json.RawMessage
	Files []dispatcher.File
}

func parseWritingMultipart(w http.ResponseWriter, r *http.Request) (parsedMultipart, error) {
	// ParseMultipartForm itself only caps the in-memory portion; MaxBytesReader bounds
	// the reader upstream, returning 413 on overage instead of blowing up memory.
	// Passing w lets net/http mark the connection as broken on overage (after a 413 the
	// client no longer attempts keepalive). gosec G120's warning conflicts with this
	// defense — MaxBytesReader already backstops it, so the suppression is an
	// explanatory nolint.
	r.Body = http.MaxBytesReader(w, r.Body, maxWritingMultipartSize)
	// #nosec G120 -- already bounded upstream by MaxBytesReader.
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

// writingDataField extracts the JSON segment. **It only validates that it's legal
// JSON**; whether the fields are correct is the op's business — validating that again
// here would just be a second schema, and two schemas eventually stop agreeing.
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

// writingSaveArgs — the JSON handed up by the panel → the op's args.
//
// Only does two things: fills in the URL's writing_id, and renames `cover_image_ref` to
// the op's `cover_image_asset_id`. **Every other field passes through verbatim** —
// copying it field by field would just build a second shape at this layer, and that's
// exactly how the same capability starts growing two different forms on two facades.
//
// That rename is itself a small debt: the panel's field is called ref (it can be a
// `pending-<id>` placeholder), the op's is called asset_id. Same thing, two names —
// reconciled here so it doesn't keep propagating downward.
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

// renameCoverRef — the panel calls it cover_image_ref (it can be a `pending-<id>`
// placeholder), the op calls it cover_image_asset_id. Same thing, two names —
// reconciled here so it doesn't keep propagating downward.
func renameCoverRef(fields map[string]json.RawMessage) {
	ref, ok := fields["cover_image_ref"]
	if !ok {
		return
	}
	delete(fields, "cover_image_ref")
	fields["cover_image_asset_id"] = ref
}

// putWritingID — on edit the id is in the URL, not the body; on create there's none.
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

// errSkipFile — sentinel: this form field isn't in file:<pending> shape, skip it.
// A sentinel avoids the nilnil lint (returning (nil, nil) would be meaningless).
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

// readOneFile carries the field name **verbatim** (`file:<pending-id>`). This layer
// doesn't unpack it further: how pending-id matches up with the body's placeholder is
// the op's knowledge.
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
