// Package axisconn —— 连接器轴的接线:内置与 owner 上传的连接器、品类操作、品类依赖注册表。
//
// 连接器的**声明**不在这儿 —— 在 backend/connectors/<id>/manifest.yaml。这个包只负责把声明
// 接到机制上:装配进 Hub、把品类契约上的动作接上实现、让"这个品类连上了没有"有个可问的地方。
package axisconn
