// prompts_write.go —— 建 / 改一条 prompt。回包形状跟读的那份是同一个,只差调哪个用例、
// 怎么校验必填。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

type promptWriteArgs struct {
	PromptID    string `json:"prompt_id"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	Description string `json:"description"`
}

func createPrompt(deps usecase.PromptsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parsePromptWrite(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := usecase.CreatePrompt(ctx, deps, &usecase.CreatePromptInputReq{
			OwnerID: ownerID, Name: in.Name, Body: in.Body, Description: in.Description,
		})
		if err != nil {
			return nil, promptErr(err)
		}
		return json.Marshal(toPromptOut(&p))
	}
}

func updatePrompt(deps usecase.PromptsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parsePromptUpdateArgs(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := usecase.UpdatePrompt(ctx, deps, &usecase.UpdatePromptInputReq{
			OwnerID: ownerID, PromptID: in.PromptID, Name: in.Name,
			Body: in.Body, Description: in.Description,
		})
		if err != nil {
			return nil, promptErr(err)
		}
		return json.Marshal(toPromptOut(&p))
	}
}

func parsePromptWrite(raw json.RawMessage) (promptWriteArgs, error) {
	var in promptWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"name", in.Name}, [2]string{"body", in.Body})
}

// parsePromptUpdateArgs —— 跟建一条一样,外加必填的 prompt_id。
func parsePromptUpdateArgs(raw json.RawMessage) (promptWriteArgs, error) {
	in, err := parsePromptWrite(raw)
	if err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"prompt_id", in.PromptID})
}
