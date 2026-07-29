import { join } from "path";
import { statSync } from "fs";
import { PLATFORM_META } from "./platforms.js";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function captureScrollSnapshots({
  page,
  platformId,
  panelCount,
  jobDir,
  control,
  onLog,
  onProgress,
  state,
}) {
  const label = PLATFORM_META[platformId]?.label ?? platformId;
  const saved = [];

  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(600);

  const panels = Math.min(10, Math.max(1, panelCount));

  for (let i = 0; i < panels; i++) {
    control.check();

    const filename = `snapshot-${platformId}-${String(i + 1).padStart(2, "0")}.png`;
    const destPath = join(jobDir, filename);

    await page.screenshot({ path: destPath, fullPage: false, type: "png" });
    const size = statSync(destPath).size;

    saved.push(filename);
    state.success += 1;

    onLog(
      "success",
      `Snapshot ${filename}`,
      `${label} · panel ${i + 1}/${panels} · ${(size / 1024).toFixed(1)} KB`
    );
    onProgress({
      success_count: state.success,
      failed_count: state.failed,
      found_count: state.success,
      file: {
        filename,
        sourceUrl: page.url(),
        fileSize: size,
        status: "success",
        sourcePlatform: platformId,
        fileKind: "snapshot",
      },
    });

    if (i < panels - 1) {
      const beforeY = await page.evaluate(() => window.scrollY);
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.88)));
      await delay(900);
      const after = await page.evaluate(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        return {
          y: window.scrollY,
          atEnd: window.scrollY >= max - 4,
        };
      });
      if (after.y <= beforeY + 2 && after.atEnd) {
        onLog("info", `${label} scroll end`, `Stopped at panel ${i + 1} — no more page to capture`);
        break;
      }
    }
  }

  return saved;
}
