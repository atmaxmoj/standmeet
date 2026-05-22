// sections.go —— header / summary / works 渲染段。每个段 returns error
// so 上层 Render 链式聚合（不吞错误）。

package resumerender

import (
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// drawHeader —— name + contact line + 可选 links line +（URL 非空时）右上角 QR。
// 拆 drawHeaderText / placeQR 把 cognitive-complexity 控在 ≤7。
func (r *renderer) drawHeader(id *domain.ResumeIdentity, qrURL string) error {
	if qrURL != "" {
		if err := r.placeQR(qrURL); err != nil {
			return err
		}
	}
	return r.drawHeaderText(id)
}

func (r *renderer) drawHeaderText(id *domain.ResumeIdentity) error {
	linksLine := joinLinks(id.Links)
	steps := []func() error{
		func() error { return r.setFont("bold", fontSizeName) },
		func() error { return r.writeLine(id.Name, lineHeightSection) },
		func() error { return r.setFont("body", fontSizeHeader) },
		func() error { return r.writeLine(joinContact(id), lineHeightHeader) },
	}
	if linksLine != "" {
		steps = append(steps, func() error { return r.writeLine(linksLine, lineHeightHeader) })
	}
	if err := chain(steps...); err != nil {
		return err
	}
	r.y += gapAfterSection
	return nil
}

func (r *renderer) placeQR(url string) error {
	img, qrErr := renderQR(url)
	if qrErr != nil {
		return qrErr
	}
	xRight := pageWidth - marginRight - qrPDFSize
	yTop := marginTop - qrPadding
	box := &rect{W: qrPDFSize, H: qrPDFSize}
	if drawErr := r.pdf.ImageFrom(img, xRight, yTop, box); drawErr != nil {
		return fmt.Errorf("draw qr: %w", drawErr)
	}
	return nil
}

func (r *renderer) drawSummary(summary string) error {
	if summary == "" {
		return nil
	}
	if err := r.setFont("body", fontSizeBody); err != nil {
		return err
	}
	if err := r.writeLine(fitWidth(summary, contentWidth), lineHeightBody); err != nil {
		return err
	}
	r.y += gapAfterSection
	return nil
}

func (r *renderer) drawWorks(works []domain.ResumeWork) error {
	if len(works) == 0 {
		return nil
	}
	if err := r.drawSectionTitle("EXPERIENCE"); err != nil {
		return err
	}
	for i := range works {
		if err := r.drawWorkEntry(&works[i]); err != nil {
			return err
		}
	}
	r.y += gapAfterSection
	return nil
}

func (r *renderer) drawWorkEntry(w *domain.ResumeWork) error {
	title := fmt.Sprintf("%s — %s", w.Title, w.Company)
	subtitle := fmt.Sprintf("%s · %s", w.Location, formatPeriod(&w.Period))
	steps := []func() error{
		func() error { return r.setFont("bold", fontSizeBody) },
		func() error { return r.writeLine(title, lineHeightBody) },
		func() error { return r.setFont("body", fontSizeBody) },
		func() error { return r.writeLine(subtitle, lineHeightBody) },
		func() error { return r.drawBullets(w.Bullets) },
	}
	if err := chain(steps...); err != nil {
		return err
	}
	r.y += gapBetweenItems
	return nil
}

func (r *renderer) drawBullets(bullets []string) error {
	for _, b := range bullets {
		if err := r.writeLine("  • "+fitWidth(b, contentWidth), lineHeightBody); err != nil {
			return err
		}
	}
	return nil
}

func (r *renderer) drawSectionTitle(label string) error {
	if err := r.setFont("bold", fontSizeSection); err != nil {
		return err
	}
	return r.writeLine(label, lineHeightSection)
}

func joinContact(id *domain.ResumeIdentity) string {
	parts := nonEmpty([]string{id.Email, id.Phone, id.LocationLine})
	return joinSep(parts, " · ")
}

func joinLinks(links []domain.ResumeLink) string {
	out := make([]string, 0, len(links))
	for i := range links {
		l := &links[i]
		if l.URL == "" {
			continue
		}
		if l.Label == "" {
			out = append(out, l.URL)
			continue
		}
		out = append(out, fmt.Sprintf("%s: %s", l.Label, l.URL))
	}
	return joinSep(out, " · ")
}

func formatPeriod(p *domain.ResumePeriod) string {
	if p.End == nil || *p.End == "" {
		return p.Start + " – Present"
	}
	return fmt.Sprintf("%s – %s", p.Start, *p.End)
}

func nonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func joinSep(in []string, sep string) string {
	return strings.Join(in, sep)
}
