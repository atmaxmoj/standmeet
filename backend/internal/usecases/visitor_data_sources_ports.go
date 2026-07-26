// visitor_data_sources_ports.go —— the single-method visitor data-source ports
// (owner read + conversation read). Split from visitor_data_sources.go to stay
// under the per-file public-struct cap; same F.2 purpose — narrow seams the eval
// facade injects fixtures into while prod's postgres repos satisfy them as-is.

package usecases

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// OwnerGetter —— the owner reads the visitor path needs: GetByID (calendar.book
// reads owner.ProfileTimezone) + FirstHandle/GetByHandle (public/byoai tier
// resolves the sole owner). VisitorDeps.Owners is this narrow port so the eval
// can inject a fixture owner; prod's *postgres.OwnerRepo satisfies it as-is.
type OwnerGetter interface {
	GetByID(ctx context.Context, id string) (ownerdomain.Owner, error)
	FirstHandle(ctx context.Context) (string, error)
	GetByHandle(ctx context.Context, handle string) (ownerdomain.Owner, error)
}

// ConversationGetter —— the one chat method summarize_conversation needs.
// SummarizeDeps.Chats is this narrow port so the eval can inject a fixture that
// returns the eval conversation; VisitorDeps.Chats stays the concrete repo
// (broadly used by session/dialog persistence the eval doesn't exercise).
type ConversationGetter interface {
	GetWithMessages(ctx context.Context, ownerID, chatID string) (postgres.ChatWithMessages, error)
}

// SkillGetter —— the owner-skill reads the visitor path needs: GetByID (the
// skill-runner capability turns a granted skill's scripts into tools) +
// ListSkillsForRole (role-snapshot freeze). VisitorDeps.Skills is this narrow
// port so the eval can inject a fixture owner skill.
type SkillGetter interface {
	GetByID(ctx context.Context, ownerID, skillID string) (marketplace.Skill, error)
	ListSkillsForRole(ctx context.Context, roleID string) ([]marketplace.Skill, error)
}

// MCPServerGetter —— the one MCP-server read the ext-mcp capability needs to
// resolve a granted server config before dialing it. VisitorDeps.MCPServers is
// this narrow port so the eval can inject a fixture server pointed at a real MCP
// endpoint (the dial stays real — only the registry lookup is fixtured).
type MCPServerGetter interface {
	GetByID(ctx context.Context, ownerID, serverID string) (marketplace.MCPServerConfig, error)
}
