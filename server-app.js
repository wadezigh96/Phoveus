import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const dir = dirname(fileURLToPath(import.meta.url));
const src =
  readFileSync(join(dir, "server-app.part1.txt"), "utf8") +
  readFileSync(join(dir, "server-app.part2.txt"), "utf8") +
  readFileSync(join(dir, "server-app.part3.txt"), "utf8");

const hash = createHash("sha256").update(src).digest("hex").slice(0, 16);
const out = join(tmpdir(), `phoveus-server-app-${hash}.mjs`);
try {
  writeFileSync(out, src, { flag: "wx" });
} catch {
  // cold-start reuse
}
const mod = await import(pathToFileURL(out).href);
export default mod.default;
