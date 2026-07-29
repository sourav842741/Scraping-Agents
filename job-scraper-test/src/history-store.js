import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const historyDir = join(__dirname, "..", "output", "history");

export function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function saveExtractionRun(record) {
  mkdirSync(historyDir, { recursive: true });
  const id = record.id || makeRunId();
  const filePath = join(historyDir, `${id}.json`);
  const payload = { ...record, id, savedAt: new Date().toISOString() };
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return { id, filePath };
}

export function listExtractionHistory() {
  if (!existsSync(historyDir)) return [];
  return readdirSync(historyDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(historyDir, f), "utf8"));
        return {
          id: data.id || f.replace(".json", ""),
          filename: f,
          startedAt: data.startedAt,
          finishedAt: data.finishedAt,
          sites: data.sites ?? [],
          quantity: data.quantity,
          filters: data.filters ?? {},
          totalCollected: data.totalCollected ?? data.jobs?.length ?? 0,
          status: data.status ?? "unknown",
          outcome: data.summary?.outcome ?? data.status ?? "unknown",
          summaryTitle: data.summary?.title ?? null,
        };
      } catch {
        return { id: f.replace(".json", ""), filename: f, status: "corrupt" };
      }
    })
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export function getExtractionRun(id) {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
  const path = join(historyDir, `${safe}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}
