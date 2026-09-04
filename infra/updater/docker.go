package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

const (
	labelProject = "com.docker.compose.project"
	labelService = "com.docker.compose.service"
	stopTimeout  = 30 // seconds a container gets to stop before a kill
)

type docker struct{ cli *client.Client }

func newDocker() (*docker, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("new docker client: %w", err)
	}
	return &docker{cli: cli}, nil
}

func (d *docker) Close() error { return d.cli.Close() }

// identity — which compose project + service THIS updater is.
type identity struct {
	project string
	service string
}

// selfIdentity — inspect our OWN container (the hostname is our container id under compose) to read
// the compose project + service we belong to. This is how the updater learns the real project name
// without being told — the crux of staying deployment-agnostic.
func (d *docker) selfIdentity(ctx context.Context) (identity, error) {
	host, err := os.Hostname()
	if err != nil {
		return identity{}, fmt.Errorf("hostname: %w", err)
	}
	insp, err := d.cli.ContainerInspect(ctx, host)
	if err != nil {
		return identity{}, fmt.Errorf("inspect self (%s): %w", host, err)
	}
	project := insp.Config.Labels[labelProject]
	if project == "" {
		return identity{}, fmt.Errorf("own container has no %s label — not under docker compose", labelProject)
	}
	return identity{project: project, service: insp.Config.Labels[labelService]}, nil
}

// sibling — one container in our project.
type sibling struct {
	id      string
	service string
	image   string
}

// projectContainers — the containers carrying our project label.
func (d *docker) projectContainers(ctx context.Context, project string) ([]sibling, error) {
	list, err := d.cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: filters.NewArgs(filters.Arg("label", labelProject+"="+project)),
	})
	if err != nil {
		return nil, fmt.Errorf("list project containers: %w", err)
	}
	out := make([]sibling, 0, len(list))
	for i := range list {
		// ContainerList's .Image can be a bare digest (sha256:…); the ref the container was
		// created with lives in Config.Image, which is what the prefix match + tag bump need.
		ref := list[i].Image
		if insp, ierr := d.cli.ContainerInspect(ctx, list[i].ID); ierr == nil {
			ref = insp.Config.Image
		}
		out = append(out, sibling{
			id: list[i].ID, service: list[i].Labels[labelService], image: ref,
		})
	}
	return out, nil
}

// recreate — pull newImage, then replace the container IN PLACE: stop + remove the old one and
// create a new one from its OWN inspected config (same name, env, volumes, networks, labels,
// restart policy — everything) with only the image changed. Nothing is invented, so the secrets in
// its env and the data on its volumes ride along untouched.
func (d *docker) recreate(ctx context.Context, s sibling, newImage string) error {
	if err := d.pull(ctx, newImage); err != nil {
		return err
	}
	insp, err := d.cli.ContainerInspect(ctx, s.id)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", s.service, err)
	}
	name := strings.TrimPrefix(insp.Name, "/")
	cfg := insp.Config
	cfg.Image = newImage

	timeout := stopTimeout
	if err := d.cli.ContainerStop(ctx, s.id, container.StopOptions{Timeout: &timeout}); err != nil {
		return fmt.Errorf("stop %s: %w", s.service, err)
	}
	if err := d.cli.ContainerRemove(ctx, s.id, container.RemoveOptions{}); err != nil {
		return fmt.Errorf("remove %s: %w", s.service, err)
	}

	first, rest := splitNetworks(insp.NetworkSettings.Networks)
	created, err := d.cli.ContainerCreate(ctx, cfg, insp.HostConfig, first, nil, name)
	if err != nil {
		return fmt.Errorf("create %s: %w", s.service, err)
	}
	for netName, ep := range rest {
		if err := d.cli.NetworkConnect(ctx, netName, created.ID, ep); err != nil {
			return fmt.Errorf("connect %s to %s: %w", s.service, netName, err)
		}
	}
	if err := d.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start %s: %w", s.service, err)
	}
	return nil
}

// splitNetworks — ContainerCreate attaches exactly one endpoint; the rest are connected after.
// The DNS aliases are kept (service discovery depends on them); the concrete runtime IP is cleared
// so the daemon assigns a fresh one (the old container held that address).
func splitNetworks(
	nets map[string]*network.EndpointSettings,
) (*network.NetworkingConfig, map[string]*network.EndpointSettings) {
	rest := map[string]*network.EndpointSettings{}
	var firstName string
	var firstEP *network.EndpointSettings
	for name, ep := range nets {
		cleanEndpoint(ep)
		if firstName == "" {
			firstName, firstEP = name, ep
			continue
		}
		rest[name] = ep
	}
	if firstName == "" {
		return &network.NetworkingConfig{}, rest
	}
	one := map[string]*network.EndpointSettings{firstName: firstEP}
	return &network.NetworkingConfig{EndpointsConfig: one}, rest
}

func cleanEndpoint(ep *network.EndpointSettings) {
	ep.IPAddress = ""
	ep.IPPrefixLen = 0
	ep.Gateway = ""
	ep.GlobalIPv6Address = ""
	ep.EndpointID = ""
	ep.NetworkID = ""
}

// pull — pull the image, draining the progress stream to completion (the pull isn't done until the
// stream ends).
func (d *docker) pull(ctx context.Context, ref string) error {
	rc, err := d.cli.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pull %s: %w", ref, err)
	}
	defer func() { _ = rc.Close() }()
	if _, cerr := io.Copy(io.Discard, rc); cerr != nil {
		return fmt.Errorf("pull %s (drain): %w", ref, cerr)
	}
	return nil
}
