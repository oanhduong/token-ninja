#!/usr/bin/env node
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src", "rules", "builtin");
const dst = join(root, "dist", "rules", "builtin");

await mkdir(dst, { recursive: true });
const files = await readdir(src);
for (const f of files) {
  if (!f.endsWith(".yaml")) continue;
  await cp(join(src, f), join(dst, f));
}
console.log(`[copy-rules] copied ${files.filter((f) => f.endsWith(".yaml")).length} YAML files → dist/rules/builtin/`);
