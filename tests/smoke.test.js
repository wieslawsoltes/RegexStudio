import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("application uses relative module entry points for GitHub Pages", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /src="\.\/src\/app\.js"/);
});
