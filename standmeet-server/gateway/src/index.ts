import { startServer } from "./server.js";
import { config } from "./config.js";

if (!config.ownerToken) {
  console.error("OWNER_TOKEN environment variable is required");
  process.exit(1);
}

const { httpServer } = startServer();

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  httpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  httpServer.close();
  process.exit(0);
});
