// writings_inline_files.go — writing_create's inline images: fetching bytes back by an
// https address.
//
// **This is the real story behind "byte stream"**: what comes in is a list of addresses,
// not a stream. The fetch step has always lived on the server, so this operation has always
// been declarable as an ordinary JSON op — see the note in writings_create.go.
//
// The guard **doesn't live here**, it lives in usecase.FetchMedia: the checks a piece of
// media must pass to be fetched (https only, no reaching into the internal network,
// allowlist rather than prefix matching, don't trust the declared content type, size caps
// split by kind) are the exact same thing for "an image on a writing" and "an image on a
// wiki entry".
//
// This file used to have its own version of that, and it was wrong:
// `strings.HasPrefix(ct, "image/")` lets image/svg+xml through, SVG can carry a <script>
// tag, and storing it then serving it back from our own address is stored XSS; on top of
// that, the declared Content-Type was trusted as evidence, so declaring image/png while
// actually sending SVG bytes also got through. Both bugs came from the same source: "only
// one caller exists, so the guard was written for just that one caller" — now that media
// fetching is its own independent step, the guard should be a single shared one too.

package ops

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

type writingFileRef struct {
	PendingID string `json:"pending_id"`
	URL       string `json:"url"`
}

// fetchInlineFiles — pulls bytes by URL for each entry in writing_create's files array →
// returns []FileInput for SaveWriting. Any single failure → the whole batch fails (atomic).
func fetchInlineFiles(
	ctx context.Context, files []writingFileRef,
) ([]usecase.FileInput, error) {
	if len(files) == 0 {
		return []usecase.FileInput{}, nil
	}
	out := make([]usecase.FileInput, 0, len(files))
	for i := range files {
		fi, ferr := fetchOneInlineFile(ctx, i, &files[i])
		if ferr != nil {
			return nil, ferr
		}
		out = append(out, fi)
	}
	return out, nil
}

func fetchOneInlineFile(
	ctx context.Context, idx int, f *writingFileRef,
) (usecase.FileInput, error) {
	if f.PendingID == "" {
		return usecase.FileInput{}, fmt.Errorf("files[%d]: pending_id is required", idx)
	}
	if f.URL == "" {
		return usecase.FileInput{}, fmt.Errorf("files[%d]: url is required", idx)
	}
	media, ferr := usecase.FetchMedia(ctx, &usecase.FetchMediaInput{URL: f.URL})
	if ferr != nil {
		return usecase.FileInput{}, fmt.Errorf("files[%d]: %w", idx, ferr)
	}
	return usecase.FileInput{
		PendingID: f.PendingID, ContentType: media.ContentType,
		OriginalFilename: media.Filename, Body: media.Body,
	}, nil
}
