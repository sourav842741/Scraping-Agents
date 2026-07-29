import { homedir } from "os";
import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, "..", "output", "settings.json");

export function getDefaultDownloadDir() {
  return join(homedir(), "Desktop");
}

export function getSettings() {
  if (!existsSync(settingsPath)) {
    return { downloadDir: getDefaultDownloadDir() };
  }
  try {
    const data = JSON.parse(readFileSync(settingsPath, "utf8"));
    return {
      downloadDir: data.downloadDir?.trim() || getDefaultDownloadDir(),
    };
  } catch {
    return { downloadDir: getDefaultDownloadDir() };
  }
}

export function saveSettings({ downloadDir }) {
  const dir = downloadDir?.trim() || getDefaultDownloadDir();
  mkdirSync(dirname(settingsPath), { recursive: true });
  const payload = { downloadDir: dir, updatedAt: new Date().toISOString() };
  writeFileSync(settingsPath, JSON.stringify(payload, null, 2));
  return payload;
}
