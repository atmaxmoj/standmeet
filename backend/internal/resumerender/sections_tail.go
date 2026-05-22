// sections_tail.go —— projects (STAR) / educations / skills 三段。
// rect 别名给 sections.go 用。

package resumerender

import (
	"fmt"

	"github.com/signintech/gopdf"

	"github.com/wangsijie/standmeet/internal/domain"
)

func (r *renderer) drawProjects(projects []domain.ResumeProject) error {
	if len(projects) == 0 {
		return nil
	}
	if err := r.drawSectionTitle("PROJECTS"); err != nil {
		return err
	}
	for i := range projects {
		if err := r.drawProjectEntry(&projects[i]); err != nil {
			return err
		}
	}
	r.y += gapAfterSection
	return nil
}

func (r *renderer) drawProjectEntry(p *domain.ResumeProject) error {
	steps := []func() error{
		func() error { return r.setFont("bold", fontSizeBody) },
		func() error { return r.writeLine(p.Name, lineHeightBody) },
		func() error { return r.setFont("body", fontSizeBody) },
		func() error { return r.drawSTARBlock(p) },
		func() error { return r.drawProjectSupplementary(p.Supplementary) },
	}
	if err := chain(steps...); err != nil {
		return err
	}
	r.y += gapBetweenItems
	return nil
}

func (r *renderer) drawSTARBlock(p *domain.ResumeProject) error {
	for _, line := range []struct{ label, body string }{
		{"Situation", p.Situation},
		{"Task", p.Task},
		{"Action", p.Action},
		{"Result", p.Result},
	} {
		if err := r.drawSTARLine(line.label, line.body); err != nil {
			return err
		}
	}
	return nil
}

func (r *renderer) drawProjectSupplementary(text string) error {
	if text == "" {
		return nil
	}
	body := "  " + fitWidth(text, contentWidth)
	return r.writeLine(body, lineHeightBody)
}

func (r *renderer) drawSTARLine(label, body string) error {
	if body == "" {
		return nil
	}
	return r.writeLine(fmt.Sprintf("  %s: %s", label, fitWidth(body, contentWidth)), lineHeightBody)
}

func (r *renderer) drawEducations(edus []domain.ResumeEducation) error {
	if len(edus) == 0 {
		return nil
	}
	if err := r.drawSectionTitle("EDUCATION"); err != nil {
		return err
	}
	for i := range edus {
		if err := r.drawEducationEntry(&edus[i]); err != nil {
			return err
		}
	}
	r.y += gapAfterSection
	return nil
}

func (r *renderer) drawEducationEntry(e *domain.ResumeEducation) error {
	if err := r.setFont("bold", fontSizeBody); err != nil {
		return err
	}
	if err := r.writeLine(e.School, lineHeightBody); err != nil {
		return err
	}
	if err := r.setFont("body", fontSizeBody); err != nil {
		return err
	}
	subtitle := fmt.Sprintf("%s · %s", e.Degree, formatPeriod(&e.Period))
	if err := r.writeLine(subtitle, lineHeightBody); err != nil {
		return err
	}
	r.y += gapBetweenItems
	return nil
}

func (r *renderer) drawSkills(sets []domain.ResumeSkillSet) error {
	if len(sets) == 0 {
		return nil
	}
	return chain(
		func() error { return r.drawSectionTitle("SKILLS") },
		func() error { return r.setFont("body", fontSizeBody) },
		func() error { return r.drawSkillLines(sets) },
	)
}

func (r *renderer) drawSkillLines(sets []domain.ResumeSkillSet) error {
	for i := range sets {
		s := &sets[i]
		line := fmt.Sprintf("%s: %s", s.Category, joinSep(s.Items, ", "))
		if err := r.writeLine(line, lineHeightBody); err != nil {
			return err
		}
	}
	return nil
}

// rect —— gopdf.Rect 别名简写（sections.go 的 placeQR 也用）。
type rect = gopdf.Rect
