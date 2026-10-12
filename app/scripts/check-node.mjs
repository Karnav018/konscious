// Refuses to run the tests on a Node that cannot finish them.
//
// Node 23 plus this stack (vitest + happy-dom + the xterm bundle) hangs
// during module load, before a single test runs. It does not fail — the
// workers spin at 100% and never return — so without this you get a test
// command that looks busy forever rather than one that tells you what is
// wrong. Measured back to back on one machine at the same load: 23.10 never
// finished, 22.20 and 24.12 both passed in about half a second.
//
// 23 is an odd-numbered release and left support in mid-2025; the rule is
// simply "use an LTS", which `engines` in package.json also states.
//
// Called from two places, because there are two ways in: the `pretest` hook
// covers `npm test`, and vite.config calls it when vitest loads the config,
// which covers a direct `npx vitest run` — the way this was most often run
// while being investigated, and the way that would otherwise still hang.

/** Why this Node will not do, or null when it is fine. */
export function nodeProblem(version = process.versions.node) {
  const [major] = version.split('.').map(Number)
  if (major !== 23) return null
  return (
    `\n  Node ${version} hangs this test suite on module load.\n` +
    `  It will not fail, it will just never finish.\n\n` +
    `  Use an LTS release instead:  nvm use   (.nvmrc pins 22, which is what CI runs)\n`
  )
}

/** Stops now, loudly, rather than later and silently. */
export function refuseBadNode() {
  const problem = nodeProblem()
  if (problem === null) return
  console.error(problem)
  process.exit(1)
}

// Run when invoked as a script, which is what the pretest hook does.
if (process.argv[1]?.endsWith('check-node.mjs')) refuseBadNode()
