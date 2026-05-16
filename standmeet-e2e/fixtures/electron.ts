import { _electron, type ElectronApplication, type Page } from "@playwright/test";

const ELECTRON_APP_PATH = process.env.ELECTRON_APP_PATH!;
const DJANGO_URL = process.env.DJANGO_URL || "http://server:8000";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "smo_e2e_test_token_fixed";
const GATEWAY_URL = process.env.GATEWAY_URL || "ws://gateway:8001";

let electronApp: ElectronApplication;
let electronPage: Page;

/**
 * Launch Electron app and configure it to connect to the test server.
 * Call once in globalSetup or the first test's beforeAll.
 */
export async function launchElectron(): Promise<Page> {
  electronApp = await _electron.launch({
    args: [ELECTRON_APP_PATH],
  });

  electronPage = await electronApp.firstWindow();
  await electronPage.waitForLoadState("domcontentloaded");

  // Navigate to Setup page and configure server connection
  await electronPage.getByTestId("nav-setup").click();
  await electronPage.getByTestId("setup-url").fill(DJANGO_URL);
  await electronPage.getByTestId("setup-token").fill(OWNER_TOKEN);
  await electronPage.getByTestId("setup-test-btn").click();

  // After successful connection, the app navigates from Setup to Content page.
  // Wait for the status badge (in sidebar) to confirm connection succeeded.
  await electronPage.getByTestId("status-badge").waitFor({ state: "visible", timeout: 30000 });

  // Inject gateway URL into config (in Docker, gateway is a separate container)
  await electronPage.evaluate(async (gwUrl) => {
    const config = await (window as any).standmeet.config.load();
    config.server.gateway_url = gwUrl;
    await (window as any).standmeet.config.save(config);
  }, GATEWAY_URL);

  return electronPage;
}

export function getElectronPage(): Page {
  return electronPage;
}

export async function closeElectron(): Promise<void> {
  if (electronApp) {
    await electronApp.close();
  }
}
