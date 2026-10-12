// Refuses to start the tests on a Node that cannot finish them.
//
// Node 23 plus this stack (vitest + happy-dom + the xterm bundle) hangs
// during module load, before a single test runs. It does not fail — the
// workers spin at 100% and never return — so without this you get a build
// that looks busy forever rather than one that tells you what is wrong.
// Measured back to back on one machine at the same load: 23.10 never
// finished, 22.20 and 24.12 both passed in about half a second.
//
// 23 is an odd-numbered release and left support in mid-2025; the rule is
// simply "use an LTS", which `engines` in package.json also states.
const [major] = process.versions.node.split('.').map(Number)

if (major === 23) {
  console.error(
    `\n  Node ${process.versions.node} hangs this test suite on module load.\n` +
      `  It will not fail, it will just never finish.\n\n` +
      `  Use an LTS release instead:  nvm use   (.nvmrc pins 22, which is what CI runs)\n`,
  )
  process.exit(1)
}
