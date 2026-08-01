// owner_op.go —— 一个连接器**自己声明**的 owner 侧操作。
//
// 起因是 connectors.mail_test_send:发一封测试信是**邮件连接器**的事,不是"连接器注册表"
// 的事。它长在通用注册表上,注册表就得认识 mail —— 于是通用的那层里出现了一个品类的名字。
//
// 这里把它掰开成跟能力轴同一个元结构:**声明是数据**(名字 / 说明 / 入参 schema / 它要的是
// 品类契约上的哪个操作),写在连接器自己的 manifest 里;**实现**由宿主按品类契约接上。
// 加一个连接器专属的 owner 操作 = 在那个连接器的 manifest 里加一段,通用层一行不改。

package connector

import "encoding/json"

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
