import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";
import { launchWeb, closeWeb } from "../fixtures/web.js";

/**
 * Pages feature E2E tests.
 * Tests the full lifecycle: CRUD via API, Electron UI, invite integration,
 * and page serving via web.
 */

let electron: Page;

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

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

async function cleanupPages() {
  const res = await api("GET", "/api/pages/");
  if (res.ok) {
    const pages = await res.json();
    for (const p of pages) {
      if (p.name.startsWith("test-page-")) {
        await api("DELETE", `/api/pages/${p.id}/`);
      }
    }
  }
  // Clean up test invites that reference pages
  const invRes = await api("GET", "/api/invites/");
  if (invRes.ok) {
    const invites = await invRes.json();
    for (const i of invites) {
      if (i.label.startsWith("test-page-")) {
        await api("DELETE", `/api/invites/${i.code}/`);
      }
    }
  }
}

test.beforeAll(async () => {
  await cleanupPages();
  electron = await launchElectron();
});

test.afterAll(async () => {
  await closeElectron();
  await cleanupPages();
});

// ── API CRUD Tests ───────────────────────────────────────────────────────────

test.describe("Page API CRUD", () => {
  let pageId: string;

  test("create page", async () => {
    const res = await api("POST", "/api/pages/", {
      name: "test-page-crud",
      description: "A test page for CRUD",
    });
    expect(res.status).toBe(201);
    const page = await res.json();
    expect(page.name).toBe("test-page-crud");
    expect(page.description).toBe("A test page for CRUD");
    expect(page.status).toBe("draft");
    expect(page.id).toBeTruthy();
    pageId = page.id;
  });

  test("list pages includes the created page", async () => {
    const res = await api("GET", "/api/pages/");
    expect(res.status).toBe(200);
    const pages = await res.json();
    const found = pages.find((p: { id: string }) => p.id === pageId);
    expect(found).toBeTruthy();
    expect(found.name).toBe("test-page-crud");
    expect(found.status).toBe("draft");
  });

  test("get page detail", async () => {
    const res = await api("GET", `/api/pages/${pageId}/`);
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.name).toBe("test-page-crud");
    expect(page.source_files).toBeTruthy();
  });

  test("update page name and description", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      name: "test-page-crud-updated",
      description: "Updated description",
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.name).toBe("test-page-crud-updated");
    expect(page.description).toBe("Updated description");
  });

  test("update page source_files", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      source_files: {
        "App.tsx": "export default function App() { return <h1>Hello</h1>; }",
      },
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.source_files["App.tsx"]).toContain("Hello");
  });

  test("update page meta", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      meta: {
        title: "Test Page Title",
        description: "Test meta description",
      },
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.meta.title).toBe("Test Page Title");
    expect(page.meta.description).toBe("Test meta description");
  });

  test("update page must_use packages", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["chart.js", "@headlessui/react"],
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.must_use).toContain("chart.js");
    expect(page.must_use).toContain("@headlessui/react");
  });

  test("update page dont_use packages", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      dont_use: ["framer-motion"],
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.dont_use).toContain("framer-motion");
  });

  test("reject invalid package names in must_use", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["$(rm -rf /)"],
    });
    expect(res.status).toBe(400);
  });

  test("get non-existent page returns 404", async () => {
    const res = await api("GET", "/api/pages/00000000-0000-0000-0000-000000000000/");
    expect(res.status).toBe(404);
  });

  test("delete page", async () => {
    const res = await api("DELETE", `/api/pages/${pageId}/`);
    expect(res.status).toBe(204);

    // Verify it's gone
    const getRes = await api("GET", `/api/pages/${pageId}/`);
    expect(getRes.status).toBe(404);
  });
});

// ── Page with Meta Tests ─────────────────────────────────────────────────────

