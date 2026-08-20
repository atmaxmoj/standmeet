// manage.go —— 连接器的「owner 自建/编辑」编排：上传 openapi、建 protocol、编辑 spec、派生凭据
// 表单。跟 service.go 同 Service，拆出来守 max-lines。

package connector

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// CreateUploaded —— 从 owner 贴的 spec + JSONata binding 建一个 openapi 连接器：装配期校验
// （坏 spec/binding/jsonata → ErrInvalidManifest）→ 注册进 live Hub → 存档（拉起重装）。返回 id。
func (s *Service) CreateUploaded(
	ctx context.Context, ownerID string, in *UploadedSpec,
) (string, error) {
	norm, nerr := s.resolveSpec(ctx, in)
	if nerr != nil {
		return "", nerr
	}
	in = norm
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := openapiManifest("up-"+id, in)
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, uploadedSaveInput(ownerID, m.ID, cat, in)); serr != nil {
		return "", fmt.Errorf("persist uploaded connector: %w", serr)
	}
	return m.ID, nil
}

// isBuiltin —— 这个 id 是不是内置连接器（embed manifest 里有）。内置不可改/删。
func (s *Service) isBuiltin(id string) bool { return s.Manifest(id) != nil }

// Delete —— 删一个 owner 自建连接器（行删除）。内置（embed manifest）不可删 → ErrBuiltinReadonly。
// 删后它填的品类槽空（slot store 读不到 → 依赖它的 cap 复闸）。
func (s *Service) Delete(ctx context.Context, ownerID, id string) error {
	if s.isBuiltin(id) {
		return ErrBuiltinReadonly
	}
	if err := s.d.Repo.DeleteUploaded(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete connector: %w", err)
	}
	return nil
}

// resolveSpec —— 把 owner 交上来的东西变成**一份可以直接存的 spec**：没有正文就按来源 URL 抓
// 一次（F-C-25），然后把 base URL 并进去（F-C-22）。返回副本，不改调用方的入参。
//
// Create 和 Update 都从这里进，所以「存下去的 spec 一定已经是完整的」是这两条路的共同前提，
// 而不是某一条路记得做的事。两样都没给 → 零改动，原样往下走（由摄入闸去拒）。
func (s *Service) resolveSpec(ctx context.Context, in *UploadedSpec) (*UploadedSpec, error) {
	body := in.Spec
	if len(body) == 0 && in.URL != "" {
		fetched, ferr := s.fetchSpec(ctx, in.URL)
		if ferr != nil {
			return nil, fmt.Errorf(wrapSentinel, ErrInvalidManifest, ferr)
		}
		body = fetched
	}
	raw, err := openapi.ApplyBaseURL(body, in.BaseURL)
	if err != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrInvalidManifest, err)
	}
	out := *in
	out.Spec = raw
	return &out, nil
}

// bytesOrEmpty —— nil → 空 bytea（列 NOT NULL）。agent-only 连接器无 binding（nil），存空非 NULL。
func bytesOrEmpty(b []byte) []byte {
	if b == nil {
		return []byte{}
	}
	return b
}

// openapiManifest —— 从 owner 贴的 UploadedSpec 建一份 openapi manifest。Create/Update 同一份字段
// 映射，抽出来做单一事实源（否则加一个 manifest 字段要在建/改两处都改，易漏）。
func openapiManifest(id string, in *UploadedSpec) *Manifest {
	return &Manifest{
		ID: id, Kind: "openapi", AuthScheme: in.AuthScheme,
		Spec: in.Spec, Binding: in.Binding, ExposeAsAgentTools: in.ExposeAsAgentTools,
	}
}

