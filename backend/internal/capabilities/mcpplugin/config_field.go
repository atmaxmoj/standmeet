// config_field.go —— 插件的**可配置项声明**。
//
// 单独一个文件:manifest.go 已经装满了传输/沙箱/ACL 那几类声明,配置是第三类,
// 混在一起会把"一个插件能声明哪几类东西"这件事埋掉。

package mcpplugin

// ConfigField —— 插件的一个**可配置项**,同样是纯声明数据。
//
// 为什么必须有这一类:在此之前,一个能力想要"owner 能调的设置"是**没有路**的 ——
// 能力能声明自己要哪个连接器(Requires)、能声明自己出哪些 owner 工具(OwnerTools),
// 唯独不能声明"我有哪些可配置项"。于是 booker 的预约策略只能在 host 手写一整套:
// 实体类型、默认值、capstore 读写、admin 路由、表单、还有一个 owner MCP 工具。
// 手写的那份必然飘,而且已经飘了(host 说工作到 18:00、缓冲 15 分钟,沙箱按 17:00、缓冲 0)。
//
// 这跟 OwnerTools 那次补的是**同一个洞**:沙箱能力当时没法对 owner 出工具,于是 owner 侧被迫
// 在 host 重写一遍。机制缺口造出重复,重复必然漂移。
//
// 补上之后,host 只做三件**通用**的事:按声明渲染表单、把 owner 填的值存进这个能力自己的
// 隔离存储、读的时候拿声明的默认值兜底。host 不认识 "working_hours" 这种词。
//
// **默认值和校验规则都只有这一处。** 能力实现侧不该再有一份 defaultXxx(),
// 面板那侧也不该再手写一遍"这个数必须 ≥ 1"。
type ConfigField struct {
	// Min / Max —— 数值项的取值范围(nil = 不限)。声明里直接写 new(1)。
	// 校验也是声明的一部分:不写在这儿,就只能在每个能力自己的 handler 里手写一遍 ——
	// 那正是 booker 以前的样子(host 的 booking-policy handler 手写了 min_lead_days ≥ 1,
	// 沙箱那边没有)。
	Min *int
	Max *int
	// Key —— 存储与回读用的稳定键(能力实现按这个键读)。
	Key string
	// Label —— 面板上显示的名字。
	Label string
	// Type —— 面板据此渲染:string / int / bool / time / string_list。
	Type string
	// Description —— 面板上的一行说明。
	Description string
	// Default —— 默认值的 JSON 字面量(`"18:00"` / `2` / `["mon","tue"]`)。
	// owner 没设过时,读到的就是它。
	Default string
}

// 配置项类型 —— 面板据此选控件,host 据此校验;能力不该发明表外的类型。
const (
	ConfigTypeString     = "string"
	ConfigTypeInt        = "int"
	ConfigTypeBool       = "bool"
	ConfigTypeTime       = "time"
	ConfigTypeStringList = "string_list"
)
