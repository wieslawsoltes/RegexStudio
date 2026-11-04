import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RegexEngine } from "../src/engine/client.js";

class Clock {
  now = 0;
  next = 0;
  timers = new Map();
  set = (callback, delay) => {
    const id = ++this.next;
    this.timers.set(id, { callback, due: this.now + delay });
    return id;
  };
  clear = (id) => this.timers.delete(id);
  tick(delay) {
    const target = this.now + delay;
    while (true) {
      const next = [...this.timers]
        .filter(([, task]) => task.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].due;
      next[1].callback();
    }
    this.now = target;
  }
}

class WorkerStub {
  messages = [];
  terminated = false;
  postError = null;
  postMessage(message) {
    if (this.postError) throw this.postError;
    this.messages.push(structuredClone(message));
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage?.({ data });
  }
  ready() {
    this.emit({ type: "ready", version: "10.0.14" });
  }
  answer(index, result) {
    this.emit({ id: this.messages[index].id, result });
  }
}

function setup({ ready = true, ...options } = {}) {
  const clock = new Clock();
  const workers = [];
  const engine = new RegexEngine({
    workerFactory: () => {
      const worker = new WorkerStub();
      workers.push(worker);
      return worker;
    },
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...options,
  });
  engine.start();
  if (ready) workers[0].ready();
  return { engine, clock, workers, worker: workers[0] };
}

test("requests are FIFO and waiting time does not consume an execution deadline", async () => {
  const { engine, clock, worker } = setup();
  const first = engine.run({ pattern: "a", input: "a" });
  const second = engine.trace({ pattern: "b", input: "b" });
  assert.equal(worker.messages.length, 1);
  assert.equal(clock.timers.size, 1);
  clock.tick(14_000);
  worker.answer(0, { matches: ["a"] });
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1].method, "Trace");
  clock.tick(14_000);
  assert.equal(engine.ready, true);
  worker.answer(1, { events: ["b"] });
  assert.deepEqual(await Promise.all([first, second]), [
    { matches: ["a"] },
    { events: ["b"] },
  ]);
  assert.equal(clock.timers.size, 0);
  engine.dispose();
});

test("queued requests snapshot input and options before the caller edits them", async () => {
  const { engine, worker } = setup();
  const first = engine.run({ pattern: "wait" });
  const original = { pattern: "original", input: "old data", options: 0 };
  const second = engine.run(original);
  original.pattern = "changed";
  original.input = "new data";
  original.options = 64;
  worker.answer(0, {});
  assert.deepEqual(worker.messages[1].request, {
    pattern: "original",
    input: "old data",
    options: 0,
  });
  worker.answer(1, {});
  await Promise.all([first, second]);
  engine.dispose();
});

test("retry rejects all abandoned requests and clears their execution timers", async () => {
  const { engine, clock, workers, worker } = setup();
  const pending = Promise.allSettled([
    engine.run({ pattern: "a" }),
    engine.run({ pattern: "b" }),
  ]);
  engine.retry();
  assert.equal(worker.terminated, true);
  assert.equal(engine.pending.size, 0);
  assert.equal(workers.length, 2);
  workers[1].ready();
  clock.tick(100_000);
  assert.equal(engine.status, "ready");
  assert.equal(engine.version, "10.0.14");
  for (const result of await pending) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason.name, "AbortError");
  }
  engine.dispose();
});

test("old-worker messages, errors and timer callbacks cannot affect a restarted worker", () => {
  const { engine, clock, workers, worker } = setup({ ready: false });
  const lateMessage = worker.onmessage;
  const lateError = worker.onerror;
  const lateDeadline = [...clock.timers.values()][0].callback;
  engine.retry();
  workers[1].ready();
  lateMessage({ data: { type: "ready", version: "wrong-version" } });
  lateMessage({ data: { type: "failure", error: "old failure" } });
  lateError({ message: "old crash" });
  lateDeadline();
  assert.equal(engine.worker, workers[1]);
  assert.equal(engine.version, "10.0.14");
  assert.equal(engine.ready, true);
  assert.equal(engine.lastError, "");
  assert.equal(clock.timers.size, 0);
  engine.dispose();
});

test("cancel stops native work, rejects queued jobs, and restarts without an error status", async () => {
  const { engine, workers, worker } = setup();
  const states = [];
  engine.addEventListener("status", () => states.push(engine.status));
  const pending = Promise.allSettled([
    engine.run({ pattern: "a" }),
    engine.trace({ pattern: "b" }),
  ]);
  engine.cancel();
  assert.deepEqual(states, ["loading"]);
  assert.equal(worker.terminated, true);
  workers[1].ready();
  assert.deepEqual(states, ["loading", "ready"]);
  for (const result of await pending)
    assert.equal(result.reason.name, "AbortError");
  engine.dispose();
});

test("an execution deadline terminates the worker and rejects active and queued jobs", async () => {
  const { engine, clock, worker } = setup();
  const pending = Promise.allSettled([
    engine.run({ pattern: "a" }),
    engine.run({ pattern: "b" }),
  ]);
  clock.tick(15_000);
  assert.equal(engine.status, "error");
  assert.equal(worker.terminated, true);
  assert.equal(engine.pending.size, 0);
  assert.equal(clock.timers.size, 0);
  for (const result of await pending) {
    assert.equal(result.status, "rejected");
    assert.match(result.reason.message, /15 seconds/);
  }
});

