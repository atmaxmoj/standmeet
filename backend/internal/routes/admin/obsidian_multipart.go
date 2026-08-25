// obsidian_multipart.go —— 把一次 vault 上传的 multipart 请求**流式**读成 VaultFile。
//
// 从 obsidian.go 分出来:那边是两个 endpoint 的编排(谁调谁、错误怎么回),这边是一件独立的事
// —— 一个可能有上千个 part 的请求怎么读完而不把它整份物化。两者的变更理由不同。

package admin

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/obsidian"
)

// parseImportMultipart —— **流式**读 part,不用 ParseMultipartForm。
//
// 为什么不能用 ParseMultipartForm:它把整个表单先缓冲下来,而 Go 的 mime/multipart.ReadForm 对
// 一张表单的 part 数有个 **1000 的硬上限**,超了整个请求报 "message too large"。那个数字我们从
// 没声明过,也调不了 —— 而 maxObsidianImportSize 是**字节**(200MB),跟它毫不相干。
// 结果就是:一个 574 wiki + 435 raw 的真实 vault(过完客户端过滤 1033 个文件)导不进来,而负载
// 只有 6.2MB,连声明额度的 4% 都不到。实测边界:999 个 part 成功,1001 个 part 400(F-L-20)。
//
// 换成 NextPart() 逐个读,是把「自建 git 服务怎么吞一个仓库」翻译过来:forge 收 packfile 是
// **一个流、边读边处理**,对象再多也碰不到任何 part 计数 —— 因为它压根不把请求拆成 N 份缓冲。
// 这里同理:一次一个 part,读完就转成 VaultFile,没有全表单物化,也就没有份数上限。
// 字节数仍由 MaxBytesReader 兜住,那才是我们**声明过**的那道限制。
func parseImportMultipart(
	w http.ResponseWriter, r *http.Request,
) ([]obsidian.VaultFile, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxObsidianImportSize)
	mr, merr := r.MultipartReader()
	if merr != nil {
		return nil, fmt.Errorf("parse multipart: %w", merr)
	}
	return streamVaultFiles(mr, r)
}

// streamVaultFiles —— 逐个 part 读完整个请求,读一个丢一个,不留整表单。
func streamVaultFiles(mr *multipart.Reader, r *http.Request) ([]obsidian.VaultFile, error) {
	acc := &vaultParts{files: make([]obsidian.VaultFile, 0), form: url.Values{}}
	for {
		p, err := mr.NextPart()
		if err != nil {
			return acc.done(err, r)
		}
		acc.take(p)
	}
}

// vaultParts —— 流式读的累加器。读错先记下来,等流走完再一起报:半路 return 会把剩下的 part
// 留在连接上,客户端拿到的是一个断掉的写。
type vaultParts struct {
	err   error
	form  url.Values
	files []obsidian.VaultFile
}

func (a *vaultParts) take(p *multipart.Part) {
	defer closeBestEffort(p)
	body, rerr := io.ReadAll(p)
	if rerr != nil {
		a.err = fmt.Errorf("read vault file %q: %w", p.FormName(), rerr)
		return
	}
	a.put(p.FormName(), p.FileName(), body)
}

// put —— 有 filename 的是 vault 文件;其余是普通表单值(authoritative 就走这条)。
// field 名携带完整 rel;剥可能的 vault-name 前缀让 path 从 vault root 算起(genre 前缀保留)。
func (a *vaultParts) put(name, filename string, body []byte) {
	if filename == "" {
		a.form.Set(name, string(body))
		return
	}
	a.files = append(a.files, obsidian.VaultFile{
		RelPath: normalizeVaultRel(name), Body: body,
	})
}

// done —— 流结束。非文件 part 回填进 r.Form:走 MultipartReader 之后 r.FormValue 不再自己解析,
// 不回填的话 authoritative 标记会静默丢失,一次「整个 vault」的同步就退化成只增不删。
func (a *vaultParts) done(err error, r *http.Request) ([]obsidian.VaultFile, error) {
	r.Form = a.form
	if a.err != nil {
		return nil, a.err
	}
	if !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	return a.files, nil
}

func closeBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

// normalizeVaultRel —— webkitRelativePath 首段若是 vault 文件夹名(非 genre)则剥掉,让 path 从
// vault root 算起(owner 选 my-vault/,filename = "my-vault/wiki/x.md" → "wiki/x.md")。首段本身就是
// genre(wiki/…,如直接上传或测试)则原样保留 —— 否则 genre 会被误当 vault 名剥掉。
func normalizeVaultRel(name string) string {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) == 2 && stripsVaultPrefix(parts[0]) {
		return parts[1]
	}
	return name
}

// stripsVaultPrefix —— 首段是要剥的 vault 文件夹名:既非 genre 又非 dotdir(.obsidian config 要留)。
func stripsVaultPrefix(seg string) bool {
	return !obsidian.IsVaultTopFolder(seg) && !strings.HasPrefix(seg, ".")
}
