// layout.go —— renderer 状态机 + 共享 layout 常量。
//
// 所有度量用 PDF point (72/inch)。A4 = 595 x 842。

package resumerender

import (
	"fmt"

	"github.com/signintech/gopdf"
)

// 页边 + QR 大小 + 字号阶梯：改一处，全文档跟着变。
const (
	marginLeft   = 50.0
	marginRight  = 50.0
	marginTop    = 50.0
	marginBottom = 50.0
	pageWidth    = 595.0
	pageHeight   = 842.0
	contentWidth = pageWidth - marginLeft - marginRight

	qrPixelSize = 256 // PNG pixel resolution (rendered at qrPDFSize)
	qrPDFSize   = 110.0
	qrPadding   = 6.0

	fontSizeName    = 18.0
	fontSizeHeader  = 11.0
	fontSizeBody    = 9.5
	fontSizeSection = 12.0

	lineHeightBody    = 12.0
	lineHeightHeader  = 14.0
	lineHeightSection = 18.0
	gapAfterSection   = 8.0
	gapBetweenItems   = 6.0
)

// renderer —— 当前 cursor + pdf handle。所有 draw* 方法把 y 推进到
// 下一空白行，没有显式 page-break（v1 一页主义；超长走 truncate 而非
// 翻页，原因见 docs/design/job-loop.md L.9）。
type renderer struct {
	pdf *gopdf.GoPdf
	x   float64
	y   float64
}

// setFont —— 单点切换字体；err 上抛便于追溯（gopdf SetFont 报字号 0 之类）。
func (r *renderer) setFont(family string, size float64) error {
	if err := r.pdf.SetFont(family, "", size); err != nil {
		return fmt.Errorf("set font %s/%.1f: %w", family, size, err)
	}
	return nil
}

// writeAt —— 在 (x, y) 起点写 text，y 是 baseline。
func (r *renderer) writeAt(x, y float64, text string) error {
	r.pdf.SetXY(x, y)
	if err := r.pdf.Cell(nil, text); err != nil {
		return fmt.Errorf("cell %q: %w", text, err)
	}
	return nil
}

// writeLine —— 在当前 (r.x, r.y) 写一行，y 推进 lineHeight。
func (r *renderer) writeLine(text string, lineHeight float64) error {
	if err := r.writeAt(r.x, r.y, text); err != nil {
		return err
	}
	r.y += lineHeight
	return nil
}

// fitWidth —— 留给后续超长换行用；当前实现就直接 return text 满宽不分段。
// L.9 决策：v1 不做 wrap，content 设计上就 1-line bullet。
func fitWidth(text string, _ float64) string {
	return text
}

// chain —— 顺序跑 steps，遇到第一个 error 立刻返回。让多步 draw* 函数
// 把 cyclomatic / cognitive complexity 控在 ≤5 / ≤7（lint 上限）：把
// "做 N 件事，任一失败就退出"折成单一 for-range，分支数从 N 降到 2。
func chain(steps ...func() error) error {
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}
