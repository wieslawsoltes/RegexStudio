// The studio hosts this runtime in a dedicated module worker. This file is also
// a small standalone entry point for consumers of the reusable engine package.
import { dotnet } from './_framework/dotnet.js';
const runtime = await dotnet.withDiagnosticTracing(false).create();
const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
export const engine = exports.RegexStudio.Engine;

