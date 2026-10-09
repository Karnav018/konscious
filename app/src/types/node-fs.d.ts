// Konscious ships to a webview, not to node, so @types/node is not a
// dependency — and `?raw` imports come back empty under vitest, which does
// not process CSS. lib/palette.test.ts has to read tokens.css to compare the
// real values, so the one node API it needs is declared here rather than
// adding a typings package for a single call.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}
