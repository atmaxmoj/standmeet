// wire_dispatcher.go —— 建出站收口:这台实例对外能做的每一件事,在这里汇成一处。
//
// 这份清单就是"对外能做什么"的全集 —— 它是交付物,不是脚手架。迁移期它一直长:
// 每把一个资源搬进来,ownercore 就少注册一组,直到 ownercore 整包删除。
//
// **适配器按资源一文件一个**(wire_disp_<资源>.go),跟收口那边的 res_<资源>.go 对着看。
// 这个文件只留"装配"本身:建收口、声明各个面的档案。
//
// 装饰器(鉴权/配额/审计/危险操作)统一挂在这里:每个面拿能力都只能经收口,所以策略有唯一的
// 施加点,不会出现"某个 endpoint 忘了加"。

package main

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// buildDispatcher —— 组装出站收口。**一个资源一行**;每行的适配器和它的依赖都在
// wire_disp_<资源>.go 里,这里只管把它们接起来。
func buildDispatcher(d *runtimeDeps) *dispatcher.Dispatcher {
	return dispatcher.New(
		dispatcher.IPBans(newIPBanOps(d)),
		dispatcher.Domains(newDomainOps(d)),
		dispatcher.AccessRequests(newAccessRequestOps(d)),
		dispatcher.Skills(newSkillOps(d)),
		dispatcher.Marketplace(newMarketOps(d)),
		dispatcher.Prompts(newPromptOps(d)),
		dispatcher.MCPServers(newMCPServerOps(d)),
		dispatcher.Roles(newRoleOps(d)),
		dispatcher.Capabilities(newCapabilityOps(d)),
		dispatcher.Instance(newInstanceOps(d)),
	)
}

// adminFace —— admin HTTP 面在 parity 里的档案。它是浏览器应用,所以能承载浏览器流程、
// 明文密钥、multipart 这三类 MCP 承载不了的东西(Reach 的 .Except(...) 据此放行)。
func adminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}
