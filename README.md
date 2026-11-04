# RegexStudio

A browser workspace for exploring, comparing, building, and learning regular expressions, powered by the actual .NET 10 regex engine running locally in WebAssembly.

**Live application:** https://wieslawsoltes.github.io/RegexStudio/

## Architecture

- Modular HTML, CSS, and JavaScript studio with a dockable, resizable workspace.
- .NET 10 `System.Text.RegularExpressions` for exact results, group and capture histories, replacement, and splitting.
- Instrumented regex execution and interactive explanations for learning how patterns work.
- Browser projects, portable project files, structured data import, and CORS-compatible online sources.
- C# code generation with explicit options and timeouts.

The application is under active construction. Feature contracts, verification results, and engine tracing boundaries will be documented as implementation lands.

## Development

Node.js 22+, .NET 10 SDK, and the `wasm-tools` workload are required for a complete build. The UI uses native ES modules with no framework dependency.

```sh
dotnet workload install wasm-tools
npm test
npm run build
npm run dev
```

GitHub Actions builds and deploys to GitHub Pages on pushes to `main`.
