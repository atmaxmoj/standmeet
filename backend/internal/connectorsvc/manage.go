// manage.go —— 连接器的「owner 自建/编辑」编排：上传 openapi、建 protocol、编辑 spec、派生凭据
// 表单。跟 service.go 同 Service，拆出来守 max-lines。

package connectorsvc

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// CreateUploaded —— 从 owner 贴的 spec + JSONata binding 建一个 openapi 连接器：装配期校验
// （坏 spec/binding/jsonata → ErrInvalidManifest）→ 注册进 live Hub → 存档（拉起重装）。返回 id。
func (s *Service) CreateUploaded(
	ctx context.Context, ownerID string, spec, binding []byte, authScheme string,
) (string, error) {
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := &connector.Manifest{
		ID: "up-" + id, Kind: "openapi", AuthScheme: authScheme, Spec: spec, Binding: binding,
	}
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, &postgres.SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: m.ID, Category: cat, Kind: "openapi",
		Spec: spec, Binding: binding, AuthScheme: authScheme,
	}); serr != nil {
		return "", fmt.Errorf("persist uploaded connector: %w", serr)
	}
	return m.ID, nil
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
	m := &connector.Manifest{
		ID: "up-" + id, Kind: "protocol", Protocol: protocol, Category: category,
	}
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, &postgres.SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: m.ID, Category: cat, Kind: "protocol", Protocol: protocol,
		Spec: []byte{}, Binding: []byte{}, // protocol 无 spec/binding，给空 bytea（列 NOT NULL）
	}); serr != nil {
		return "", fmt.Errorf("persist protocol connector: %w", serr)
	}
	return m.ID, nil
}

// UpdateUploaded —— 编辑已建上传连接器的 spec/binding（换认证 type 等）→ 重新装配（校验+SSRF）+
// 重注册进 Hub + 存档。内置连接器不可编辑（spec 来自 embed）→ ErrInvalidManifest。
func (s *Service) UpdateUploaded(
	ctx context.Context, ownerID, id string, in *UploadedSpec,
) error {
	if s.Manifest(id) != nil { // 内置：不可编辑
		return ErrInvalidManifest
	}
	m := &connector.Manifest{
		ID: id, Kind: "openapi", AuthScheme: in.AuthScheme, Spec: in.Spec, Binding: in.Binding,
	}
	cat, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return fmt.Errorf("%w: %w", ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.UpdateUploaded(ctx, &postgres.SaveUploadedInput{
		OwnerID: ownerID, ConnectorID: id, Category: cat, Kind: "openapi",
		Spec: in.Spec, Binding: in.Binding, AuthScheme: in.AuthScheme,
	}); serr != nil {
		return fmt.Errorf("persist updated connector: %w", serr)
	}
	return nil
}

// CredentialForm —— 派生这个连接器要 owner 填的凭据表单（按 spec 的 securityScheme）。
func (s *Service) CredentialForm(ctx context.Context, ownerID, id string) (CredentialForm, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return CredentialForm{}, merr
	}
	form, derr := connector.DeriveCredentialForm(m)
	if derr != nil {
		return CredentialForm{}, fmt.Errorf("%w: %w", ErrInvalidManifest, derr)
	}
	return CredentialForm{AuthType: form.AuthType, Fields: form.Fields}, nil
}
