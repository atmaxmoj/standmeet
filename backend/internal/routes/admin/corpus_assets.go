// corpus_assets.go — lets the panel attach a file to a corpus entry, and take back one
// attached by mistake.
//
// Attaching a file has **two routes, one thing**:
//
//	owner via AI     hands over an https address (the image lives on an image host) —
//	                 JSON body, goes straight through the convergence point's op
//	owner in panel   hands over bytes (the file is on their machine) — multipart, goes
//	                 through here
//
// Why not force the panel to hand over an address too: that would require the owner to
// first upload the file elsewhere, get a public link, and paste it back in. That's not
// something a person would do — in the panel all they have is a file picker.
//
// Both routes go through **the same op** (assets.upload). The bytes aren't stuffed into
// args; they ride along as a file attached to this call (fp.WithFiles), and the op merges
// them. This keeps the panel's route on the convergence point's books too, with the
// decorator chain applying the same way — instead of connecting straight to the domain
// and bypassing the convergence point the way the writings multipart route still does
// (still owed against the baseline).
//
// This layer's only job is to unpack the multipart form; it never decides whether the
// upload is acceptable — judging that twice means two sets of criteria, which will
// eventually diverge.

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

// maxAssetUploadSize — this layer's coarse gate, stopping "one request eats the whole
// machine's memory". The real per-kind limits live in the usecase's asset guard — that's
// the actual criterion; this is just to keep memory from blowing up first.
const maxAssetUploadSize = 60 << 20

const assetFileField = "file"

const opAssetsUpload = "assets.upload"

// attachCorpusAsset — POST /corpus/{genre}/{id}/assets. Splits into two routes by
// Content-Type, **the same op**: JSON goes through the ordinary invocation, multipart
// goes through OpFiles (this facade's registration must be able to carry fp.Multipart —
// if it can't, it panics at assembly time, not silently return a 404 at runtime).
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

// assetRequest — the two halves of this upload: the args from the path/form, plus the
// bytes riding along with it.
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

// uploadArgs — this upload's op args: genre + id from the path, plus the kind picked in
// the form.
func uploadArgs(r *http.Request, kind string) (json.RawMessage, error) {
	args, err := corpusEntryArgs(r)
	if err != nil {
		return nil, err
	}
	return argsWithKind(args, kind)
}

// argsWithKind merges the kind picked in the form into the op's args.
//
// This step didn't used to exist (F-L-48): `kind` was read from the multipart form into
// `assetUpload.Kind`, and then **nothing ever read that field** — `corpusEntryArgs` only
// assembled genre + id from the path. So every file the panel uploaded arrived at the op
// with an empty kind; the media guard checked it against the default image allowlist, and
// every PDF was rejected (*"content-type application/pdf is not accepted for image"*).
// The attachment option on screen was therefore decorative: the owner could never attach
// a PDF from the panel, even though the attachment kind exists specifically for it.
//
// e2e never caught it because the panel's test cases **never touched that dropdown** —
// they always uploaded images with the default kind; MCP's path carries kind in its JSON
// itself, so that side was always correct ([[test-covers-capability-not-face]]).
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
	// The bytes ride along: the op side uses their presence to tell "the panel handed a
	// file" apart from "AI handed an address".
	ctx := dispatcher.WithFiles(r.Context(), []dispatcher.File{{
		Field: assetFileField, Filename: req.Upload.Filename,
		ContentType: req.Upload.ContentType, Body: req.Upload.Body,
	}})
	out, err := invoke(ctx, middleware.OwnerIDFrom(r.Context()), req.Args)
	if err != nil {
		// Same translation as every other convergence-point route: the convergence point
		// only gives a protocol-agnostic category, the status code is this facade's own
		// business.
		h.writeOpError(w, opAssetsUpload, err)
		return
	}
	writeStatusBody(h.Log, w, http.StatusCreated, out)
}

// assetUpload — the file unpacked from the multipart form.
type assetUpload struct {
	Filename    string
	ContentType string
	Kind        string
	Body        []byte
}

// readAssetUpload unpacks the multipart form: one file field, plus an optional kind
// (defaults to image).
//
// ContentType is taken **as the browser reported it** and passed straight through —
// downstream checks it against the byte signature and rejects a mismatch. Trusting it
// once here before passing it on would just be feeding the guard a value that's already
// been vouched for.
func readAssetUpload(w http.ResponseWriter, r *http.Request) (assetUpload, error) {
	if err := parseAssetForm(w, r); err != nil {
		return assetUpload{}, err
	}
	return readAssetFileField(r)
}

func parseAssetForm(w http.ResponseWriter, r *http.Request) error {
	// ParseMultipartForm only caps the in-memory portion; MaxBytesReader bounds the
	// reader upstream, so an overage returns 413 instead of exhausting memory.
	r.Body = http.MaxBytesReader(w, r.Body, maxAssetUploadSize)
	// #nosec G120 -- already bounded upstream by MaxBytesReader.
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