test("startup errors and worker construction exceptions are observable status failures", async () => {
  const { engine, clock, worker } = setup({ ready: false });
  await assert.rejects(engine.run({}), /still loading/);
  clock.tick(90_000);
  assert.equal(engine.status, "error");
  assert.equal(worker.terminated, true);
  assert.equal(clock.timers.size, 0);
  const unavailable = new RegexEngine({
    workerFactory: () => {
      throw new Error("Workers are blocked.");
    },
  });
  assert.doesNotThrow(() => unavailable.start());
  assert.equal(unavailable.status, "error");
  assert.match(unavailable.lastError, /Workers are blocked/);
});

test("uncloneable inputs reject one request without poisoning the ready worker", async () => {
  const { engine, clock, worker } = setup();
  await assert.rejects(engine.run({ pattern() {} }), {
    name: "DataCloneError",
  });
  assert.equal(engine.ready, true);
  assert.equal(engine.pending.size, 0);
  assert.equal(clock.timers.size, 0);
  const valid = engine.run({ pattern: "a" });
  worker.answer(0, { matches: [] });
  assert.deepEqual(await valid, { matches: [] });
  engine.dispose();
});

test("postMessage failures and worker decode failures reject their requests", async () => {
  const { engine, clock, worker } = setup();
  worker.postError = new Error("Worker transport closed.");
  await assert.rejects(engine.run({}), /transport closed/);
  assert.equal(engine.status, "error");
  assert.equal(engine.pending.size, 0);
  assert.equal(clock.timers.size, 0);

  const next = setup();
  const rejected = assert.rejects(next.engine.run({}), /could not be decoded/);
  next.worker.onmessageerror({});
  await rejected;
  assert.equal(next.worker.terminated, true);
  assert.equal(next.clock.timers.size, 0);
});

test("only the active job can complete and .NET domain errors remain result data", async () => {
  const { engine, worker } = setup();
  const first = engine.run({ pattern: "(" });
  const second = engine.run({ pattern: "b" });
  worker.emit({ id: 2, result: { unexpected: true } });
  assert.equal(engine.pending.size, 2);
  const result = {
    error: {
      code: "InsufficientClosingParentheses",
      message: "Invalid pattern.",
      offset: 1,
    },
  };
  worker.answer(0, result);
  assert.deepEqual(await first, result);
  worker.answer(1, { matches: ["b"] });
  assert.deepEqual(await second, { matches: ["b"] });
  assert.equal(engine.ready, true);
  engine.dispose();
});

test("worker bootstrap preserves .NET sidecar detection until runtime creation completes", async () => {
  // Execute the actual worker bootstrap against a loader enforcing .NET 10's
  // worker heuristic: an early global onmessage means "pthread", not "sidecar".
  // Mocking only the import keeps initialization and handler ordering intact.
  const source = await readFile(
    new URL("../src/engine/worker.js", import.meta.url),
    "utf8",
  );
  const rewritten = source.replace(
    /import\(\s*new URL\(["']\.\.\/\.\.\/_framework\/dotnet\.js["'],\s*import\.meta\.url\)\.href\s*\)/,
    "loadRuntime()",
  );
  assert.notEqual(
    source,
    rewritten,
    "Update the runtime import adapter if the worker import path changes.",
  );
  const messages = [];
  const self = {
    postMessage: (message) => messages.push(structuredClone(message)),
  };
  const candidate = {
    Run: (request) =>
      JSON.stringify({
        version: "10.0.14",
        matches: [],
        pattern: JSON.parse(request).pattern,
      }),
    Trace: () => JSON.stringify({ events: [] }),
  };
  const dotnet = {
    withDiagnosticTracing() {
      return this;
    },
    async create() {
      assert.equal(
        self.onmessage,
        undefined,
        "Do not register the application handler before .NET sidecar initialization.",
      );
      return {
        getConfig: () => ({ mainAssemblyName: "RegexStudio.Engine" }),
        getAssemblyExports: async () => ({
          RegexStudio: { Engine: candidate },
        }),
      };
    },
  };
  const loadRuntime = async () => {
    assert.equal(
      self.onmessage,
      undefined,
      "The .NET loader must see an unassigned global onmessage.",
    );
    return { dotnet };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("self", "loadRuntime", rewritten)(self, loadRuntime);
  assert.deepEqual(
    messages.filter((x) => x.type === "progress").map((x) => x.stage),
    ["runtime-import", "runtime-start", "exports", "self-check"],
  );
  assert.deepEqual(messages.at(-1), { type: "ready", version: "10.0.14" });
  assert.equal(typeof self.onmessage, "function");
  self.onmessage({
    data: { id: 17, method: "Run", request: { pattern: "abc" } },
  });
  assert.deepEqual(messages.at(-1), {
    id: 17,
    result: { version: "10.0.14", matches: [], pattern: "abc" },
  });
});

test("startup progress updates detail without pretending the engine is ready", () => {
  const { engine, worker } = setup({ ready: false });
  worker.emit({
    type: "progress",
    stage: "exports",
    detail: "Loading regex engine exports…",
  });
  assert.equal(engine.status, "loading");
  assert.equal(engine.ready, false);
  assert.equal(engine.loadingDetail, "Loading regex engine exports…");
  worker.ready();
  assert.equal(engine.loadingDetail, "");
  worker.emit({ type: "progress", detail: "A late progress message" });
  assert.equal(engine.status, "ready");
  assert.equal(engine.loadingDetail, "");
  engine.dispose();
});
