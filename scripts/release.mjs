import { mkdir, readFile, rm } from "node:fs/promises";
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
await mkdir(releaseDir, { recursive: true });
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

function releaseNotesFor(version) {
  if (version === "2.0.0-hotfix") {
    return `Task Tracker 2.0.0-hotfix

Hotfix changes
- added scripts/build_readme to explain release build, local build, and packaging flows
- split local packaging into a dedicated Mac mini build script: scripts/build.local.mjs
- restored scripts/build.mjs as the clean GitHub/release build script
- fixed local Mac mini sync to keep complete plugin files, including README and i18n

2.0.0 baseline changes
- reworked startup sync recovery to avoid clearing task indexes before SiYuan sync finishes
- added automatic and manual rebuild of tasks.json from task documents in the task root
- persisted completedAt and sourceText into task document attributes for more reliable recovery`;
  }

  if (version === "2.0.0") {
    return `Task Tracker 2.0.0

- reworked startup sync recovery to avoid clearing task indexes before SiYuan sync finishes
- added automatic and manual rebuild of tasks.json from task documents in the task root
- persisted completedAt and sourceText into task document attributes for more reliable recovery`;
  }

  return `Task Tracker ${version}`;
}
