// page_owner_view.go —— owner 看到的主页。
//
// 跟访客那份(PageContentView)的区别只有一处,但很要紧:栏目里既给 **id 列表**、也给
// join 好的**卡片**。
//
//   - id 是 owner 编辑的东西 —— 读回来改一改再存回去,进出同一个字段名,不用翻译。
//   - 卡片是 owner 的 AI 想看的 —— "这张 pin 指向哪篇、写的什么"。
//
// 以前这两半分给了两个面:面板拿裸 id,MCP 拿卡片。同一个主页,两边看到的不是一个东西,
// 而且谁也不能拿对方那份存回去。

package usecase

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// OwnerPageView —— owner 面的主页载荷。
type OwnerPageView struct {
	UpdatedAt    time.Time            `json:"updated_at"`
	Where        entity.PageWhere     `json:"where"`
	Contact      entity.PageContact   `json:"contact"`
	OwnerID      string               `json:"owner_id"`
	HeroProse    string               `json:"hero_prose"`
	HeroExamples []string             `json:"hero_examples"`
	Insights     []string             `json:"insights"`
	Projects     []string             `json:"projects"`
	InsightCards []entity.PagePinCard `json:"insight_cards"`
	ProjectCards []entity.PagePinCard `json:"project_cards"`
}

// BuildOwnerPageView —— 存储形 → owner 面载荷(id + join 好的卡片)。
func BuildOwnerPageView(
	ctx context.Context, deps PageDeps, ownerID string, content *entity.PageContent,
) (OwnerPageView, error) {
	view, err := BuildPageContentView(ctx, deps, ownerID, content)
	if err != nil {
		return OwnerPageView{}, err
	}
	return OwnerPageView{
		UpdatedAt: content.UpdatedAt, Where: content.Where, Contact: content.Contact,
		OwnerID: content.OwnerID, HeroProse: content.HeroProse,
		HeroExamples: nonNilList(content.HeroExamples),
		Insights:     nonNilList(content.Insights),
		Projects:     nonNilList(content.Projects),
		InsightCards: view.Insights,
		ProjectCards: view.Projects,
	}, nil
}

func nonNilList(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
