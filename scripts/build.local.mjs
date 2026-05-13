import { build } from "esbuild";
import { compile } from "sass";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
  if (file === "plugin.json" || /^README.*\.md$/.test(file)) {
    await copyFile(join(root, file), join(dist, basename(file)));
  }
}

if (existsSync(join(root, "i18n"))) {
  await copyTree(join(root, "i18n"), join(dist, "i18n"));
}

if (existsSync(join(root, "docs"))) {
  await copyTree(join(root, "docs"), join(dist, "docs"));
}

await syncToLocalPluginDir();

console.log("Built SiYuan plugin to dist/");
console.log(`Synced dist/ to ${localPluginDir}`);

async function syncToLocalPluginDir() {
  await mkdir(localPluginDir, { recursive: true });
  await copyTree(dist, localPluginDir, { skipReadme: false });
}

async function copyTree(sourceDir, targetDir, options = { skipReadme: true }) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (options.skipReadme && (entry.name === "README.md" || entry.name === "README_zh_CN.md")) {
      continue;
    }

    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target, options);
    } else {
      await copyFile(source, target);
    }
  }
}

function resolveLocalPluginDir() {
  const configured = process.env.SIYUAN_PLUGIN_DIR?.trim();
  if (configured) {
    return configured;
  }

  const candidates = [
    "/Users/risoyo/LocalHDD/SiYuan/data/plugins/siyuan-plugin-task-tracker",
    "/Users/risoyo/SiYuan/data/plugins/siyuan-plugin-task-tracker"
  ];

  return candidates.find((candidate) => existsSync(candidate.replace(/\/siyuan-plugin-task-tracker$/u, ""))) || candidates[0];
}
