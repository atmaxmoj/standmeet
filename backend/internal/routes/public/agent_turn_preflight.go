// agent_turn_preflight.go —— 这一轮该不该放行。
//
// 三道闸,顺序是有意的:先问这段对话是不是你的(越权),再问油箱(#7),最后问轮数。
// 全部在**写之前**,所以被挡下的一轮不会留下半条记录,也不会消耗任何配额。
//
// 从 agent_turn.go 拆出来:那个文件管的是"这一轮怎么跑",这个文件管的是"这一轮能不能跑"。

package public

import (
	"net/http"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// preflightAgentTurnQuota —— #28: 落库挪到 /agent/turn 后,配额也在这查
// (pre-stream,清晰 4xx,跟原 /dialogs 一致)。convID 空(无状态 smoke 调用)跳过。
// 返 false = 已写错误响应、caller 收手。
func preflightAgentTurnQuota(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	// 油量闸**在 convID 判空之前**:油箱是按 provider 记的,跟这一轮属于哪段对话无关。
	// 放在后面的话,每开一段新对话的第一轮都绕过它 —— 一道每次都能被绕开的闸。
	// (越权和轮数两道确实需要一段对话才有意义:没有 conv 就没有归属,也没有轮数可数。)
	if !enforceGasQuotaOrWrite(r, h, auth, w) {
		return false
	}
	if convID == "" {
		return true
	}
	// 一道闸一行。加第四道时这里加一行,而不是再嵌一层 if —— 顺序即优先级,读得出来。
	return allPass([]gate{
		func() bool { return checkConvOwnership(r, h, auth, w, convID) },
		func() bool { return enforceTurnQuotaOrWrite(r, h, auth, w, convID) },
	})
}

// gate —— 一道准入检查:放行返 true;拦下的那一道自己已经写好响应了。
type gate func() bool

func allPass(gates []gate) bool {
	for _, g := range gates {
		if !g() {
			return false
		}
	}
	return true
}

// enforceGasQuotaOrWrite —— #7 油表。挂了表的会话才会走到查询;没挂表的一次查询都不发,
// 跟今天完全同一条路。跟轮数配额并排放,因为它们是同一件事的两个量纲。
func enforceGasQuotaOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter,
) bool {
	// byoai 花的是访客自己的钱,不动 owner 的油箱。
	if auth.Data.Mode == "byoai" {
		return true
	}
	gerr := conversation.EnforceGasQuota(r.Context(), &h.Visitor, &conversation.GasQuotaInput{
		OwnerID: auth.Data.OwnerID, ProviderID: auth.Data.ProviderID,
		Metered: auth.Data.GasMetered,
	})
	if gerr != nil {
		handleVisitorErr(h.Log, w, gerr)
		return false
	}
	return true
}

func enforceTurnQuotaOrWrite(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	qerr := conversation.EnforceTurnQuota(r.Context(), &h.Visitor,
		&conversation.TurnQuotaInput{OwnerID: auth.Data.OwnerID, ConversationID: convID})
	if qerr != nil {
		handleVisitorErr(h.Log, w, qerr)
		return false
	}
	return true
}

// checkConvOwnership —— 多对话模型:code 访客可有多段对话且 conversation_id 由
// 客户端传,必须校验这段属于该 member,防借别人的 id 发 turn。无 member(public/
// byoai)没 member 可比对,沿用既有信任(conversation 由 owner-scoped session 锁)。
func checkConvOwnership(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	if auth.Data.MemberID == "" {
		return true
	}
	return verifyConvMember(r, h, auth, w, convID)
}

func verifyConvMember(
	r *http.Request, h *Handlers, auth authedVisitor, w http.ResponseWriter, convID string,
) bool {
	ok, err := conversation.ChatBelongsToMember(
		r.Context(), &h.Visitor, auth.Data.OwnerID, convID, auth.Data.MemberID,
	)
	if err != nil {
		h.Log.Error("conv ownership check", "err", err)
		writeError(h.Log, w, serverErr())
		return false
	}
	if !ok {
		writeError(h.Log, w, forbiddenEnv("conversation does not belong to this session"))
		return false
	}
	return true
}
