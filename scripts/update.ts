#!/usr/bin/env -S deno run --no-lock --no-config -A
// deno-lint-ignore-file no-import-prefix
import { $ } from "jsr:@david/dax@0.43.1";

// get the app version
const version = await import("../deno.json", { with: { type: "json" } })
  .then((meta) => meta.default.version);

$.setPrintCommand(true);
await $`git add . && git commit -m ${version} && git tag -a ${version} -m ${version}`;
prompt("Press enter to push");
await $`git push --follow-tags`;
