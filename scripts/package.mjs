import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, ".release-dist");
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
const required = [manifest.background.service_worker, "panel.html", "panel.js", "panel.css", ...manifest.content_scripts.flatMap((entry) => entry.js)];
if (manifest.version !== packageJson.version) throw new Error("Package and manifest versions differ");
for (const name of required) {
  if (!fs.existsSync(path.join(dist, name))) throw new Error(`Release build is missing ${name}`);
}
if (fs.readdirSync(dist).some((name) => name.endsWith(".map"))) throw new Error("Release must not include source maps");
const release = path.join(root, "release");
fs.mkdirSync(release, { recursive: true });
const output = fs.createWriteStream(path.join(release, `gbf-battle-v${packageJson.version}.zip`));
const archive = archiver("zip", { zlib: { level: 9 } });
const finished = new Promise((resolve, reject) => {
  output.on("close", resolve);
  output.on("error", reject);
  archive.on("error", reject);
  archive.on("warning", reject);
});
archive.pipe(output);
archive.directory(dist, false);
await archive.finalize();
await finished;
console.log(`Created release/gbf-battle-v${packageJson.version}.zip`);
