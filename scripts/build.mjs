import { rm, mkdir, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const webOnly = process.argv.includes("--web-only");
if (!webOnly) {
  const sdk = process.env.DOTNET || "dotnet";
  const args = [
    "publish",
    "engine/RegexStudio.Engine/RegexStudio.Engine.csproj",
    "-c",
    "Release",
  ];
  if (process.env.REGEXSTUDIO_INPROCESS_BUILD === "1")
    args.push("-p:RegexStudioBuildInProcess=true", "-m:1", "-nr:false");
  const result = spawnSync(sdk, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
// All ESM imports and .NET boot resources live inside one content-addressed
// release. Query strings on app.js alone would not version its imported modules
// or the worker, and an old .NET assembly can fail a new boot manifest's hash.
const framework =
  "engine/RegexStudio.Engine/bin/Release/net10.0/browser-wasm/AppBundle/_framework";
async function hashDirectory(hash, directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await hashDirectory(hash, filename, relative);
    else if (entry.isFile()) {
      hash.update(relative).update("\0");
      hash.update(await readFile(filename)).update("\0");
    }
  }
}
try {
  await readFile(path.join(framework, "dotnet.js"));
} catch {
  throw new Error(
    "Published .NET WebAssembly framework not found. Run npm run build before build:web.",
  );
}
const hash = createHash("sha256");
await hashDirectory(hash, "src", "src");
await hashDirectory(hash, framework, "_framework");
const digest = hash.digest("hex").slice(0, 20);
const assetsPath = `assets/${digest}`;
await rm("dist", { recursive: true, force: true });
await mkdir(path.join("dist", assetsPath), { recursive: true });
await cp("src", path.join("dist", assetsPath, "src"), { recursive: true });
await cp(framework, path.join("dist", assetsPath, "_framework"), {
  recursive: true,
});
await cp("public", "dist/public", { recursive: true });
const html = (await readFile("index.html", "utf8"))
  .replace('href="./src/styles.css"', `href="./${assetsPath}/src/styles.css"`)
  .replace('src="./src/app.js"', `src="./${assetsPath}/src/app.js"`);
await writeFile("dist/index.html", html);
await writeFile("dist/.nojekyll", "");
const revision =
  process.env.GITHUB_SHA ||
  spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout?.trim() ||
  "local";
await writeFile(
  "dist/build-info.json",
  JSON.stringify(
    { revision, digest, assetsPath, runtime: ".NET 10" },
    null,
    2,
  ) + "\n",
);
// Compatibility for an index cached during the first migration to hashed assets.
// New loads only request the versioned tree above.
await cp("src", "dist/src", { recursive: true });
await cp(framework, "dist/_framework", { recursive: true });
console.log(`Built dist/ with .NET 10 WebAssembly at ${assetsPath}`);
