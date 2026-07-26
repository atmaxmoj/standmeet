// Package accessdomain —— 访客准入领域值对象:AccessCode(邀请码 = invitation)、CodeMember(一码多人)、
// AccessRequest(无码请求)、VisitorProfile(身份采集)。从 internal/domain god-package 切出;
// usecases/postgres/session/routes/ownercore/capreg/jobsdomain 共享。pure leaf,无 internal 依赖。
package accessdomain
