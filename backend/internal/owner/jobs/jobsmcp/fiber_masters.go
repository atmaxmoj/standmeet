// fiber_masters.go —— the resume.master_* tools and resume.draft_save_as_master
// (docs/design/resume-masters.md). Each calls the same jobsuc usecase as the admin
// /masters routes and returns jobsmodel.ResumeMaster as-is: one shape on both faces.

package jobsmcp

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const masterIDProp = `"master_id":{"type":"string",` +
	`"description":"master id from resume.master_list"}`

func (c *resumeFiber) masterBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{
		{
			Name: "resume.master_list", Danger: "read",
			Description: "List résumé masters (named, persistent résumés; drafts start " +
				"from one), newest first, paged: {items, next_cursor, total}.",
			InputSchema: paging.Schema(nil),
			Handler:     c.handleMasterList,
		},
		{
			Name:        "resume.master_get",
			Danger:      "read",
			Description: "One résumé master with its resume_content.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{` + masterIDProp +
				`},"required":["master_id"]}`),
			Handler: c.handleMasterGet,
		},
		{
			Name: "resume.master_create", Danger: "write",
			Description: "Create a résumé master: from a draft's content (draft_id), from " +
				"resume_content, or blank. is_default makes it the one default.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{
				"name":{"type":"string","description":"the master's name"},
				"resume_content":{"type":"object","description":"structured resume content"},
				"draft_id":{"type":"string","description":"copy this draft's content instead"},
				"is_default":{"type":"boolean","description":"make it the default master"}
			},"required":["name"]}`),
			Handler: c.handleMasterCreate,
		},
		{
			Name: "resume.master_update", Danger: "write",
			Description: "Rename a master, replace its resume_content, and/or set is_default " +
				"(true makes it the one default). Omitted fields stay as they are.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{` + masterIDProp + `,
				"name":{"type":"string"},
				"resume_content":{"type":"object"},
				"is_default":{"type":"boolean"}
			},"required":["master_id"]}`),
			Handler: c.handleMasterUpdate,
		},
		{
			Name: "resume.master_delete", Danger: "destructive",
			Description: "Delete a master (idempotent). Drafts based on it keep their content " +
				"and stop naming it.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{` + masterIDProp +
				`},"required":["master_id"]}`),
			Handler: c.handleMasterDelete,
		},
		{
			Name: "resume.draft_save_as_master", Danger: "write",
			Description: "Save a draft's resume_content as a master: overwrite master_id, or " +
				"create a new master called name. The draft is unchanged.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{
				"draft_id":{"type":"string","description":"draft id"},` + masterIDProp + `,
				"name":{"type":"string","description":"name of a new master (no master_id)"},
				"make_default":{"type":"boolean","description":"make it the default master"}
			},"required":["draft_id"]}`),
			Handler: c.handleSaveAsMaster,
		},
	}
}

func (c *resumeFiber) handleMasterList(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	args, err := paging.ParseArgs[struct{}](raw)
	if err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	page, err := jobsuc.ListMasters(ctx, c.resume, ownerID, args.Req)
	return masterResult(c, "master_list", page, err)
}

type masterIDArgs struct {
	MasterID string `json:"master_id"`
}

func (c *resumeFiber) handleMasterGet(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var a masterIDArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	m, err := jobsuc.GetMaster(ctx, c.resume, ownerID, a.MasterID)
	return masterResult(c, "master_get", m, err)
}

type masterCreateArgs struct {
	Content   *jobsmodel.ResumeContent `json:"resume_content"`
	Name      string                   `json:"name"`
	DraftID   string                   `json:"draft_id"`
	IsDefault bool                     `json:"is_default"`
}

func (c *resumeFiber) handleMasterCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var a masterCreateArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	m, err := jobsuc.CreateMaster(ctx, c.resume, &jobsuc.CreateMasterInput{
		OwnerID: ownerID, Name: a.Name, Content: a.Content, DraftID: a.DraftID,
		IsDefault: a.IsDefault,
	})
	return masterResult(c, "master_create", m, err)
}

type masterUpdateArgs struct {
	Name      *string                  `json:"name"`
	Content   *jobsmodel.ResumeContent `json:"resume_content"`
	IsDefault *bool                    `json:"is_default"`
	MasterID  string                   `json:"master_id"`
}

func (c *resumeFiber) handleMasterUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var a masterUpdateArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	m, err := jobsuc.UpdateMaster(ctx, c.resume, &jobsuc.UpdateMasterInput{
		OwnerID: ownerID, MasterID: a.MasterID, Name: a.Name, Content: a.Content,
		IsDefault: a.IsDefault,
	})
	return masterResult(c, "master_update", m, err)
}

func (c *resumeFiber) handleMasterDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var a masterIDArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	err := jobsuc.DeleteMaster(ctx, c.resume, ownerID, a.MasterID)
	return masterResult(c, "master_delete", map[string]bool{"ok": true}, err)
}

type saveAsMasterArgs struct {
	DraftID     string `json:"draft_id"`
	MasterID    string `json:"master_id"`
	Name        string `json:"name"`
	MakeDefault bool   `json:"make_default"`
}

func (c *resumeFiber) handleSaveAsMaster(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var a saveAsMasterArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	m, err := jobsuc.SaveDraftAsMaster(ctx, c.resume, &jobsuc.SaveAsMasterInput{
		OwnerID: ownerID, DraftID: a.DraftID, MasterID: a.MasterID, Name: a.Name,
		MakeDefault: a.MakeDefault,
	})
	return masterResult(c, "draft_save_as_master", m, err)
}

// masterResult — the tool's JSON, or its error mapped the way every resume.* tool maps it.
func masterResult[T jobsmodel.ResumeMaster | paging.Page[jobsmodel.ResumeMaster] | map[string]bool](
	c *resumeFiber, op string, v T, err error,
) registry.MCPResult {
	if err != nil {
		return resumeCapErrToResult(c.log, err, op)
	}
	return mcputil.MarshalResult(c.log, "resume."+op, v)
}