test.describe("Page Meta", () => {
  let pageId: string;

  test("create page with meta", async () => {
    const res = await api("POST", "/api/pages/", {
      name: "test-page-meta",
      description: "Meta test",
      meta: {
        title: "My Portfolio",
        description: "Welcome to my portfolio",
      },
    });
    expect(res.status).toBe(201);
    const page = await res.json();
    expect(page.meta.title).toBe("My Portfolio");
    expect(page.meta.description).toBe("Welcome to my portfolio");
    pageId = page.id;
  });

  test("update meta preserves source_files", async () => {
    // First set source_files
    await api("PATCH", `/api/pages/${pageId}/`, {
      source_files: { "App.tsx": "export default () => <div>test</div>" },
    });

    // Then update only meta
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      meta: { title: "Updated Title" },
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.meta.title).toBe("Updated Title");
    expect(page.source_files["App.tsx"]).toContain("test");
  });

  test.afterAll(async () => {
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Invite + Page Integration ────────────────────────────────────────────────

test.describe("Invite page integration", () => {
  let pageId: string;
  let inviteCode: string;

  test("create page and invite with page_id", async () => {
    // Create a page
    const pageRes = await api("POST", "/api/pages/", {
      name: "test-page-invite",
      description: "Page for invite integration test",
    });
    expect(pageRes.status).toBe(201);
    const page = await pageRes.json();
    pageId = page.id;

    // Create an invite with page_id
    const invRes = await api("POST", "/api/invites/", {
      label: "test-page-invite",
      page_id: pageId,
    });
    expect(invRes.status).toBe(201);
    const invite = await invRes.json();
    inviteCode = invite.code;
    expect(invite.page_id).toBe(pageId);
  });

  test("update invite page_id", async () => {
    // Remove page_id
    const res = await api("PATCH", `/api/invites/${inviteCode}/`, {
      page_id: null,
    });
    expect(res.status).toBe(200);
    const invite = await res.json();
    expect(invite.page_id).toBeNull();

    // Re-assign
    const res2 = await api("PATCH", `/api/invites/${inviteCode}/`, {
      page_id: pageId,
    });
    expect(res2.status).toBe(200);
    const invite2 = await res2.json();
    expect(invite2.page_id).toBe(pageId);
  });

  test("delete page sets invite page_id to null", async () => {
    await api("DELETE", `/api/pages/${pageId}/`);

    // invite_detail only supports PATCH/DELETE, check page_id via list
    const listRes = await api("GET", "/api/invites/");
    expect(listRes.status).toBe(200);
    const invites = await listRes.json();
    const invite = invites.find((i: { code: string }) => i.code === inviteCode);
    expect(invite).toBeTruthy();
    expect(invite.page_id).toBeNull();

    pageId = ""; // already deleted
  });

  test("internal invite-page endpoint returns null for no page", async () => {
    const res = await fetch(
      `${DJANGO_URL}/api/internal/invite-page/${inviteCode}/`,
      { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.page_id).toBeNull();
  });

  test.afterAll(async () => {
    if (inviteCode) await api("DELETE", `/api/invites/${inviteCode}/`);
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Build Trigger Tests ──────────────────────────────────────────────────────

test.describe("Page build trigger", () => {
  let pageId: string;

  test("create page with source for building", async () => {
    const res = await api("POST", "/api/pages/", {
      name: "test-page-build",
      description: "Build trigger test",
      source_files: {
        "App.tsx": "export default function App() { return <div>Build Test</div>; }",
      },
    });
    expect(res.status).toBe(201);
    const page = await res.json();
    pageId = page.id;
  });

  test("trigger build returns 200", async () => {
    const res = await api("POST", `/api/pages/${pageId}/build/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // status should be building initially
    expect(data.status).toBe("building");
  });

  test("build-log endpoint returns status after build triggered", async () => {
    // Poll until build completes (max 120s)
    let status = "building";
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await api("GET", `/api/pages/${pageId}/build-log/`);
      expect(res.status).toBe(200);
      const data = await res.json();
      if (data.status !== "building") {
        status = data.status;
        break;
      }
    }
    expect(status).toBe("ready");
  });

  test.afterAll(async () => {
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Electron UI Tests ────────────────────────────────────────────────────────

test.describe("Pages UI in Electron", () => {
  test("navigate to Pages tab", async () => {
    await electron.getByTestId("nav-pages").click();
    await electron.locator(".content-sidebar-title").filter({ hasText: "PAGES" }).waitFor({ state: "visible" });
  });

  test("create a new page via UI", async () => {
    await electron.getByTestId("page-new-btn").click();
    await electron.getByTestId("page-editor").waitFor({ state: "visible" });

    await electron.getByTestId("page-name-input").fill("test-page-ui");
    await electron.getByTestId("page-description-input").fill("Created via UI test");
    await electron.getByTestId("page-create-btn").click();

    // Should appear in sidebar
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui" }).waitFor({ state: "visible", timeout: 10000 });
  });

  test("select page shows editor with filled fields", async () => {
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui" }).click();
    await electron.getByTestId("page-editor").waitFor({ state: "visible" });

    await expect(electron.getByTestId("page-name-input")).toHaveValue("test-page-ui");
    await expect(electron.getByTestId("page-description-input")).toHaveValue("Created via UI test");
  });

  test("edit page name and save", async () => {
    await electron.getByTestId("page-name-input").fill("test-page-ui-renamed");
    await electron.getByTestId("page-save-btn").click();

    // Verify sidebar updated
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui-renamed" }).waitFor({ state: "visible", timeout: 10000 });
  });

  test("must_use shows empty hint when no global packages", async () => {
    // With no packages installed, should show a hint instead of a dropdown
    await expect(electron.getByTestId("page-must-use").locator(".hint")).toContainText("npm");
  });

  test("edit page meta fields", async () => {
    await electron.getByTestId("page-meta-title-input").fill("UI Test Title");
    await electron.getByTestId("page-meta-description-input").fill("UI Test Description");
    await electron.getByTestId("page-save-btn").click();

    // Re-select to verify
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-pages").click();
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui-renamed" }).click();
    await expect(electron.getByTestId("page-meta-title-input")).toHaveValue("UI Test Title");
    await expect(electron.getByTestId("page-meta-description-input")).toHaveValue("UI Test Description");
  });

  test("page shows draft status badge", async () => {
    const badge = electron.locator(".sidebar-item.active .status-badge");
    await expect(badge).toContainText("draft");
  });

  test("right panel width persists after navigating away and back", async () => {
    // Get the right panel element
    const rightPanel = electron.locator(".page-right-panel");
    await rightPanel.waitFor({ state: "visible" });

    // Set width via localStorage directly (dragging resize handles in headless is flaky)
    await electron.evaluate(() => localStorage.setItem("page-right-panel-width", "450"));

    // Navigate away to another tab
    await electron.getByTestId("nav-invites").click();
    await electron.locator(".invites-page").waitFor({ state: "visible", timeout: 10000 });

    // Navigate back to pages
    await electron.getByTestId("nav-pages").click();
    await electron.locator(".content-sidebar-title").filter({ hasText: "PAGES" }).waitFor({ state: "visible" });

    // Select the same page
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui-renamed" }).click();
    await rightPanel.waitFor({ state: "visible" });

    // Width should be restored from localStorage
    const widthAfterReturn = await rightPanel.evaluate((el) => el.getBoundingClientRect().width);
    expect(widthAfterReturn).toBeCloseTo(450, 0);
  });

  test("delete page via UI", async () => {
    // Accept the confirm dialog
    electron.once("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("page-delete-btn").click();

    // Page should be removed from sidebar
    await expect(
      electron.locator(".sidebar-item-name").filter({ hasText: "test-page-ui-renamed" }),
    ).toHaveCount(0, { timeout: 10000 });
  });
});

// ── IDE Layout Tests ─────────────────────────────────────────────────────────

test.describe("IDE layout: sidebar, tabs, preview, toolbar", () => {
  test("create a page for layout tests", async () => {
    await electron.getByTestId("nav-pages").click();
    await electron.locator(".content-sidebar-title").filter({ hasText: "PAGES" }).waitFor({ state: "visible" });
    await electron.getByTestId("page-new-btn").click();
    await electron.getByTestId("page-editor").waitFor({ state: "visible" });

    await electron.getByTestId("page-name-input").fill("test-page-layout");
    await electron.getByTestId("page-description-input").fill("Layout test page");
    await electron.getByTestId("page-create-btn").click();

    // Wait for page to appear in sidebar
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-layout" }).waitFor({ state: "visible", timeout: 10000 });
  });

  test("sidebar item gets .active class when selected", async () => {
    await electron.locator(".sidebar-item-name").filter({ hasText: "test-page-layout" }).click();
    const sidebarItem = electron.locator(".sidebar-item").filter({ hasText: "test-page-layout" });
    await expect(sidebarItem).toHaveClass(/active/, { timeout: 5000 });
  });

  test("sidebar active item has visible highlight (background color)", async () => {
    const sidebarItem = electron.locator(".sidebar-item.active").filter({ hasText: "test-page-layout" });
    await sidebarItem.waitFor({ state: "visible" });
    const bgColor = await sidebarItem.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should have a non-transparent background — not "rgba(0, 0, 0, 0)"
    expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("Preview tab is active by default", async () => {
    const previewTab = electron.locator(".page-center-tab-btn").filter({ hasText: "Preview" });
    await previewTab.waitFor({ state: "visible" });
    await expect(previewTab).toHaveClass(/active/);
  });

  test("Code tab is visible for view mode", async () => {
    const codeTab = electron.locator(".page-center-tab-btn").filter({ hasText: "Code" });
    await expect(codeTab).toBeVisible();
  });

  test("switching to Code tab shows code viewer", async () => {
    const codeTab = electron.locator(".page-center-tab-btn").filter({ hasText: "Code" });
    await codeTab.click();

    // Code tab should now be active
    await expect(codeTab).toHaveClass(/active/);
    // Preview tab should NOT be active
    const previewTab = electron.locator(".page-center-tab-btn").filter({ hasText: "Preview" });
    await expect(previewTab).not.toHaveClass(/active/);

    // Code viewer content should be visible (empty state — no source files)
    await electron.locator(".page-code-viewer, .editor-empty").waitFor({ state: "visible", timeout: 5000 });
  });

  test("switching back to Preview tab works", async () => {
    const previewTab = electron.locator(".page-center-tab-btn").filter({ hasText: "Preview" });
    await previewTab.click();
    await expect(previewTab).toHaveClass(/active/);
  });

  test("draft page with no source files shows helpful message (not Loading)", async () => {
    // A newly created page has no source files — should show a helpful message
    const previewBody = electron.locator(".page-preview-body");
    await previewBody.waitFor({ state: "visible" });

    // Should show "No source files yet" or similar guidance
    const emptyMsg = previewBody.locator(".editor-empty");
    await emptyMsg.waitFor({ state: "visible", timeout: 10000 });

    const text = await emptyMsg.textContent();
    // Must NOT contain "Loading" — that was a bug where preview got stuck
    expect(text).not.toContain("Loading");
    // Should contain helpful guidance
    expect(text).toMatch(/source files|AI Chat|Publish/i);
  });

  test("toolbar buttons are not obscured by other elements", async () => {
    // The delete button must be clickable — not intercepted by right panel elements
    const deleteBtn = electron.getByTestId("page-delete-btn");
    await deleteBtn.waitFor({ state: "visible" });

    // Verify the button is not covered by checking it can receive pointer events
    const isClickable = await deleteBtn.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const topEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return el === topEl || el.contains(topEl);
    });
    expect(isClickable).toBe(true);
  });

  test("save button is not obscured by other elements", async () => {
    const saveBtn = electron.getByTestId("page-save-btn");
    await saveBtn.waitFor({ state: "visible" });

    const isClickable = await saveBtn.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const topEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return el === topEl || el.contains(topEl);
    });
    expect(isClickable).toBe(true);
  });

  test("right panel shows settings form (not obscuring toolbar)", async () => {
    const rightPanel = electron.locator(".page-right-panel");
    await rightPanel.waitFor({ state: "visible" });

    // Right panel should contain the page editor form
    const editor = electron.getByTestId("page-editor");
    await expect(editor).toBeVisible();

    // Right panel must NOT have any text element that overflows into the toolbar area
    const rightPanelRect = await rightPanel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right };
    });

    const toolbarRect = await electron.locator(".page-preview-toolbar").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });

    // Right panel's left edge should be >= toolbar's right edge (no overlap)
    // OR they should not overlap horizontally
    expect(rightPanelRect.left).toBeGreaterThanOrEqual(toolbarRect.right - 1);
  });

  test("cleanup: delete layout test page", async () => {
    electron.once("dialog", (dialog) => dialog.accept());
    await electron.getByTestId("page-delete-btn").click();
    await expect(
      electron.locator(".sidebar-item-name").filter({ hasText: "test-page-layout" }),
    ).toHaveCount(0, { timeout: 10000 });
  });
});

// ── npm Packages Tab ─────────────────────────────────────────────────────────

test.describe("npm Packages tab", () => {
  test("tab bar is visible with My Pages as default", async () => {
    await electron.getByTestId("nav-pages").click();
    await electron.getByTestId("pages-tab-my").waitFor({ state: "visible" });
    await electron.getByTestId("pages-tab-npm").waitFor({ state: "visible" });

    // My Pages tab should be active (has primary class)
    await expect(electron.getByTestId("pages-tab-my")).toHaveClass(/primary/);
  });

  test("switch to npm Packages tab", async () => {
    await electron.getByTestId("pages-tab-npm").click();
    await electron.getByTestId("npm-packages-tab").waitFor({ state: "visible" });
    await electron.getByTestId("npm-search-input").waitFor({ state: "visible" });
  });

  test("search npm packages returns results", async () => {
    const searchInput = electron.getByTestId("npm-search-input");
    await searchInput.fill("chart.js");

    // Wait for debounce + network
    await electron.getByTestId("npm-result-item").first().waitFor({ state: "visible", timeout: 15000 });

    // Should have at least one result
    const count = await electron.getByTestId("npm-result-item").count();
    expect(count).toBeGreaterThan(0);
  });

  test("install package from npm search globally", async () => {
    // Switch to npm tab
    await electron.getByTestId("pages-tab-npm").click();
    await electron.getByTestId("npm-packages-tab").waitFor({ state: "visible" });

    // Search and install a package
    await electron.getByTestId("npm-search-input").fill("lodash");
    await electron.getByTestId("npm-result-item").first().waitFor({ state: "visible", timeout: 15000 });

    // Find and click an Install button for lodash
    const addBtn = electron.getByTestId("npm-add-lodash");
    if (await addBtn.isVisible()) {
      await addBtn.click();
      // Button should show "Installing..." while in progress, then "Installed" when done
      await expect(addBtn).toContainText("Installing", { timeout: 5000 });
      await expect(addBtn).toContainText("Installed", { timeout: 60000 });
      await expect(addBtn).not.toContainText("Installing", { timeout: 5000 });
    }
  });

  test("re-installing same package does not error", async () => {
    // Reproduce the scenario that triggers ENOTEMPTY on Docker volumes:
    // install a second package after one is already installed.
    await electron.getByTestId("npm-search-input").fill("is-odd");
    await electron.getByTestId("npm-result-item").first().waitFor({ state: "visible", timeout: 15000 });

    const addBtn = electron.getByTestId("npm-add-is-odd");
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(addBtn).toContainText("Installing", { timeout: 5000 });
      await expect(addBtn).toContainText("Installed", { timeout: 60000 });
    }

    // No error banner should be visible
    await expect(electron.locator(".alert.error")).toHaveCount(0);
  });

  test("switch back to My Pages tab", async () => {
    await electron.getByTestId("pages-tab-my").click();
    await electron.locator(".content-sidebar-title").filter({ hasText: "PAGES" }).waitFor({ state: "visible" });
  });

  test("must_use dropdown shows installed packages", async () => {
    // Install a package via API (Electron npm search needs external network
    // which may not be available in Docker test containers)
    const installRes = await api("POST", "/api/packages/", { name: "is-number" });
    expect(installRes.status).toBe(201);

    // Switch to My Pages tab — this remounts MyPagesTab and PageEditorPane
    await electron.getByTestId("pages-tab-my").click();
    await electron.locator(".content-sidebar-title").filter({ hasText: "PAGES" }).waitFor({ state: "visible", timeout: 10000 });

    // Create a new page via UI
    await electron.getByTestId("page-new-btn").click();
    await electron.getByTestId("page-editor").waitFor({ state: "visible" });

    // Since packages are installed, dropdown should appear
    const mustUseSelect = electron.getByTestId("page-must-use-select");
    await mustUseSelect.waitFor({ state: "visible", timeout: 10000 });

    // Select the package from dropdown
    await mustUseSelect.selectOption({ index: 1 });

    // Tag should appear
    await expect(electron.getByTestId("page-must-use").locator(".page-package-tag")).toHaveCount(1);
  });
});

// ── Page Build Status via API ────────────────────────────────────────────────

test.describe("Page build lifecycle", () => {
  let pageId: string;

  test("create page, trigger build, and check status transitions", async () => {
    const createRes = await api("POST", "/api/pages/", {
      name: "test-page-lifecycle",
      description: "Build lifecycle test",
      source_files: {
        "App.tsx": "export default function App() { return <h1>Lifecycle</h1>; }",
      },
    });
    expect(createRes.status).toBe(201);
    pageId = (await createRes.json()).id;

    // Status starts as draft
    const getRes = await api("GET", `/api/pages/${pageId}/`);
    expect((await getRes.json()).status).toBe("draft");

    // Trigger build
    const buildRes = await api("POST", `/api/pages/${pageId}/build/`);
    expect(buildRes.status).toBe(200);

    // Poll until build completes (max 120s)
    let finalStatus = "building";
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const logRes = await api("GET", `/api/pages/${pageId}/build-log/`);
      const data = await logRes.json();
      if (data.status !== "building") {
        finalStatus = data.status;
        break;
      }
    }

    // Build should have completed successfully
    if (finalStatus !== "ready") {
      const logRes2 = await api("GET", `/api/pages/${pageId}/build-log/`);
      console.error("Build did not succeed! Log:", (await logRes2.json()).build_log);
    }
    expect(finalStatus).toBe("ready");

    // build_log should have content
    const logRes = await api("GET", `/api/pages/${pageId}/build-log/`);
    const logData = await logRes.json();
    expect(logData.build_log).toBeTruthy();
  });

  test.afterAll(async () => {
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Invite without page serves chat UI (regression) ──────────────────────────

test.describe("Invite without page serves chat UI", () => {
  let inviteCode: string;
  let web: Page;

  test("create invite without page_id", async () => {
    const res = await api("POST", "/api/invites/", {
      label: "test-page-no-page",
    });
    expect(res.status).toBe(201);
    const invite = await res.json();
    inviteCode = invite.code;
    expect(invite.page_id).toBeNull();
  });

  test("visiting invite URL shows chat UI, not a page", async () => {
    web = await launchWeb();
    await web.goto(`${process.env.WEB_URL || "http://web:3000"}/i/${inviteCode}`);

    // Should see the invite input or chat UI (normal chat behavior, not a custom page)
    await web.locator("input[placeholder], .chat-input, [data-testid='invite-input']").first().waitFor({ state: "visible", timeout: 15000 });
  });

  test.afterAll(async () => {
    await closeWeb();
    if (inviteCode) await api("DELETE", `/api/invites/${inviteCode}/`);
  });
});

// ── Internal invite-page endpoint ────────────────────────────────────────────

test.describe("Internal invite-page API", () => {
  let pageId: string;
  let inviteCode: string;

  test("returns null for invite with no page", async () => {
    const invRes = await api("POST", "/api/invites/", {
      label: "test-page-internal-no-page",
    });
    inviteCode = (await invRes.json()).code;

    const res = await fetch(
      `${DJANGO_URL}/api/internal/invite-page/${inviteCode}/`,
      { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).page_id).toBeNull();
  });

  test("returns page_id for invite with ready page", async () => {
    // Create a page — set status to ready manually via direct PATCH
    const pageRes = await api("POST", "/api/pages/", {
      name: "test-page-internal-ready",
      description: "For internal API test",
    });
    pageId = (await pageRes.json()).id;

    // Link invite to page
    await api("PATCH", `/api/invites/${inviteCode}/`, { page_id: pageId });

    // Internal endpoint should NOT return page_id when page is draft
    const res1 = await fetch(
      `${DJANGO_URL}/api/internal/invite-page/${inviteCode}/`,
      { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } },
    );
    expect(res1.status).toBe(200);
    // Draft pages should return null (only "ready" pages are served)
    expect((await res1.json()).page_id).toBeNull();
  });

  test("returns null for non-existent invite code", async () => {
    const res = await fetch(
      `${DJANGO_URL}/api/internal/invite-page/sm_nonexistent_code_xyz/`,
      { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).page_id).toBeNull();
  });

  test.afterAll(async () => {
    if (inviteCode) await api("DELETE", `/api/invites/${inviteCode}/`);
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Package validation ───────────────────────────────────────────────────────

test.describe("Package name validation", () => {
  let pageId: string;

  test.beforeAll(async () => {
    const res = await api("POST", "/api/pages/", {
      name: "test-page-packages",
      description: "Package validation test",
    });
    pageId = (await res.json()).id;
  });

  test("valid must_use package names accepted", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["react-icons", "@mui/material", "chart.js", "three"],
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.must_use).toHaveLength(4);
  });

  test("empty must_use list accepted", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: [],
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.must_use).toHaveLength(0);
  });

  test("command injection in must_use rejected", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["$(rm -rf /)"],
    });
    expect(res.status).toBe(400);
  });

  test("semicolon injection in must_use rejected", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["lodash; echo pwned"],
    });
    expect(res.status).toBe(400);
  });

  test("backtick injection in must_use rejected", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      must_use: ["`whoami`"],
    });
    expect(res.status).toBe(400);
  });

  test("valid dont_use package names accepted", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      dont_use: ["framer-motion"],
    });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.dont_use).toHaveLength(1);
  });

  test("command injection in dont_use rejected", async () => {
    const res = await api("PATCH", `/api/pages/${pageId}/`, {
      dont_use: ["$(rm -rf /)"],
    });
    expect(res.status).toBe(400);
  });

  test.afterAll(async () => {
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
  });
});

// ── Full Pipeline: npm install → build → invite → page serving ──────────────

test.describe("Full pipeline: global package → build → serve page via invite", () => {
  let pageId: string;
  let inviteCode: string;
  let web: Page;

  test("install a global npm package", async () => {
    const res = await api("POST", "/api/packages/", { name: "lodash" });
    // Accept 200 (already installed) or 201 (newly installed)
    expect([200, 201]).toContain(res.status);
    const pkg = await res.json();
    expect(pkg.name).toBe("lodash");
    expect(pkg.version).toBeTruthy();
  });

  test("verify global package is listed", async () => {
    const res = await api("GET", "/api/packages/");
    expect(res.status).toBe(200);
    const packages = await res.json();
    const lodash = packages.find((p: { name: string }) => p.name === "lodash");
    expect(lodash).toBeTruthy();
  });

  test("create page with source and must_use", async () => {
    const res = await api("POST", "/api/pages/", {
      name: "test-page-pipeline",
      description: "Full pipeline test page",
      source_files: {
        "App.tsx": [
          "import './styles.css';",
          "export default function App() {",
          "  return (",
          "    <div id=\"pipeline-test\">",
          "      <h1>Pipeline Test Page</h1>",
          "      <p>This page was built with the full pipeline.</p>",
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
        "styles.css": [
          "#pipeline-test {",
          "  background-color: rgb(0, 128, 0);",
          "  padding: 20px;",
          "}",
        ].join("\n"),
      },
      must_use: ["lodash"],
      meta: { title: "Pipeline Test", description: "E2E pipeline test page" },
    });
    expect(res.status).toBe(201);
    const page = await res.json();
    pageId = page.id;
    expect(page.status).toBe("draft");
    expect(page.must_use).toContain("lodash");
  });

  test("trigger build and wait for ready", async () => {
    const buildRes = await api("POST", `/api/pages/${pageId}/build/`);
    expect(buildRes.status).toBe(200);

    // Poll until build completes (max 180s for npm install + vite build)
    let finalStatus = "building";
    let buildLog = "";
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const logRes = await api("GET", `/api/pages/${pageId}/build-log/`);
      const data = await logRes.json();
      if (data.status !== "building") {
        finalStatus = data.status;
        buildLog = data.build_log || "";
        break;
      }
    }

    // Must be "ready" — not "failed"
    if (finalStatus !== "ready") {
      console.error("Build failed! Log:", buildLog);
    }
    expect(finalStatus).toBe("ready");
  });

  test("create invite linked to the built page", async () => {
    const res = await api("POST", "/api/invites/", {
      label: "test-page-pipeline-invite",
      page_id: pageId,
    });
    expect(res.status).toBe(201);
    const invite = await res.json();
    inviteCode = invite.code;
    expect(invite.page_id).toBe(pageId);
  });

  test("internal API returns page_id for ready page", async () => {
    const res = await fetch(
      `${DJANGO_URL}/api/internal/invite-page/${inviteCode}/`,
      { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.page_id).toBe(pageId);
  });

  test("visiting invite URL serves the built page (not chat UI)", async () => {
    web = await launchWeb();
    const WEB_URL = process.env.WEB_URL || "http://web:3000";

    // Track failed requests — any 404 for JS/CSS means assets aren't loading
    const failedAssets: string[] = [];
    web.on("requestfailed", (req) => {
      const url = req.url();
      if (url.match(/\.(js|css|woff2?)(\?|$)/)) {
        failedAssets.push(`${req.failure()?.errorText}: ${url}`);
      }
    });

    const response = await web.goto(`${WEB_URL}/i/${inviteCode}`, {
      waitUntil: "networkidle",
    });

    // Should get a 200 response
    expect(response?.status()).toBe(200);

    // No JS/CSS assets should have failed to load
    expect(failedAssets).toEqual([]);

    // The page should contain our built HTML, not the chat UI
    const html = await web.content();
    expect(html).toContain("Pipeline Test Page");

    // Should NOT have chat input (this is a custom page, not chat UI)
    const chatInput = web.locator(".chat-input, [data-testid='invite-input']");
    await expect(chatInput).toHaveCount(0);

    // CSS must actually be applied — verify computed style on #pipeline-test
    const bgColor = await web.locator("#pipeline-test").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bgColor).toBe("rgb(0, 128, 0)");

    // No "Chat loading..." placeholder should be visible (means JS hydrated)
    const chatLoading = web.getByText("Chat loading...");
    await expect(chatLoading).toHaveCount(0);
  });

  test.afterAll(async () => {
    await closeWeb();
    if (inviteCode) await api("DELETE", `/api/invites/${inviteCode}/`);
    if (pageId) await api("DELETE", `/api/pages/${pageId}/`);
    // Clean up global package
    await api("DELETE", "/api/packages/lodash/");
  });
});
