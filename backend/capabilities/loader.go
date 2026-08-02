// loader.go —— 读出所有内建能力 manifest(拉起时调一次)。数据文件在本目录的 <id>/ 子目录
// 里,go:embed 进二进制。(Package doc 在 embed.go。)

package capabilities

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"path"

	yaml "go.yaml.in/yaml/v3"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// socketEnv —— 宿主把这个能力那一根 host socket 的路径注入到这个环境变量。
//
// 名字对所有能力都一样,路径由 id 派生。以前每个能力自己起一个名字(BOOKER_SOCKET /
// RETRIEVAL_SOCKET / ...),而路径要在宿主的声明里手写一遍 —— 同一件事四个名字,外加四处
// 可以写错的路径。声明现在只说"我要哪几件事"。
const socketEnv = "STANDMEET_HOST_SOCKET"

// Load —— 读出所有内建能力 manifest。
func Load() ([]mcpplugin.Manifest, error) {
	entries, err := fs.ReadDir(builtinFS, ".")
	if err != nil {
		return nil, fmt.Errorf("read builtin capabilities dir: %w", err)
	}
	out := make([]mcpplugin.Manifest, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, lerr := loadOne(e.Name())
		if lerr != nil {
			return nil, lerr
		}
		out = append(out, m)
	}
	return out, nil
}

// loadOne —— 读一个内建能力目录。
func loadOne(dir string) (mcpplugin.Manifest, error) {
	raw, err := builtinFS.ReadFile(path.Join(dir, "manifest.yaml"))
	if err != nil {
		return mcpplugin.Manifest{}, fmt.Errorf("read %s manifest: %w", dir, err)
	}
	var d descriptor
	if uerr := yaml.Unmarshal(raw, &d); uerr != nil {
		return mcpplugin.Manifest{}, fmt.Errorf("parse %s manifest: %w", dir, uerr)
	}
	tools, terr := ownerTools(dir, d.OwnerTools)
	if terr != nil {
		return mcpplugin.Manifest{}, terr
	}
	return mcpplugin.Manifest{
		ID: d.ID, Title: d.Title, Version: d.Version,
		Shape: mcpplugin.Shape(d.Shape), ACL: acl(d.ACL),
		RawToolNames: d.RawToolNames, Requires: d.Requires,
		OwnerTools: tools,
		Config:     fields(d.Config), CodeConfig: fields(d.CodeConfig),
		Quota:     d.Quota.manifest(),
		Transport: transport(d.ID, &d.Transport),
	}, nil
}

// transport —— 传输声明 → manifest。socket 路径**在这儿派生并注入**,manifest 不写路径:
// 点过 host op 的能力才有一根 socket,没点过的完全断网。
func transport(id string, t *transportDesc) mcpplugin.Transport {
	out := mcpplugin.Transport{
		Kind: t.Kind, Command: t.Command, Args: t.Args, URL: t.URL,
		Env: map[string]string{}, Headers: t.Headers,
	}
	maps.Copy(out.Env, t.Env)
	if t.Sandbox == nil {
		return out
	}
	out.Sandbox = &mcpplugin.Sandbox{
		PluginDir: t.Sandbox.PluginDir, HostOps: t.Sandbox.HostOps,
		AllowNet: t.Sandbox.AllowNet, Workspace: t.Sandbox.Workspace,
	}
	if len(t.Sandbox.HostOps) > 0 {
		out.Env[socketEnv] = hostop.SocketPath(id)
	}
	return out
}

// acl —— 空 → 最严(role_granted)。声明漏写不该变成"对所有人开放"。
func acl(v string) string {
	if v == mcpplugin.ACLAlways {
		return mcpplugin.ACLAlways
	}
	return mcpplugin.ACLRoleGranted
}

// ownerTools —— owner 面的声明 → manifest。
//
// schema 当场校验:一份编不动的 schema 会让整张工具表 marshal 失败(历史上真发生过),
// 与其等到那时候,不如拉起时就拒。
func ownerTools(dir string, decls []ownerToolDesc) ([]mcpplugin.OwnerTool, error) {
	out := make([]mcpplugin.OwnerTool, 0, len(decls))
	for i := range decls {
		if !json.Valid([]byte(decls[i].InputSchema)) {
			return nil, fmt.Errorf(
				"capability %s owner tool %q: input_schema is not valid JSON", dir, decls[i].Name)
		}
		out = append(out, mcpplugin.OwnerTool{
			Name: decls[i].Name, Tool: decls[i].Tool,
			Description: decls[i].Description, InputSchema: decls[i].InputSchema,
		})
	}
	return out, nil
}

// fields —— 配置项声明 → manifest(owner 面和码上那两处同一套)。
func fields(decls []fieldDesc) []mcpplugin.ConfigField {
	out := make([]mcpplugin.ConfigField, 0, len(decls))
	for i := range decls {
		out = append(out, mcpplugin.ConfigField{
			Key: decls[i].Key, Label: decls[i].Label, Type: decls[i].Type,
			Description: decls[i].Description, Default: decls[i].Default,
			Min: decls[i].Min, Max: decls[i].Max,
		})
	}
	return out
}
