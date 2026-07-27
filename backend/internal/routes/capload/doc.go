// Package capload —— capability 装载/派发 glue,住在 **routes reach-out 层**:把各来源的能力
// (owner 注册的外部 MCP server、装的 skill、OpenAPI agent 工具、MCP-app 会话)适配成 capreg
// 容器里的统一能力,供访客 agent 调度。
//
// 为什么在 routes 而不在 capabilities:它**需要域的数据**(角色快照 / MCP 配置 / skill /
// VisitorSkillsDeps)才能生产能力 —— 是"能力伸进域取料"的一侧。若放 capabilities,capabilities
// 就同时"被域依赖(容器)"又"依赖域(取料)"= 域级环。所以按 domain-facade-and-ddd-layout 的层次:
//   - 容器/机制(capreg / sandbox / capsocket / mcpclient / mcpplugin / capstore)= **capabilities 叶子**,
//     不 import 域;域向它要能力。
//   - 生产者/glue(本包)= **routes 层**,合法 import 域 + 注册进 capreg 容器。capabilities 保持叶子,
//     域级依赖图无环(check-domain-acyclic 守)。
//
// 具体能力本身仍外置(mcp-servers/ 沙箱 或 owner 侧);本包只是把它们装进容器的适配器。
package capload
