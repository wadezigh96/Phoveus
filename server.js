import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const dir = dirname(fileURLToPath(import.meta.url));
const b64 = [0,1,2,3,4].map(i => readFileSync(join(dir, `server.b64.${i}`), "utf8")).join("");
const src = Buffer.from(b64, "base64").toString("utf8");
const out = join(tmpdir(), "phoveus-server-full.mjs");
writeFileSync(out, src);
const mod = await import(pathToFileURL(out).href);
export default mod.default;
if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 8787;
  mod.default.listen(PORT, () => console.log("listening", PORT));
}
