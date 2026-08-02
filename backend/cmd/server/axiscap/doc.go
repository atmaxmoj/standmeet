// Package axiscap —— 能力轴的接线:内建声明的读入、注册、隔离存储、可配置项、码上的字段与
// 用量闸、per-session 工作区。
//
// 能力的**声明**不在这儿 —— 在 backend/capabilities/<id>/manifest.yaml。这个包只负责把声明
// 接到机制上。跟 axisconn 同形:两根轴,一样的地址结构。
package axiscap
