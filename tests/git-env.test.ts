/**
 * The isolation the real-git suites run under, proven on the machine that
 * has the hostile config. If the env ever stops applying — a dropped
 * option object, a renamed key — this is the machine-dependent failure
 * those suites would start having, caught here where it says so.
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { ISOLATED_GIT_ENV } from './git-env.ts'

describe('ISOLATED_GIT_ENV', () => {
  it('hides the machine\'s global and system git config from git', () => {
    // `--get` exits 1 when nothing matches — exactly the claim.
    const isolated = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
      encoding: 'utf8', env: ISOLATED_GIT_ENV,
    })
    expect(isolated.status).toBe(1)
    const gpg = spawnSync('git', ['config', '--get', 'commit.gpgsign'], {
      encoding: 'utf8', env: ISOLATED_GIT_ENV,
    })
    expect(gpg.status).toBe(1)
  })

  it('answers a config the ISOLATED env itself sets', () => {
    // The isolation must not be "git sees no config at all": GIT_CONFIG_COUNT
    // style entries in the env still work, so a suite can pin one key
    // deliberately.
    const pinned = { ...ISOLATED_GIT_ENV, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'test.pin', GIT_CONFIG_VALUE_0: 'yes' }
    const out = spawnSync('git', ['config', '--get', 'test.pin'], { encoding: 'utf8', env: pinned })
    expect(out.stdout.trim()).toBe('yes')
  })
})
