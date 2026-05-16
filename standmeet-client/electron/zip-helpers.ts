import AdmZip from "adm-zip";
import type { ExportManifest } from "../src/types.js";

export function readZipManifest(zipPath: string): { manifest: ExportManifest; hasAssets: boolean } {
  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry("standmeet-export/manifest.json");
  if (!manifestEntry) throw new Error("Invalid export file: missing manifest.json");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as ExportManifest;
  const hasAssets = zip.getEntries().some(
    (e) => e.entryName.startsWith("standmeet-export/assets/") && !e.isDirectory,
  );
  return { manifest, hasAssets };
}

export function readZipFull(zipPath: string): { manifest: ExportManifest; assetBuffers: Map<string, Buffer> } {
  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry("standmeet-export/manifest.json");
  if (!manifestEntry) throw new Error("Invalid export file: missing manifest.json");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as ExportManifest;

  const assetBuffers = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("standmeet-export/assets/") && !entry.isDirectory) {
      const assetPath = "/" + entry.entryName.replace("standmeet-export/assets/", "");
      assetBuffers.set(assetPath, entry.getData());
    }
  }

  return { manifest, assetBuffers };
}
