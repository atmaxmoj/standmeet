// Package resumerender —— ResumeContent → PDF bytes (vector, ATS-friendly).
//
// Layout 永远固定（L.9 决策）：一栏；header (identity + QR top-right) →
// summary → works → projects (STAR) → educations → skills。字体永远
// Go Regular + Go Bold (golang.org/x/image/font/gofont) —— ATS 友好
// (sans-serif 单字体族)，零文件绑定。
//
// QR 渲染：URL 非空时右上角 110pt 方框 PNG；空时跳过（preview-only
// 模式下 Phase 3 还没 commit、code 还没 issue，但 Phase 2 spec 默认
// 用 placeholder URL）。
package resumerender

import (
	"bytes"
	"fmt"
	"image"

	"github.com/signintech/gopdf"
	"github.com/skip2/go-qrcode"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"

	"github.com/wangsijie/standmeet/internal/domain"
)

// Render —— 给定 content + QR URL（可空），返回 PDF bytes。
func Render(content *domain.ResumeContent, qrURL string) ([]byte, error) {
	pdf := newDoc()
	if err := loadFonts(pdf); err != nil {
		return nil, err
	}

	pdf.AddPage()
	r := &renderer{pdf: pdf, x: marginLeft, y: marginTop}

	if err := r.drawAll(content, qrURL); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if _, err := pdf.WriteTo(&buf); err != nil {
		return nil, fmt.Errorf("write pdf: %w", err)
	}
	return buf.Bytes(), nil
}

func (r *renderer) drawAll(c *domain.ResumeContent, qrURL string) error {
	return chain(
		func() error { return r.drawHeader(&c.Identity, qrURL) },
		func() error { return r.drawSummary(c.Summary) },
		func() error { return r.drawWorks(c.Works) },
		func() error { return r.drawProjects(c.Projects) },
		func() error { return r.drawEducations(c.Educations) },
		func() error { return r.drawSkills(c.Skills) },
	)
}

func newDoc() *gopdf.GoPdf {
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: *gopdf.PageSizeA4})
	return pdf
}

func loadFonts(pdf *gopdf.GoPdf) error {
	if err := pdf.AddTTFFontByReader("body", bytes.NewReader(goregular.TTF)); err != nil {
		return fmt.Errorf("load body font: %w", err)
	}
	if err := pdf.AddTTFFontByReader("bold", bytes.NewReader(gobold.TTF)); err != nil {
		return fmt.Errorf("load bold font: %w", err)
	}
	return nil
}

// renderQR —— 直接拿 image.Image，不走 PNG 编码再解码这一道。go-qrcode 的
// Image() 失败只可能来自 url 太长（>4KB binary capacity）—— pre-check 长度
// 在 caller。
func renderQR(url string) (image.Image, error) {
	qr, err := qrcode.New(url, qrcode.Medium)
	if err != nil {
		return nil, fmt.Errorf("build qr: %w", err)
	}
	return qr.Image(qrPixelSize), nil
}
