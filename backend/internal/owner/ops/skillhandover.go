// skillhandover.go —— the independent Skills subsystem's own MCP surface (skill-handover S3/S4,
// the skills.* namespace). Handover: skills.list / skills.get hand an agent a skill's full body by
// slug (and an exact version). Management: skills.create / skills.update / skills.delete. This is
// the subsystem's OWN interface — it does not borrow corpus's or microsite's read path, and a skill
// carries no privilege (what an agent may do while following it is its own credentials' business).

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/skills"
)

const skillReach = "an owner-AI skill: a named, versioned playbook the agent pulls and follows"

var (
	skillGetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"version":{"type":"integer","description":"an exact version; absent = the current one"}
		},
		"required":["slug"]
	}`)
	skillSlugSchema = json.RawMessage(`{
		"type":"object","properties":{"slug":{"type":"string"}},"required":["slug"]
	}`)
	skillCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string","description":"lowercase letters, digits and hyphens; unique"},
			"name":{"type":"string"},
			"description":{"type":"string"},
			"body":{"type":"string","description":"the instruction text the agent follows"}
		},
		"required":["slug","name","body"]
	}`)
	skillUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
			"body":{"type":"string","description":"the new body; a new version, old ones stay"}
		},
		"required":["slug","body"]
	}`)
)

type skillArgs struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
	Version     int    `json:"version"`
}

// skillWire —— one skill as the handover returns it.
type skillWire struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
	Source      string `json:"source"`
	Version     int    `json:"version"`
}

type skillListResult struct {
	Skills []skillWire `json:"skills"`
}

type skillDeleteResult struct {
	Slug    string `json:"slug"`
	Deleted bool   `json:"deleted"`
}

func wireOf(s *skills.Skill) skillWire {
	return skillWire{
		Slug: s.Slug, Name: s.Name, Description: s.Description, Body: s.Body,
		Source: string(s.Source), Version: s.Version,
	}
}

// SkillHandoverOps —— skills.list/get/create/update/delete. None without the service wired.
func SkillHandoverOps(svc *skills.Service) []fp.Op {
	if svc == nil {
		return []fp.Op{}
	}
	return []fp.Op{
		{
			ID: "skills.list", Kind: fp.Read, Reach: fp.Only(skillReach, "mcp"),
			Description: "List the owner's skills (slug, name, description, version, source). " +
				"Pull one in full with skills.get.",
			Invoke: skillListInvoke(svc),
		},
		{
			ID: "skills.get", Kind: fp.Read, Reach: fp.Only(skillReach, "mcp"),
			InputSchema: skillGetSchema,
			Description: "A skill's full body by slug, at its current version or an exact one. " +
				"Follow the body with your own public tools; it grants nothing on its own.",
			Invoke: skillGetInvoke(svc),
		},
		{
			ID: "skills.create", Kind: fp.Action, Danger: fp.DangerWrite,
			Reach: fp.Only(skillReach, "mcp"), InputSchema: skillCreateSchema,
			Description: "Write a new skill at version 1.",
			Invoke:      skillCreateInvoke(svc),
		},
		{
			ID: "skills.update", Kind: fp.Action, Danger: fp.DangerWrite,
			Reach: fp.Only(skillReach, "mcp"), InputSchema: skillUpdateSchema,
			Description: "Replace a skill's body with a new version; earlier versions stay " +
				"readable with skills.get's version.",
			Invoke: skillUpdateInvoke(svc),
		},
		{
			ID: "skills.delete", Kind: fp.Action, Danger: fp.DangerDestructive,
			Reach: fp.Only(skillReach, "mcp"), InputSchema: skillSlugSchema,
			Description: "Delete a skill and all its versions.",
			Invoke:      skillDeleteInvoke(svc),
		},
	}
}

func skillListInvoke(svc *skills.Service) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := svc.List(ctx, ownerID)
		if err != nil {
			return nil, skillErr(err)
		}
		out := make([]skillWire, 0, len(list))
		for i := range list {
			out = append(out, wireOf(&list[i]))
		}
		return json.Marshal(skillListResult{Skills: out})
	}
}

func skillGetInvoke(svc *skills.Service) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, err := decodeSkill(raw)
		if err != nil {
			return nil, err
		}
		var sk skills.Skill
		if in.Version > 0 {
			sk, err = svc.GetVersion(ctx, ownerID, in.Slug, in.Version)
		} else {
			sk, err = svc.Get(ctx, ownerID, in.Slug)
		}
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(wireOf(&sk))
	}
}

func skillCreateInvoke(svc *skills.Service) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in skillArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		sk, err := svc.New(ctx, ownerID, &skills.NewInput{
			Slug: in.Slug, Name: in.Name, Description: in.Description,
			Body: in.Body, Source: skills.SourceOwner,
		})
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(wireOf(&sk))
	}
}

func skillUpdateInvoke(svc *skills.Service) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in skillArgs
		if err := json.Unmarshal(raw, &in); err != nil || in.Slug == "" {
			return nil, fp.BadInput("slug and body are required")
		}
		sk, err := svc.Edit(ctx, ownerID, in.Slug, in.Body)
		if err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(wireOf(&sk))
	}
}

func skillDeleteInvoke(svc *skills.Service) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in skillArgs
		if err := json.Unmarshal(raw, &in); err != nil || in.Slug == "" {
			return nil, fp.BadInput("slug is required")
		}
		if err := svc.Delete(ctx, ownerID, in.Slug); err != nil {
			return nil, skillErr(err)
		}
		return json.Marshal(skillDeleteResult{Slug: in.Slug, Deleted: true})
	}
}

func decodeSkill(raw json.RawMessage) (skillArgs, error) {
	var in skillArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return skillArgs{}, fp.BadInput("invalid arguments")
	}
	if in.Slug == "" {
		return skillArgs{}, fp.BadInput("slug is required")
	}
	return in, nil
}

func skillErr(err error) error {
	for _, e := range []error{
		skills.ErrNotFound, skills.ErrNoVersion, skills.ErrSlugTaken, skills.ErrBadSlug,
		skills.ErrEmptyBody, skills.ErrEmptyName, skills.ErrBundledEdit,
	} {
		if errors.Is(err, e) {
			return fp.BadInput(e.Error())
		}
	}
	return fp.OpErr("skills", err)
}
