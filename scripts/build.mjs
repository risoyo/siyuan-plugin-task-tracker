import { build } from "esbuild";
import { compile } from "sass";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

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
    await cp(join(root, file), join(dist, basename(file)));
  }
}

if (existsSync(join(root, "i18n"))) {
  await cp(join(root, "i18n"), join(dist, "i18n"), { recursive: true });
}

console.log("Built SiYuan plugin to dist/");
