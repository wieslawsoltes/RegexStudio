import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Pages replaces a deployment atomically. Retain a few immutable asset releases
// so a cached index.html can still fetch the runtime/modules it originally used.
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, ".release-cache");
const limit = 4;
const digestPattern = /^[a-f0-9]{20}$/;
const restored = [];
let temporary;

function warn(message) {
  console.warn(`::warning::Release asset cache: ${message}`);
}

function command(program, args) {
  return spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function failure(result) {
  // Never forward raw gh stderr: debug output may contain authentication data.
  if (result.error?.code === "ENOENT") return "required command is unavailable";
  if (result.error?.code === "ETIMEDOUT") return "command timed out";
  const message = result.stderr || "";
  if (/expired|not found|no artifacts|could not find|HTTP 410/i.test(message))
    return "artifact is missing or expired";
  if (/HTTP 403|forbidden|resource not accessible/i.test(message))
    return "GitHub denied access; check Actions read permission";
  if (/HTTP 401|bad credentials|not logged|authenticate/i.test(message))
    return "GitHub authentication is unavailable";
  if (result.error) return "command could not complete";
  return `command exited with status ${result.status ?? "unknown"}`;
}

function validRepository(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return (
    parts.length === 2 &&
    /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(parts[0]) &&
    /^[a-z0-9_.-]{1,100}$/i.test(parts[1]) &&
    ![".", ".."].includes(parts[1])
  );
}

function jsonFile(filename) {
  if (!existsSync(filename)) return null;
  const info = lstatSync(filename);
  if (!info.isFile() || info.size > 1024 * 1024) return null;
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    return null;
  }
}

function releaseDigests(directory) {
  const history = jsonFile(path.join(directory, "release-history.json"));
  const ordered = Array.isArray(history)
    ? history.filter(
        (value) => typeof value === "string" && digestPattern.test(value),
      )
    : [];
  if (ordered.length) return [...new Set(ordered)].slice(0, 64);
  const build = jsonFile(path.join(directory, "build-info.json"));
  return typeof build?.digest === "string" && digestPattern.test(build.digest)
    ? [build.digest]
    : [];
}

function safeArchive(archive) {
  const listing = command("tar", ["-tf", archive]);
  if (!succeeded(listing)) return false;
  for (const entry of listing.stdout.split("\n").filter(Boolean)) {
    if (
      entry.startsWith("/") ||
      /^[a-z]:/i.test(entry) ||
      entry.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(entry) ||
      entry.split("/").includes("..")
    )
      return false;
  }
  // A Pages artifact contains ordinary files/directories. Reject symlinks,
  // hardlinks and special files before extraction into the temporary directory.
  const details = command("tar", ["-tvf", archive]);
  return (
    succeeded(details) &&
    details.stdout
      .split("\n")
      .filter(Boolean)
      .every((line) => /^[d-]/.test(line))
  );
}

function copyRelease(source, digest) {
  if (!existsSync(source) || !lstatSync(source).isDirectory()) return false;
  const destination = path.join(cache, digest);
  const staging = path.join(cache, `.restore-${digest}-${process.pid}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    cpSync(source, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    rmSync(destination, { recursive: true, force: true });
    renameSync(staging, destination);
    return true;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function restore() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!validRepository(repository)) {
    warn("GITHUB_REPOSITORY is absent or invalid; skipping prior releases.");
    return;
  }
  const endpoint = `repos/${repository}/actions/workflows/pages.yml/runs?branch=main&status=success&per_page=${limit}`;
  const response = command("gh", ["api", endpoint]);
  if (!succeeded(response)) {
    warn(
      `Could not list previous Pages runs (${failure(response)}). Continuing with the new release only.`,
    );
    return;
  }
  let runs;
  try {
    const payload = JSON.parse(response.stdout);
    runs = Array.isArray(payload.workflow_runs)
      ? payload.workflow_runs.slice(0, limit)
      : [];
  } catch {
    warn(
      "GitHub returned an unreadable workflow list; skipping prior releases.",
    );
    return;
  }
  if (!runs.length) {
    console.log(
      "Release asset cache: no previous successful Pages runs (first deployment).",
    );
    return;
  }
  temporary = mkdtempSync(path.join(tmpdir(), "regexstudio-releases-"));
  for (const run of runs) {
    if (restored.length >= limit) break;
    const id = String(run.id ?? "");
    if (!/^[1-9]\d{0,19}$/.test(id)) {
      warn("Ignoring a previous run with an invalid identifier.");
      continue;
    }
    const download = path.join(temporary, id);
    mkdirSync(download, { recursive: true });
    const result = command("gh", [
      "run",
      "download",
      id,
      "--repo",
      repository,
      "--name",
      "github-pages",
      "--dir",
      download,
    ]);
    if (!succeeded(result)) {
      warn(`Run ${id}: ${failure(result)}; trying another successful run.`);
      continue;
    }
    const archive = path.join(download, "artifact.tar");
    try {
      if (
        !existsSync(archive) ||
        !lstatSync(archive).isFile() ||
        !safeArchive(archive)
      ) {
        warn(
          `Run ${id}: Pages artifact is missing or has an unsupported archive structure.`,
        );
        continue;
      }
      const extracted = path.join(download, "extracted");
      mkdirSync(extracted, { recursive: true });
      const extraction = command("tar", [
        "-xf",
        archive,
        "-C",
        extracted,
        "--no-same-owner",
        "--no-same-permissions",
      ]);
      if (!succeeded(extraction)) {
        warn(`Run ${id}: archive extraction failed (${failure(extraction)}).`);
        continue;
      }
      const digests = releaseDigests(extracted);
      if (!digests.length) {
        warn(
          `Run ${id}: no compatible release history or build digest was found.`,
        );
        continue;
      }
      for (const digest of digests) {
        if (restored.length >= limit) break;
        if (restored.includes(digest)) continue;
        const source = path.join(extracted, "assets", digest);
        if (copyRelease(source, digest)) restored.push(digest);
        else
          warn(`Run ${id}: asset directory ${digest} is absent; skipping it.`);
      }
    } catch (error) {
      warn(
        `Run ${id}: prior assets could not be restored (${error.code || "invalid artifact"}). Continuing.`,
      );
    }
  }
}

try {
  mkdirSync(cache, { recursive: true });
  restore();
} catch (error) {
  warn(
    `Prior release restoration was unavailable (${error.code || "unexpected error"}); the new deployment can continue.`,
  );
} finally {
  if (temporary) {
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch {
      warn("Could not remove the temporary artifact directory.");
    }
  }
  try {
    mkdirSync(cache, { recursive: true });
    const history = path.join(cache, `.history-${process.pid}.json`);
    writeFileSync(history, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
    renameSync(history, path.join(cache, "history.json"));
  } catch {
    warn(
      "Could not write the optional release cache history; continuing without cached releases.",
    );
  }
  console.log(
    `Release asset cache: restored ${restored.length} prior release${restored.length === 1 ? "" : "s"}${restored.length ? ` (${restored.join(", ")})` : ""}.`,
  );
}
