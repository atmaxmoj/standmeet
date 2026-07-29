package obsidian

import "testing"

// TestExtFromContentType —— export attachment 扩展名规范化:常见类型给规范名(不是 mime 的字母序
// 首选,如 image/jpeg → .jpe),剥 "; charset" 参数,大小写不敏感,未知类型退 .bin。
func TestExtFromContentType(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"image/jpeg":                ".jpg", // 不是 mime 的 .jpe
		"image/jpeg; charset=utf-8": ".jpg", // 剥参数
		"IMAGE/PNG":                 ".png", // 大小写不敏感
		"application/pdf":           ".pdf",
		"text/markdown":             ".md",
		"image/svg+xml":             ".svg",
		"totally/unknown-xyz":       ".bin", // 未知 → 退 .bin
	}
	for ct, want := range cases {
		if got := extFromContentType(ct); got != want {
			t.Errorf("extFromContentType(%q) = %q, want %q", ct, got, want)
		}
	}
}
