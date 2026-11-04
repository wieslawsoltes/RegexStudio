// The entire .NET runtime lives in this worker. The UI can terminate it even
// while native regex code is running synchronously, then create a clean runtime.
let engine;

const handleRequest = ({ data }) => {
  const { id, method, request } = data || {};
  try {
    if (!engine) throw new Error("The .NET engine is unavailable.");
    if (method !== "Run" && method !== "Trace")
      throw new Error("Unknown regex engine operation.");
    const result = JSON.parse(engine[method](JSON.stringify(request)));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};

try {
  self.postMessage({
    type: "progress",
    stage: "runtime-import",
    detail: "Downloading .NET runtime…",
  });
  const { dotnet } = await import(
    new URL("../../_framework/dotnet.js", import.meta.url).href
  );
  self.postMessage({
    type: "progress",
    stage: "runtime-start",
    detail: "Starting .NET WebAssembly…",
  });
  const runtime = await dotnet.withDiagnosticTracing(false).create();
  self.postMessage({
    type: "progress",
    stage: "exports",
    detail: "Loading regex engine exports…",
  });
  const exports = await runtime.getAssemblyExports(
    runtime.getConfig().mainAssemblyName,
  );
  const candidate = exports.RegexStudio?.Engine;
  if (
    typeof candidate?.Run !== "function" ||
    typeof candidate?.Trace !== "function"
  ) {
    throw new Error("The compiled .NET regex exports were not found.");
  }

  // Exercise the actual JSExport/JSON boundary before announcing readiness.
  // This also obtains the real runtime patch version without a guessed fallback.
  self.postMessage({
    type: "progress",
    stage: "self-check",
    detail: "Checking .NET regex engine…",
  });
  const probe = JSON.parse(
    candidate.Run(
      JSON.stringify({
        pattern: "(?!)",
        input: "",
        timeoutMs: 250,
        maxMatches: 1,
      }),
    ),
  );
  if (probe.error)
    throw new Error(
      probe.error.message || "The .NET engine self-check failed.",
    );
  if (typeof probe.version !== "string" || !probe.version.startsWith("10.")) {
    throw new Error("The loaded engine did not report a .NET 10 runtime.");
  }
  engine = candidate;
  // .NET detects a sidecar worker by the absence of globalThis.onmessage during
  // import. Setting it earlier misclassifies this worker as a .NET pthread and
  // leaves startup waiting forever. The client only sends work after `ready`.
  self.onmessage = handleRequest;
  self.postMessage({ type: "ready", version: probe.version });
} catch (error) {
  engine = null;
  self.postMessage({
    type: "failure",
    error: `Could not load .NET 10 WebAssembly. ${error?.message || String(error)}`,
  });
}
