// manage.go —— 连接器的「owner 自建/编辑」编排：上传 openapi、建 protocol、编辑 spec、派生凭据
// 表单。跟 service.go 同 Service，拆出来守 max-lines。

package connector

import (
	"context"
	"fmt"
)

// CreateUploaded —— 从 owner 贴的 spec + JSONata binding 建一个 openapi 连接器：装配期校验
// （坏 spec/binding/jsonata → ErrInvalidManifest）→ 注册进 live Hub → 存档（拉起重装）。返回 id。
func (s *Service) CreateUploaded(
	ctx context.Context, ownerID string, in *UploadedSpec,
) (string, error) {
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := openapiManifest("up-"+id, in)
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
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
		return "", fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
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
	m := openapiManifest(id, in)
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
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
		return CredentialForm{}, fmt.Errorf("%w: %w", ErrInvalidManifest, derr)
	}
	return form, nil
}