// uploadedSaveInput —— openapi 上传连接器的持久化输入。Create/Update 同一份映射（nil binding →
// 空 bytea，列 NOT NULL），单一事实源。
func uploadedSaveInput(ownerID, id, cat string, in *UploadedSpec) *SaveUploadedInput {
	return &SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: id, Category: cat, Kind: "openapi",
		Spec: bytesOrEmpty(in.Spec), Binding: bytesOrEmpty(in.Binding),
		AuthScheme: in.AuthScheme, ExposeAsAgentTools: in.ExposeAsAgentTools,
	}
}

// CreateProtocol —— owner 自建一个 protocol 连接器（caldav/smtp…，无 spec）：装配（NewXxxConnector）
// + 注册进 live Hub + 存档。凭据随后经 SaveCredentials 填。
func (s *Service) CreateProtocol(
	ctx context.Context, ownerID, category, protocol string,
) (string, error) {
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := &Manifest{
		ID: "up-" + id, Kind: "protocol", Protocol: protocol, Category: category,
	}
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, &SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: m.ID, Category: cat, Kind: "protocol", Protocol: protocol,
		Spec: []byte{}, Binding: []byte{}, // protocol 无 spec/binding，给空 bytea（列 NOT NULL）
	}); serr != nil {
		return "", fmt.Errorf("persist protocol connector: %w", serr)
	}
	return m.ID, nil
}

// UpdateUploaded —— 编辑已建上传连接器的 spec/binding（换认证 type 等）→ 重新装配（校验+SSRF）+
// 重注册进 Hub + 存档。内置连接器不可编辑（spec 来自 embed）→ ErrBuiltinReadonly。
func (s *Service) UpdateUploaded(
	ctx context.Context, ownerID, id string, in *UploadedSpec,
) error {
	if s.isBuiltin(id) {
		return ErrBuiltinReadonly
	}
	norm, nerr := s.resolveSpec(ctx, in)
	if nerr != nil {
		return nerr
	}
	in = norm
	m := openapiManifest(id, in)
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.UpdateUploaded(ctx, uploadedSaveInput(ownerID, id, cat, in)); serr != nil {
		return fmt.Errorf("persist updated connector: %w", serr)
	}
	return nil
}

// CredentialForm —— 派生这个连接器要 owner 填的凭据表单（按 spec 的 securityScheme）。CredentialForm
// 是 connector 同名类型的 alias，故直接返回派生结果，不再逐字段拷贝。
func (s *Service) CredentialForm(ctx context.Context, ownerID, id string) (CredentialForm, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return CredentialForm{}, merr
	}
	form, derr := DeriveCredentialForm(m)
	if derr != nil {
		return CredentialForm{}, fmt.Errorf(wrapSentinel, ErrInvalidManifest, derr)
	}
	form.Granted = s.grantedScopes(ctx, ownerID, id)
	form.Shortfall = shortfallFor(m, form.Granted)
	return form, nil
}

// shortfallFor —— 这个授权做不了哪几个动作（F-B-8）。**只在已经授过的时候问**：
// 一条还没连的连接「什么都做不了」是废话，卡上该说的是「去连一下」，不是列一串缺的 scope。
// spec 解不开（protocol 连接器没有 spec）→ 空：那一类没有 scope 这回事。
func shortfallFor(m *Manifest, granted []string) []ScopeShortfall {
	if len(granted) == 0 {
		return []ScopeShortfall{}
	}
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return []ScopeShortfall{}
	}
	return scopeShortfall(spec, granted)
}

// grantedScopes —— 这条连接**当初授出去的**范围。跟 form.Scopes（spec 派生的**可选清单**）
// 是两件事：一个是「这个连接器支持哪些」，一个是「我授了哪些」。面板要显示后者，而以前
// 它无处可取 —— 存储一直存着（`decodeConnectorConn` 就解出来了），只是没人往外报（F-C-33）。
//
// 取不到就空：没连接、读失败，都只是「没有已授范围可显示」，不该让整张凭据表单 500。
func (s *Service) grantedScopes(ctx context.Context, ownerID, id string) []string {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return []string{}
	}
	return conn.Scopes
}
