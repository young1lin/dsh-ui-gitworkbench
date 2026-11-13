/**
 * The real-git suites spawn git in throwaway repositories. This machine's
 * global and system config must not leak into them: core.hooksPath pointed
 * at the host repo's lefthook made every test COMMIT run the hook chain
 * (noise on every machine, a failure on one that has it), and
 * commit.gpgsign on a developer's machine can fail every commit outright.
 * Pointing both config files at one empty file neutralizes both — no
 * per-repo setup, no deleting anything, no order dependence between
 * suites.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const emptyDir = mkdtempSync(join(tmpdir(), 'gw-git-config-'))
const emptyConfig = join(emptyDir, 'empty.gitconfig')
writeFileSync(emptyConfig, '', 'utf8')

/** An env for spawned git that reads NO ambient config: the suites'
 *  `git(...)` helpers pass this to execFileSync, so the only config a
 *  throwaway repository sees is what the test itself sets. */
export const ISOLATED_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CONFIG_SYSTEM: emptyConfig,
}
