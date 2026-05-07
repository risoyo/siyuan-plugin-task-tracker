import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dist = join(root, "dist");
const releaseDir = join(root, "release");
const pluginJsonPath = join(root, "plugin.json");

const plugin = JSON.parse(await readFile(pluginJsonPath, "utf8"));
const version = plugin.version;
const zipName = `siyuan-plugin-task-tracker-v${version}.zip`;
const zipPath = join(releaseDir, zipName);

await run("node", [join(root, "scripts", "build.mjs")], root);
await rm(zipPath, { force: true });
await run("zip", ["-r", zipPath, "."], dist);

console.log(`Created ${zipName}`);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
