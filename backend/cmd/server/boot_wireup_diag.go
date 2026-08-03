// boot_wireup_diag.go —— 把连接器轴的按-id invoke 接到 diag 路由上,并在这里翻译错误。
//
// 翻译放在组装根,是为了让 `internal/routes/sys` 不必 import 连接器包:那条路由唯一需要
// 分辨的事是"地址错了"(404)还是"事没成"(200 + ok:false),它用自己的 sentinel 表达这件事,
// 由这里把连接器侧的对应错误映过去。

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

func diagCategoryInvoke(d *deps.Runtime) sysroutes.CategoryInvokeFn {
	return func(
		ctx context.Context, ownerID, id, category, verb string, args json.RawMessage,
	) (json.RawMessage, error) {
		out, err := d.ConnectorSlots.InvokeByID(ctx, &connector.InvokeByIDInput{
			OwnerID: ownerID, ID: id, Category: category, Verb: verb, Args: args,
		})
		if errors.Is(err, connector.ErrNotFound) {
			return nil, sysroutes.ErrConnectorNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("diag invoke %s.%s: %w", category, verb, err)
		}
		return out, nil
	}
}
