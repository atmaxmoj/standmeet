// owner_op.go —— 一个连接器**自己声明**的 owner 侧操作。
//
// 起因是 connectors.mail_test_send:发一封测试信是**邮件连接器**的事,不是"连接器注册表"
// 的事。它长在通用注册表上,注册表就得认识 mail —— 于是通用的那层里出现了一个品类的名字。
//
// 这里把它掰开成跟能力轴同一个元结构:**声明是数据**(名字 / 说明 / 入参 schema / 它要的是
// 品类契约上的哪个操作),写在连接器自己的 manifest 里;**实现**由宿主按品类契约接上。
// 加一个连接器专属的 owner 操作 = 在那个连接器的 manifest 里加一段,通用层一行不改。

package connector

import (
	"encoding/json"
	"slices"
	"strings"
)

// OwnerOp —— 连接器声明的一个 owner 侧操作。
//
// Name 是对外的操作 id(如 "connectors.mail_test_send");Op 是它要宿主执行的**品类契约
// 操作**(如 "mail.test_send")。两者分开:对外的命名规范不绑死契约里的动词。
type OwnerOp struct {
	Name        string
	Op          string
	Description string
	InputSchema json.RawMessage
}

// OpField —— 一个 owner 操作要 owner 填的一格,从声明的 input_schema 派生。
type OpField struct {
	Key         string
	Description string
	Required    bool
}

// Fields —— 把声明的 input_schema 派生成一张表单。
//
// 声明里写的是 JSON Schema(MCP 那一侧本来就要它);面要的是几个输入框。与其让每个面各自
// 解一遍 schema,不如在声明旁边派生一次 —— 跟 DeriveCredentialForm 从 manifest 派生凭据
// 表单是同一个路子。加一个 owner 操作 = 在 manifest 里加一段,面一行不改。
//
// 只认顶层的 string 属性:owner 操作的入参就是几段短文本(收件人 / 主题 / 正文)。声明里
// 出现嵌套或别的类型就跳过,**不猜一个控件** —— 猜出来的控件填出来的值是错的,而且错得
// 无声。schema 坏了同理:返回空,那张卡上就没有这个动作,而不是渲一个填不对的表单。
func (o OwnerOp) Fields() []OpField {
	var decl opSchemaDecl
	if err := json.Unmarshal(o.InputSchema, &decl); err != nil {
		return []OpField{}
	}
	required := make(map[string]bool, len(decl.Required))
	for _, key := range decl.Required {
		required[key] = true
	}
	return orderFields(decl.Properties, required)
}

// opSchemaDecl —— input_schema 里这一层用得上的部分。
type opSchemaDecl struct {
	Properties map[string]opPropDecl `json:"properties"`
	Required   []string              `json:"required"`
}

type opPropDecl struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

// orderFields —— 必填的排前面,同组按字母序。map 没有顺序,而表单的顺序是 owner 看到的
// 东西:同一张卡每次刷新长得不一样,读起来像页面在闪。所以这里把顺序定死。
func orderFields(props map[string]opPropDecl, required map[string]bool) []OpField {
	out := make([]OpField, 0, len(props))
	for key, prop := range props {
		if prop.Type != "string" {
			continue
		}
		out = append(out, OpField{
			Key: key, Description: prop.Description, Required: required[key],
		})
	}
	slices.SortFunc(out, func(a, b OpField) int {
		if rank := requiredRank(a) - requiredRank(b); rank != 0 {
			return rank
		}
		return strings.Compare(a.Key, b.Key)
	})
	return out
}

// requiredRank —— 必填的排前面。
func requiredRank(f OpField) int {
	if f.Required {
		return 0
	}
	return 1
}
