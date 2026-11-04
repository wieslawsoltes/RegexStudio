// Execute the published, trimmed WebAssembly package through its real JSExport
// boundary. This catches missing linker roots and JS marshalling problems that
// desktop-only tests cannot detect. It does not substitute for browser UI QA.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundle = resolve(process.argv[2] ?? 'engine/RegexStudio.Engine/bin/Release/net10.0/browser-wasm/AppBundle');
const { engine } = await import(pathToFileURL(resolve(bundle, 'bootstrap.js')).href);
const run = request => JSON.parse(engine.Run(JSON.stringify({ timeoutMs: 2000, ...request })));
const trace = request => JSON.parse(engine.Trace(JSON.stringify({ timeoutMs: 2000, ...request })));

const repeated = run({ pattern: '(?<digit>\\d)+', input: 'Order 123' });
assert.equal(repeated.version, '10.0.14');
assert.equal(repeated.matches[0].index, 6);
assert.deepEqual(repeated.matches[0].groups.find(x => x.name === 'digit').captures.map(x => x.value), ['1', '2', '3']);
assert.equal(run({ pattern: '[a-z-[aeiou]]+', input: 'hello' }).matches[0].value, 'h');
assert.equal(run({ pattern: '\\d+', input: '١٢٣' }).matches[0].value, '١٢٣');
assert.equal(run({ pattern: '(?<x>a)+', input: 'aaa', options: 1024 }).matches[0].groups[1].captures.length, 1);
assert.equal(run({ pattern: 'a+', input: 'aaa', options: 8 }).algorithm, 'interpreter');
assert.equal(run({ pattern: '(?<word>\\w+)', input: 'one two', operation: 'replace', replacement: '${word}:$$' }).replacement, 'one:$ two:$');
assert.deepEqual(run({ pattern: '(,)', input: 'a,b,c', operation: 'split' }).splits, ['a', ',', 'b', ',', 'c']);
assert.equal(run({ pattern: '(', input: '' }).error.offset, 1);

for (const request of [
  { pattern: '(?<n>\\d)+', input: 'Order 123' },
  { pattern: '(?<open>\\()+(?<-open>\\))+(?(open)(?!))', input: '(()) () ((())' },
  { pattern: '(?<x>\\w)+', input: 'one two', options: 64 },
  { pattern: '(?i)(?<x>i)\\k<x>', input: 'iİ iI II ıI', culture: 'tr-TR' },
  { pattern: '(?<=foo)bar|baz(?=qux)', input: 'foobar bazqux' },
  { pattern: '(a|ab)+?b', input: 'aaabab' },
  { pattern: '[a-z-[aeiou]]+', input: 'the quick brown fox' },
]) {
  const result = trace(request);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.resultsVerified, true, request.pattern);
  assert.ok(result.events.length > 0);
  assert.ok(result.instructions.length > 0);
}

assert.equal(trace({ pattern: 'a+', input: 'aaa', maxSteps: 2 }).truncated, true);
assert.equal(trace({ pattern: 'a+', input: 'aaa', options: 1024 }).error.code, 'NonBacktrackingTraceUnavailable');
console.log('PASS: trimmed .NET 10.0.14 WebAssembly exports, captures, replacement, split, Unicode, culture, RTL, native traces and limits.');

