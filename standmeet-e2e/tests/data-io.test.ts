import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";

/**
 * Data import/export round-trip E2E tests.
 * Uses direct IPC (data:exportDirect / data:importDirect) to bypass file dialogs.
 * Tests all granularity levels: full app, per-category, per-object.
 */

let electron: Page;

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

// Helper: API request to Django
async function api(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${OWNER_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${DJANGO_URL}${path}`, opts);
}

// Helper: delete all test data (invites BEFORE roles to avoid FK conflict)
async function cleanupTestData() {
  // Delete test invites FIRST (they reference roles)
  const invitesRes = await api("GET", "/api/invites/");
  if (invitesRes.ok) {
    const invites = await invitesRes.json();
    for (const i of invites) {
      if (i.label.startsWith("export-test-")) {
        await api("DELETE", `/api/invites/${i.code}/`);
      }
    }
  }
  // Delete test content
  for (const path of ["/export-test/profile", "/export-test/bio"]) {
    await api("DELETE", `/api/repo/${path.slice(1)}/`);
  }
  // Delete test skills
  const skillsRes = await api("GET", "/api/skills/");
  if (skillsRes.ok) {
    const skills = await skillsRes.json();
    for (const s of skills) {
      if (s.name.startsWith("export-test-")) {
        await api("DELETE", `/api/skills/${s.id}/`);
      }
    }
  }
  // Delete test MCP servers
  const mcpRes = await api("GET", "/api/mcp-servers/");
  if (mcpRes.ok) {
    const servers = await mcpRes.json();
    for (const s of servers) {
      if (s.name.startsWith("export-test-")) {
        await api("DELETE", `/api/mcp-servers/${s.id}/`);
      }
    }
  }
  // Delete test roles (after invites are gone)
  const rolesRes = await api("GET", "/api/roles/");
  if (rolesRes.ok) {
    const roles = await rolesRes.json();
    for (const r of roles) {
      if (r.name.startsWith("export-test-")) {
        await api("DELETE", `/api/roles/${r.id}/`);
      }
    }
  }
}

test.beforeAll(async () => {
  electron = await launchElectron();
  await cleanupTestData();
});

test.afterAll(async () => {
  await cleanupTestData();
  await closeElectron();
});

test.describe("Data Import/Export", () => {
  let exportedJson: string;

  test("UI: settings page has Data section with Export/Import buttons", async () => {
    await electron.getByTestId("nav-settings").click();
    await electron.getByTestId("data-section").waitFor({ state: "visible" });
    await expect(electron.getByTestId("data-export-btn")).toBeVisible();
    await expect(electron.getByTestId("data-import-btn")).toBeVisible();
  });

  // ── Full app round-trip ──

  test("full app round-trip: create → export → delete → import → verify", async () => {
    // 1. Create test data via API
    const contentRes = await api("POST", "/api/repo/", {
      path: "/export-test/profile",
      content: { name: "Test User", bio: "Hello world" },
      summary: "Test profile",
      visibility: "public",
      show_as_source: true,
    });
    expect(contentRes.status).toBe(201);

    const content2Res = await api("POST", "/api/repo/", {
      path: "/export-test/bio",
      content: { text: "Bio text" },
      summary: "Test bio",
      visibility: "private",
    });
    expect(content2Res.status).toBe(201);

    const skillRes = await api("POST", "/api/skills/", {
      name: "export-test-greeting",
      description: "A greeting skill",
      prompt: "Say hello",
    });
    expect(skillRes.status).toBe(201);

    const mcpRes = await api("POST", "/api/mcp-servers/", {
      name: "export-test-server",
      config: { url: "http://example.com/mcp" },
    });
    expect(mcpRes.status).toBe(201);

    const roleRes = await api("POST", "/api/roles/", {
      name: "export-test-role",
      permissions: [{ action: "allow", path_pattern: "/export-test/**" }],
    });
    expect(roleRes.status).toBe(201);
    const role = await roleRes.json();
    await api("PATCH", `/api/roles/${role.id}/`, { prompt: "Be friendly" });

    const inviteRes = await api("POST", "/api/invites/", {
      label: "export-test-invite",
      role_id: role.id,
      prompt: "Welcome",
      greeting: "Hi there",
    });
    expect(inviteRes.status).toBe(201);

    // 2. Export
    const exportResult = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportDirect();
    });
    expect(exportResult.manifest.version).toBe(1);
    exportedJson = exportResult.json;

    // Verify manifest has all test data
    const m = exportResult.manifest;
    expect(m.content.filter((c: any) => c.path.startsWith("/export-test/")).length).toBe(2);
    expect(m.skills.filter((s: any) => s.name.startsWith("export-test-")).length).toBe(1);
    expect(m.mcp_servers.filter((s: any) => s.name.startsWith("export-test-")).length).toBe(1);
    expect(m.roles.filter((r: any) => r.name.startsWith("export-test-")).length).toBe(1);
    expect(m.invites.filter((i: any) => i.label.startsWith("export-test-")).length).toBe(1);
    expect(m.invites.find((i: any) => i.label === "export-test-invite").role_name).toBe("export-test-role");

    // 3. Delete all
    await cleanupTestData();
    expect((await api("GET", "/api/repo/export-test/profile/")).status).toBe(404);

    // 4. Import all
    const importResult = await electron.evaluate(
      async ({ json }) => {
        return (window as any).standmeet.data.importDirect(json, {
          content: true, skills: true, mcp_servers: true,
          roles: true, invites: true, settings: true, assets: true,
        });
      },
      { json: exportedJson },
    );
    expect(importResult.content.created + importResult.content.updated).toBeGreaterThanOrEqual(2);
    expect(importResult.skills.created).toBeGreaterThanOrEqual(1);
    expect(importResult.mcp_servers.created).toBeGreaterThanOrEqual(1);
    expect(importResult.roles.created).toBeGreaterThanOrEqual(1);
    expect(importResult.invites.created).toBeGreaterThanOrEqual(1);

    // 5. Verify restored data
    const restored = await api("GET", "/api/repo/export-test/profile/");
    expect(restored.status).toBe(200);
    const data = await restored.json();
    expect(data.content.name).toBe("Test User");
    expect(data.visibility).toBe("public");
    expect(data.show_as_source).toBe(true);
  });

  test("selective import: only content and skills", async () => {
    expect(exportedJson).toBeTruthy();
    await cleanupTestData();

    const importResult = await electron.evaluate(
      async ({ json }) => {
        return (window as any).standmeet.data.importDirect(json, {
          content: true, skills: true, mcp_servers: false,
          roles: false, invites: false, settings: false, assets: false,
        });
      },
      { json: exportedJson },
    );
    expect(importResult.content.created + importResult.content.updated).toBeGreaterThanOrEqual(2);
    expect(importResult.skills.created).toBeGreaterThanOrEqual(1);
    expect(importResult.roles.created).toBe(0);
    expect(importResult.mcp_servers.created).toBe(0);
    expect(importResult.invites.created).toBe(0);

    // Verify content exists but role does not
    expect((await api("GET", "/api/repo/export-test/profile/")).status).toBe(200);
    const roles = await (await api("GET", "/api/roles/")).json();
    expect(roles.find((r: any) => r.name === "export-test-role")).toBeFalsy();
  });

  test("conflict handling: existing skill is skipped", async () => {
    expect(exportedJson).toBeTruthy();
    // "export-test-greeting" already exists from previous test
    const importResult = await electron.evaluate(
      async ({ json }) => {
        return (window as any).standmeet.data.importDirect(json, {
          content: false, skills: true, mcp_servers: false,
          roles: false, invites: false, settings: false, assets: false,
        });
      },
      { json: exportedJson },
    );
    expect(importResult.skills.skipped).toBeGreaterThanOrEqual(1);
    expect(importResult.skills.created).toBe(0);
  });

  test("invite association: role_name resolved to role_id on import", async () => {
    expect(exportedJson).toBeTruthy();
    await cleanupTestData();

    // Import roles first, then invites
    await electron.evaluate(
      async ({ json }) => (window as any).standmeet.data.importDirect(json, {
        content: false, skills: false, mcp_servers: false,
        roles: true, invites: false, settings: false, assets: false,
      }),
      { json: exportedJson },
    );
    const importResult = await electron.evaluate(
      async ({ json }) => (window as any).standmeet.data.importDirect(json, {
        content: false, skills: false, mcp_servers: false,
        roles: false, invites: true, settings: false, assets: false,
      }),
      { json: exportedJson },
    );
    expect(importResult.invites.created).toBeGreaterThanOrEqual(1);

    const invites = await (await api("GET", "/api/invites/")).json();
    const testInvite = invites.find((i: any) => i.label === "export-test-invite");
    expect(testInvite).toBeTruthy();
    expect(testInvite.role_id).toBeTruthy();
    const role = await (await api("GET", `/api/roles/${testInvite.role_id}/`)).json();
    expect(role.name).toBe("export-test-role");
  });

  // ── Per-category round-trip ──

  test("per-category round-trip: content", async () => {
    await cleanupTestData();
    await api("POST", "/api/repo/", {
      path: "/export-test/profile",
      content: { name: "Category RT" },
      summary: "Cat RT",
      visibility: "public",
      show_as_source: true,
    });

    // Export category
    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("content");
    });
    expect(Array.isArray(exported)).toBe(true);
    const entry = exported.find((c: any) => c.path === "/export-test/profile");
    expect(entry).toBeTruthy();
    expect(entry.content.name).toBe("Category RT");

    // Delete
    await api("DELETE", "/api/repo/export-test/profile/");
    expect((await api("GET", "/api/repo/export-test/profile/")).status).toBe(404);

    // Import category back
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("content", data),
      { data: exported },
    );
    expect(result.created + result.updated).toBeGreaterThanOrEqual(1);

    // Verify
    const restored = await (await api("GET", "/api/repo/export-test/profile/")).json();
    expect(restored.content.name).toBe("Category RT");
    expect(restored.visibility).toBe("public");
  });

  test("per-category round-trip: skills", async () => {
    await cleanupTestData();
    await api("POST", "/api/skills/", {
      name: "export-test-catskill",
      description: "Category skill",
      prompt: "Do stuff",
    });

    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("skills");
    });
    const entry = exported.find((s: any) => s.name === "export-test-catskill");
    expect(entry).toBeTruthy();
    expect(entry.description).toBe("Category skill");

    // Delete
    const skills = await (await api("GET", "/api/skills/")).json();
    const toDelete = skills.find((s: any) => s.name === "export-test-catskill");
    await api("DELETE", `/api/skills/${toDelete.id}/`);

    // Import back
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("skills", data),
      { data: exported },
    );
    expect(result.created).toBeGreaterThanOrEqual(1);

    // Verify
    const restored = await (await api("GET", "/api/skills/")).json();
    expect(restored.find((s: any) => s.name === "export-test-catskill")).toBeTruthy();
  });

  test("per-category round-trip: roles", async () => {
    await cleanupTestData();
    const roleRes = await api("POST", "/api/roles/", {
      name: "export-test-catrole",
      permissions: [{ action: "allow", path_pattern: "/**" }],
    });
    const role = await roleRes.json();
    await api("PATCH", `/api/roles/${role.id}/`, { prompt: "Role prompt" });

    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("roles");
    });
    const entry = exported.find((r: any) => r.name === "export-test-catrole");
    expect(entry).toBeTruthy();
    expect(entry.prompt).toBe("Role prompt");

    // Delete
    await api("DELETE", `/api/roles/${role.id}/`);

    // Import back
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("roles", data),
      { data: exported },
    );
    expect(result.created).toBeGreaterThanOrEqual(1);

    // Verify
    const restored = await (await api("GET", "/api/roles/")).json();
    const restoredRole = restored.find((r: any) => r.name === "export-test-catrole");
    expect(restoredRole).toBeTruthy();
    expect(restoredRole.prompt).toBe("Role prompt");
  });

  test("per-category round-trip: mcp_servers", async () => {
    await cleanupTestData();
    await api("POST", "/api/mcp-servers/", {
      name: "export-test-catmcp",
      config: { type: "http", url: "http://test.local/mcp" },
    });

    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("mcp_servers");
    });
    const entry = exported.find((m: any) => m.name === "export-test-catmcp");
    expect(entry).toBeTruthy();
    expect(entry.config.url).toBe("http://test.local/mcp");

    // Delete
    const servers = await (await api("GET", "/api/mcp-servers/")).json();
    await api("DELETE", `/api/mcp-servers/${servers.find((s: any) => s.name === "export-test-catmcp").id}/`);

    // Import back
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("mcp_servers", data),
      { data: exported },
    );
    expect(result.created).toBeGreaterThanOrEqual(1);

    // Verify
    const restored = await (await api("GET", "/api/mcp-servers/")).json();
    expect(restored.find((m: any) => m.name === "export-test-catmcp")).toBeTruthy();
  });

  test("per-category round-trip: settings", async () => {
    // Export settings
    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("settings");
    });
    expect(exported).toBeTruthy();
    expect(typeof exported.public_access).toBe("boolean");

    // Change settings
    const original = exported.public_access;
    await electron.evaluate(
      async ({ val }) => (window as any).standmeet.settings.update({ public_access: val }),
      { val: !original },
    );

    // Import back (should restore)
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("settings", data),
      { data: exported },
    );
    expect(result.updated).toBe(1);

    // Verify
    const restored = await electron.evaluate(async () => (window as any).standmeet.settings.get());
    expect(restored.public_access).toBe(original);
  });

  // ── Per-object round-trip ──

  test("per-object round-trip: single skill export → import", async () => {
    await cleanupTestData();
    await api("POST", "/api/skills/", {
      name: "export-test-single",
      description: "Single skill",
      prompt: "Be single",
    });

    // Export category, pick one object
    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("skills");
    });
    const singleSkill = exported.find((s: any) => s.name === "export-test-single");
    expect(singleSkill).toBeTruthy();

    // Delete it
    const skills = await (await api("GET", "/api/skills/")).json();
    await api("DELETE", `/api/skills/${skills.find((s: any) => s.name === "export-test-single").id}/`);

    // Import just the single object (not array)
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("skills", data),
      { data: singleSkill },
    );
    expect(result.created).toBe(1);

    // Verify
    const restored = await (await api("GET", "/api/skills/")).json();
    expect(restored.find((s: any) => s.name === "export-test-single")).toBeTruthy();
  });

  test("per-object round-trip: single role export → import", async () => {
    await cleanupTestData();
    const roleRes = await api("POST", "/api/roles/", {
      name: "export-test-singlerole",
      permissions: [{ action: "deny", path_pattern: "/secret/**" }],
    });
    const role = await roleRes.json();
    await api("PATCH", `/api/roles/${role.id}/`, { prompt: "Secret keeper" });

    // Export category, pick the one object
    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("roles");
    });
    const singleRole = exported.find((r: any) => r.name === "export-test-singlerole");
    expect(singleRole).toBeTruthy();

    // Delete
    await api("DELETE", `/api/roles/${role.id}/`);

    // Import single object
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("roles", data),
      { data: singleRole },
    );
    expect(result.created).toBe(1);

    // Verify
    const restored = await (await api("GET", "/api/roles/")).json();
    const restoredRole = restored.find((r: any) => r.name === "export-test-singlerole");
    expect(restoredRole).toBeTruthy();
    expect(restoredRole.prompt).toBe("Secret keeper");
  });

  test("per-object round-trip: single mcp server export → import", async () => {
    await cleanupTestData();
    await api("POST", "/api/mcp-servers/", {
      name: "export-test-singlemcp",
      config: { type: "stdio", command: "node", args: ["server.js"] },
    });

    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("mcp_servers");
    });
    const single = exported.find((m: any) => m.name === "export-test-singlemcp");
    expect(single).toBeTruthy();

    // Delete
    const servers = await (await api("GET", "/api/mcp-servers/")).json();
    await api("DELETE", `/api/mcp-servers/${servers.find((s: any) => s.name === "export-test-singlemcp").id}/`);

    // Import single
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("mcp_servers", data),
      { data: single },
    );
    expect(result.created).toBe(1);

    const restored = await (await api("GET", "/api/mcp-servers/")).json();
    const restoredMcp = restored.find((m: any) => m.name === "export-test-singlemcp");
    expect(restoredMcp).toBeTruthy();
    expect(restoredMcp.config.command).toBe("node");
  });

  test("per-object round-trip: single content export → import", async () => {
    await cleanupTestData();
    await api("POST", "/api/repo/", {
      path: "/export-test/profile",
      content: { name: "Single Content" },
      summary: "Single",
      visibility: "public",
      show_as_source: true,
    });

    const exported = await electron.evaluate(async () => {
      return (window as any).standmeet.data.exportCategoryDirect("content");
    });
    const single = exported.find((c: any) => c.path === "/export-test/profile");
    expect(single).toBeTruthy();

    // Delete
    await api("DELETE", "/api/repo/export-test/profile/");

    // Import single
    const result = await electron.evaluate(
      async ({ data }) => (window as any).standmeet.data.importCategoryDirect("content", data),
      { data: single },
    );
    expect(result.created).toBe(1);

    const restored = await (await api("GET", "/api/repo/export-test/profile/")).json();
    expect(restored.content.name).toBe("Single Content");
    expect(restored.visibility).toBe("public");
  });

  test("cleanup", async () => {
    await cleanupTestData();
  });
});
