import { build } from "esbuild";
import { compile } from "sass";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const localPluginDir = resolveLocalPluginDir();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/index.ts")],
  bundle: true,
  outfile: join(dist, "index.js"),
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["siyuan"],
  legalComments: "none",
  loader: {
    ".scss": "empty"
  }
});

const css = compile(join(root, "src/index.scss"), {
  style: "compressed"
}).css;
await writeFile(join(dist, "index.css"), css, "utf8");

for (const file of await readdir(root)) {
  if (file === "plugin.json") {
    await cp(join(root, file), join(dist, basename(file)));
  }
}

if (existsSync(join(root, "i18n"))) {
  await cp(join(root, "i18n"), join(dist, "i18n"), { recursive: true });
}

await syncToLocalPluginDir();

console.log("Built SiYuan plugin to dist/");
console.log(`Synced dist/ to ${localPluginDir}`);

async function syncToLocalPluginDir() {
  await mkdir(localPluginDir, { recursive: true });
  const entries = await readdir(dist, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "README.md" || entry.name === "README_zh_CN.md" || entry.name === "i18n") {
      continue;
    }
    await copyEntry(join(dist, entry.name), join(localPluginDir, entry.name), entry.isDirectory());
  }
}

async function copyEntry(source, target, directory) {
  if (directory) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntry(join(source, entry.name), join(target, entry.name), entry.isDirectory());
    }
    return;
  }

  await copyFile(source, target);
}

function resolveLocalPluginDir() {
  const candidates = [
    "/Users/risoyo/LocalHDD/SiYuan/data/plugins/siyuan-plugin-task-tracker",
    "/Users/risoyo/SiYuan/data/plugins/siyuan-plugin-task-tracker"
  ];

  for (const candidate of candidates) {
    const parent = candidate.replace(/\/siyuan-plugin-task-tracker$/u, "");
    if (existsSync(parent)) {
      return candidate;
    }
  }

  return candidates[0];
}
