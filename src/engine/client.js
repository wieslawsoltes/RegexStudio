const errorFrom = (value, fallback) => value instanceof Error
  ? value : new Error(typeof value === 'string' && value ? value : fallback);

/**
 * Owns one isolated .NET worker. Requests are dispatched in FIFO order so a
 * queued request's execution deadline never includes time spent waiting for a
 * previous request. Cancelling terminates the worker, which also stops native
 * regex execution that cannot observe JavaScript messages while it is running.
 */
export class RegexEngine extends EventTarget {
  constructor({
    workerFactory = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    startupTimeoutMs = 90_000,
    executionTimeoutMs = 15_000,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
  } = {}) {
    super();
    this.workerFactory = workerFactory;
    this.startupTimeoutMs = startupTimeoutMs;
    this.executionTimeoutMs = executionTimeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.worker = null;
    this.ready = false;
    this.serial = 0;
    this.generation = 0;
    this.pending = new Map();
    this.active = null;
    this.startTimer = null;
    this.status = 'loading';
    this.version = '';
    this.lastError = '';
  }

  start() {
    if (this.worker) return;
    this.ready = false;
    this.status = 'loading';
    this.version = '';
    this.lastError = '';
    const generation = ++this.generation;
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      const current = () => this.worker === worker && this.generation === generation;
      worker.onmessage = event => {
        if (current()) this.receive(event.data);
      };
      worker.onerror = event => {
        if (!current()) return;
        event.preventDefault?.();
        this.fail(new Error(event.message || 'The .NET worker could not start or continue.'));
      };
      worker.onmessageerror = () => {
        if (current()) this.fail(new Error('A response from the .NET worker could not be decoded. Retry the engine.'));
      };
      this.startTimer = this.setTimer(() => {
        if (current()) this.fail(new Error('The .NET engine took too long to load. Check your connection and retry.'));
      }, this.startupTimeoutMs);
      this.dispatchEvent(new Event('status'));
    } catch (error) {
      this.fail(errorFrom(error, 'The browser could not create a .NET worker.'));
    }
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      if (this.ready) return;
      if (typeof message.version !== 'string' || !message.version) {
        this.fail(new Error('The .NET worker did not identify its runtime version. Retry the engine.'));
        return;
      }
      this.clearTimer(this.startTimer);
      this.startTimer = null;
      this.ready = true;
      this.status = 'ready';
      this.version = message.version;
      this.dispatchEvent(new Event('status'));
      return;
    }
    if (message.type === 'failure') {
      this.fail(errorFrom(message.error, 'The .NET worker failed.'));
      return;
    }
    const job = this.pending.get(message.id);
    if (!job || this.active !== message.id) return;
    this.finish(job, Object.hasOwn(message, 'error')
      ? errorFrom(message.error, 'The .NET request failed.') : null, message.result);
    this.dispatchNext();
  }

  /** Release every timer and reject every active or queued request exactly once. */
  stopWorker(error) {
    ++this.generation;
    this.clearTimer(this.startTimer);
    this.startTimer = null;
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    this.active = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const job of this.pending.values()) {
      this.clearTimer(job.timer);
      job.reject(error);
    }
    this.pending.clear();
  }

  fail(error) {
    error = errorFrom(error, 'The .NET worker failed.');
    this.stopWorker(error);
    this.status = 'error';
    this.lastError = error.message;
    this.dispatchEvent(new Event('status'));
  }

  request(method, request) {
    if (!this.ready) {
      return Promise.reject(new Error(this.status === 'error'
        ? this.lastError || 'The .NET engine is unavailable. Retry the engine.'
        : 'The .NET 10 engine is still loading.'));
    }
    if (method !== 'Run' && method !== 'Trace') {
      return Promise.reject(new Error(`Unknown regex operation: ${method}`));
    }
    let snapshot;
    try {
      // Snapshot when requested, not when the queue eventually dispatches it.
      // Editing a project while another pattern runs cannot mutate this job.
      snapshot = structuredClone(request);
    } catch (error) {
      return Promise.reject(errorFrom(error, 'The regex request could not be copied to the worker.'));
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { id, method, request: snapshot, resolve, reject, timer: null });
      this.dispatchNext();
    });
  }

  dispatchNext() {
    if (!this.ready || !this.worker || this.active !== null) return;
    const job = this.pending.values().next().value;
    if (!job) return;
    const worker = this.worker;
    const generation = this.generation;
    this.active = job.id;
    job.timer = this.setTimer(() => {
      if (this.worker !== worker || this.generation !== generation || this.active !== job.id) return;
      const seconds = this.executionTimeoutMs / 1000;
      this.fail(new Error(`Execution stopped after ${seconds} seconds to keep the workspace responsive. Reduce the input or simplify the expression, then retry the engine.`));
    }, this.executionTimeoutMs);
    try {
      worker.postMessage({ id: job.id, method: job.method, request: job.request });
    } catch (error) {
      if (error?.name === 'DataCloneError') {
        this.finish(job, error);
        this.dispatchNext();
      } else {
        this.fail(errorFrom(error, 'The request could not be sent to the .NET worker.'));
      }
    }
  }

  finish(job, error, result) {
    this.clearTimer(job.timer);
    this.pending.delete(job.id);
    if (this.active === job.id) this.active = null;
    if (error) job.reject(error);
    else job.resolve(result);
  }

  run(request) { return this.request('Run', request); }
  trace(request) { return this.request('Trace', request); }

  cancel() {
    this.stopWorker(new DOMException('Execution cancelled.', 'AbortError'));
    this.start();
  }

  retry() {
    this.stopWorker(new DOMException('The .NET engine was restarted.', 'AbortError'));
    this.start();
  }

  dispose() {
    this.stopWorker(new DOMException('The .NET engine was closed.', 'AbortError'));
    this.status = 'idle';
    this.dispatchEvent(new Event('status'));
  }
}
