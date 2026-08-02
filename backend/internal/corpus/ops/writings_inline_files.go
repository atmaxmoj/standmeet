// writings_inline_files.go —— writing_create 的内联配图:按 https 地址取回字节。
//
// **这就是"字节流"的真相**:进来的是一串地址,不是流。取回来的这一步一直在服务端,
// 所以这条操作从来都能当一个普通的 JSON op 声明 —— 见 writings_create.go 的说明。
//
// 守卫**不在这里**,在 usecase.FetchMedia:取一份素材要过的那几关(只认 https、
// 不许够到内网、白名单而不是前缀匹配、不信对方声明的类型、上限按 kind 分)对
// "一篇 writing 的配图"和"一条 wiki 的配图"是同一件事。
//
// 这里曾经有过自己的一套,而且是错的:`strings.HasPrefix(ct, "image/")` 会放 image/svg+xml
// 进来,SVG 里能塞 <script>,存下来再由我们的地址发出去就是存储型 XSS;声明的 Content-Type
// 又被当成证据,声明 image/png 实际发 SVG 字节也能过。两条都是"只有一个调用方,于是守卫
// 只按那一个调用方写"的产物 —— 素材成为独立一步之后,守卫也该只有一份。

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

// fetchInlineFiles —— writing_create 的 files 数组按 URL 拉 bytes →
// 返 []FileInput 给 SaveWriting。任一失败 → 整批 fail (atomic)。
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
