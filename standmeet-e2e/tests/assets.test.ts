import { test, expect, type Page } from "@playwright/test";
import { launchElectron, closeElectron } from "../fixtures/electron.js";

/**
 * Asset management lifecycle.
 * Owner uploads/previews/manages assets in Electron.
 */

let electron: Page;

const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";

test.beforeAll(async () => {
  electron = await launchElectron();
});

test.afterAll(async () => {
  await closeElectron();
});

test.describe("Asset management", () => {
  test("navigate to assets page", async () => {
    await electron.getByTestId("nav-assets").click();
    await electron.getByTestId("assets-page").waitFor({ state: "visible" });
    await electron.getByTestId("assets-empty-state").waitFor({ state: "visible" });
  });

  test("upload asset via API and verify in list", async () => {
    // Upload a test file via the server API directly (simulating the upload)
    const boundary = "----TestBoundary" + Date.now();
    const fileContent = "Hello, this is a test file for e2e.";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      "Content-Type: text/plain",
      "",
      fileContent,
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      "",
      "/test/hello.txt",
      `--${boundary}`,
      'Content-Disposition: form-data; name="visibility"',
      "",
      "private",
      `--${boundary}--`,
    ].join("\r\n");

    const response = await fetch(`${DJANGO_URL}/api/assets/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(response.status).toBe(201);
    const asset = await response.json();
    expect(asset.path).toBe("/test/hello.txt");
    expect(asset.filename).toBe("test.txt");
    expect(asset.visibility).toBe("private");

    // Refresh assets page by navigating away and back
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-assets").click();
    await electron.getByTestId("assets-page").waitFor({ state: "visible" });

    // Verify the file appears in the tree
    await electron.getByTestId("file-tree-item-test-hello.txt").waitFor({ state: "visible", timeout: 15000 });
  });

  test("select asset shows detail", async () => {
    await electron.getByTestId("file-tree-item-test-hello.txt").click();
    await electron.getByTestId("asset-detail").waitFor({ state: "visible" });
    await expect(electron.getByTestId("asset-detail-filename")).toContainText("test.txt");
    await expect(electron.getByTestId("asset-detail-type")).toContainText("plain");
  });

  test("toggle visibility to public", async () => {
    const select = electron.getByTestId("asset-visibility-select");
    await select.selectOption("public");

    // Wait for update to complete - verify select still shows public
    await expect(select).toHaveValue("public");
  });

  test("asset detail has download link", async () => {
    await electron.getByTestId("asset-download-btn").waitFor({ state: "visible" });
  });

  test("delete asset", async () => {
    await electron.getByTestId("asset-delete-btn").click();
    await electron.getByTestId("asset-delete-confirm-btn").waitFor({ state: "visible" });
    await electron.getByTestId("asset-delete-confirm-btn").click();

    // After deletion, the detail should disappear
    await electron.getByTestId("assets-empty-state").waitFor({ state: "visible", timeout: 10000 });
  });

  test("upload via API with tree structure", async () => {
    // Upload multiple files with hierarchical paths
    for (const { path, content } of [
      { path: "/docs/readme.txt", content: "readme content" },
      { path: "/docs/api/spec.json", content: '{"openapi":"3.0"}' },
      { path: "/photos/avatar.png", content: "fake-png-data" },
    ]) {
      const boundary = "----TestBoundary" + Date.now();
      const body = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${path.split("/").pop()}"`,
        "Content-Type: application/octet-stream",
        "",
        content,
        `--${boundary}`,
        `Content-Disposition: form-data; name="path"`,
        "",
        path,
        `--${boundary}--`,
      ].join("\r\n");

      const response = await fetch(`${DJANGO_URL}/api/assets/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OWNER_TOKEN}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      expect(response.status).toBe(201);
    }

    // Refresh page
    await electron.getByTestId("nav-content").click();
    await electron.getByTestId("nav-assets").click();
    await electron.getByTestId("assets-page").waitFor({ state: "visible" });

    // Verify tree structure shows folders
    await electron.getByTestId("file-tree-item-docs").waitFor({ state: "visible", timeout: 10000 });
    await electron.getByTestId("file-tree-item-photos").waitFor({ state: "visible", timeout: 10000 });
  });

  test("API: list assets with prefix filter", async () => {
    const response = await fetch(`${DJANGO_URL}/api/assets/?prefix=/docs/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const assets = await response.json();
    expect(assets.length).toBe(2);
    for (const a of assets) {
      expect(a.path).toMatch(/^\/docs\//);
    }
  });

  test("API: get asset detail with download URL", async () => {
    const response = await fetch(`${DJANGO_URL}/api/assets/docs/readme.txt/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const asset = await response.json();
    expect(asset.path).toBe("/docs/readme.txt");
    expect(asset.download_url).toBeTruthy();
  });

  test("API: update visibility", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="visibility"',
      "",
      "public",
      `--${boundary}--`,
    ].join("\r\n");

    const response = await fetch(`${DJANGO_URL}/api/assets/docs/readme.txt/`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(response.status).toBe(200);
    const asset = await response.json();
    expect(asset.visibility).toBe("public");
  });

  test("API: replace asset file", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const newContent = "updated readme content v2";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="readme.txt"',
      "Content-Type: text/plain",
      "",
      newContent,
      `--${boundary}--`,
    ].join("\r\n");

    const response = await fetch(`${DJANGO_URL}/api/assets/docs/readme.txt/`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(response.status).toBe(200);
    const asset = await response.json();
    expect(asset.size).toBe(newContent.length);
  });

  test("API: upload duplicate path returns 409", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="readme.txt"',
      "Content-Type: text/plain",
      "",
      "duplicate",
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      "",
      "/docs/readme.txt",
      `--${boundary}--`,
    ].join("\r\n");

    const response = await fetch(`${DJANGO_URL}/api/assets/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(response.status).toBe(409);
  });

  test("API: upload with invalid path returns 400", async () => {
    const boundary = "----TestBoundary" + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      "Content-Type: text/plain",
      "",
      "content",
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      "",
      "no-leading-slash",
      `--${boundary}--`,
    ].join("\r\n");

    const response = await fetch(`${DJANGO_URL}/api/assets/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OWNER_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(response.status).toBe(400);
  });

  test("API: list public only", async () => {
    const response = await fetch(`${DJANGO_URL}/api/assets/?visibility=public`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const assets = await response.json();
    for (const a of assets) {
      expect(a.visibility).toBe("public");
    }
  });

  test("API: unauthenticated access is rejected", async () => {
    const response = await fetch(`${DJANGO_URL}/api/assets/`);
    expect([401, 403]).toContain(response.status);
  });

  test("API: delete asset", async () => {
    const response = await fetch(`${DJANGO_URL}/api/assets/docs/readme.txt/`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(response.status).toBe(204);

    // Verify it's gone
    const getResponse = await fetch(`${DJANGO_URL}/api/assets/docs/readme.txt/`, {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(getResponse.status).toBe(404);
  });

  test("cleanup: delete remaining test assets", async () => {
    for (const path of ["/docs/api/spec.json", "/photos/avatar.png"]) {
      await fetch(`${DJANGO_URL}/api/assets${path}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
      });
    }
  });
});
