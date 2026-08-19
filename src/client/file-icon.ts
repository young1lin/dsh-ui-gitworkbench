/**
 * What a file's icon says about its language: a colour and a one- or two-letter
 * monogram, keyed off the path.
 *
 * The obvious ask is the mascots — the gopher, the coffee cup, the crab. Those
 * are not ours to ship: the gopher is a CC-BY work of Renée French, the cup and
 * the two snakes are registered marks of Oracle and the PSF, and this is a
 * package published to npm rather than a screenshot. So the icon keeps the
 * drawer's own sheet outline and carries the language's canonical brand colour
 * with a monogram on it — recognisable at a glance in a column of files, and
 * nobody's mark reproduced.
 *
 * Colours are each language's own published one where it has it (Go's cyan,
 * Rust's rust, TypeScript's blue), which is what makes the column scannable:
 * you learn "the cyan ones are Go" in about four files without reading a
 * single letter.
 *
 * Pure: no React, no DOM. `tests/file-icon.test.ts` loads it directly.
 *
 * @module @young1lin/dsh-ui-gitworkbench/client/file-icon
 */

/** How one file type paints. */
export interface FileIcon {
  /** One or two characters, uppercase; '' for a file with no language. */
  readonly mono: string
  /** The tint, as a CSS colour. */
  readonly color: string
}

/** What a file whose type we have nothing to say about looks like: the
 *  drawer's ordinary foreground, no monogram. */
export const PLAIN: FileIcon = { mono: '', color: 'var(--gs-fg-faint)' }

/**
 * By extension. Two letters where one would collide (JS/JSON, TS/TSX), one
 * where it reads cleanly.
 */
const BY_EXT: Readonly<Record<string, FileIcon>> = {
  go: { mono: 'GO', color: '#00add8' },
  mod: { mono: 'GO', color: '#00add8' },
  sum: { mono: 'GO', color: '#00add8' },
  java: { mono: 'J', color: '#e76f00' },
  class: { mono: 'J', color: '#e76f00' },
  jar: { mono: 'J', color: '#e76f00' },
  kt: { mono: 'KT', color: '#7f52ff' },
  kts: { mono: 'KT', color: '#7f52ff' },
  scala: { mono: 'SC', color: '#dc322f' },
  groovy: { mono: 'GR', color: '#4298b8' },
  ts: { mono: 'TS', color: '#3178c6' },
  mts: { mono: 'TS', color: '#3178c6' },
  cts: { mono: 'TS', color: '#3178c6' },
  tsx: { mono: 'TX', color: '#3178c6' },
  js: { mono: 'JS', color: '#f7df1e' },
  mjs: { mono: 'JS', color: '#f7df1e' },
  cjs: { mono: 'JS', color: '#f7df1e' },
  jsx: { mono: 'JX', color: '#f7df1e' },
  py: { mono: 'PY', color: '#3776ab' },
  pyi: { mono: 'PY', color: '#3776ab' },
  rs: { mono: 'RS', color: '#dea584' },
  rb: { mono: 'RB', color: '#cc342d' },
  php: { mono: 'PH', color: '#777bb4' },
  cs: { mono: 'C#', color: '#68217a' },
  c: { mono: 'C', color: '#5588cc' },
  h: { mono: 'H', color: '#5588cc' },
  cpp: { mono: 'C+', color: '#00599c' },
  cc: { mono: 'C+', color: '#00599c' },
  cxx: { mono: 'C+', color: '#00599c' },
  hpp: { mono: 'H+', color: '#00599c' },
  hh: { mono: 'H+', color: '#00599c' },
  m: { mono: 'OC', color: '#438eff' },
  mm: { mono: 'OC', color: '#438eff' },
  swift: { mono: 'SW', color: '#f05138' },
  dart: { mono: 'DA', color: '#0175c2' },
  lua: { mono: 'LU', color: '#000080' },
  r: { mono: 'R', color: '#276dc3' },
  jl: { mono: 'JL', color: '#9558b2' },
  ex: { mono: 'EX', color: '#6e4a7e' },
  exs: { mono: 'EX', color: '#6e4a7e' },
  erl: { mono: 'ER', color: '#a90533' },
  hs: { mono: 'HS', color: '#5e5086' },
  clj: { mono: 'CL', color: '#5881d8' },
  cljs: { mono: 'CL', color: '#5881d8' },
  zig: { mono: 'ZI', color: '#f7a41d' },
  nim: { mono: 'NI', color: '#ffe953' },
  pl: { mono: 'PL', color: '#39457e' },
  pm: { mono: 'PL', color: '#39457e' },
  vue: { mono: 'VU', color: '#41b883' },
  svelte: { mono: 'SV', color: '#ff3e00' },
  astro: { mono: 'AS', color: '#ff5d01' },
  sh: { mono: 'SH', color: '#89e051' },
  bash: { mono: 'SH', color: '#89e051' },
  zsh: { mono: 'SH', color: '#89e051' },
  fish: { mono: 'SH', color: '#89e051' },
  ps1: { mono: 'PS', color: '#012456' },
  bat: { mono: 'BT', color: '#c1f12e' },
  sql: { mono: 'SQ', color: '#e38c00' },
  html: { mono: 'HT', color: '#e34c26' },
  htm: { mono: 'HT', color: '#e34c26' },
  css: { mono: 'CS', color: '#563d7c' },
  scss: { mono: 'SA', color: '#c6538c' },
  sass: { mono: 'SA', color: '#c6538c' },
  less: { mono: 'LE', color: '#1d365d' },
  json: { mono: 'JN', color: '#cbcb41' },
  jsonc: { mono: 'JN', color: '#cbcb41' },
  yaml: { mono: 'YM', color: '#cb171e' },
  yml: { mono: 'YM', color: '#cb171e' },
  toml: { mono: 'TM', color: '#9c4221' },
  ini: { mono: 'IN', color: '#6d8086' },
  cfg: { mono: 'IN', color: '#6d8086' },
  conf: { mono: 'IN', color: '#6d8086' },
  env: { mono: 'EN', color: '#edd100' },
  xml: { mono: 'XM', color: '#0060ac' },
  md: { mono: 'MD', color: '#7aa6da' },
  mdx: { mono: 'MD', color: '#7aa6da' },
  rst: { mono: 'RS', color: '#7aa6da' },
  txt: { mono: 'TX', color: 'var(--gs-fg-faint)' },
  csv: { mono: 'CV', color: '#41a05f' },
  svg: { mono: 'SV', color: '#ffb13b' },
  png: { mono: 'IM', color: '#a074c4' },
  jpg: { mono: 'IM', color: '#a074c4' },
  jpeg: { mono: 'IM', color: '#a074c4' },
  gif: { mono: 'IM', color: '#a074c4' },
  webp: { mono: 'IM', color: '#a074c4' },
  ico: { mono: 'IM', color: '#a074c4' },
  pdf: { mono: 'PD', color: '#d93831' },
  zip: { mono: 'ZP', color: '#b8a038' },
  gz: { mono: 'ZP', color: '#b8a038' },
  tar: { mono: 'ZP', color: '#b8a038' },
  lock: { mono: 'LK', color: '#8b8b8b' },
  proto: { mono: 'PB', color: '#4285f4' },
  graphql: { mono: 'GQ', color: '#e10098' },
  gql: { mono: 'GQ', color: '#e10098' },
  tf: { mono: 'TF', color: '#7b42bc' },
  vim: { mono: 'VI', color: '#019833' },
}

/**
 * By whole filename, for the files that carry their type in their NAME rather
 * than an extension — a Dockerfile has no suffix, and `.gitignore` is all
 * suffix. Matched case-insensitively before the extension table.
 */
const BY_NAME: Readonly<Record<string, FileIcon>> = {
  dockerfile: { mono: 'DK', color: '#2496ed' },
  'docker-compose.yml': { mono: 'DK', color: '#2496ed' },
  'docker-compose.yaml': { mono: 'DK', color: '#2496ed' },
  makefile: { mono: 'MK', color: '#427819' },
  cmakelists: { mono: 'CM', color: '#064f8c' },
  'cmakelists.txt': { mono: 'CM', color: '#064f8c' },
  '.gitignore': { mono: 'GI', color: '#f05033' },
  '.gitattributes': { mono: 'GI', color: '#f05033' },
  '.gitmodules': { mono: 'GI', color: '#f05033' },
  '.npmrc': { mono: 'NP', color: '#cb3837' },
  '.nvmrc': { mono: 'NP', color: '#cb3837' },
  'package.json': { mono: 'NP', color: '#cb3837' },
  'package-lock.json': { mono: 'NP', color: '#cb3837' },
  'pnpm-lock.yaml': { mono: 'PN', color: '#f69220' },
  'yarn.lock': { mono: 'YN', color: '#2c8ebb' },
  'cargo.toml': { mono: 'RS', color: '#dea584' },
  'cargo.lock': { mono: 'RS', color: '#dea584' },
  'go.mod': { mono: 'GO', color: '#00add8' },
  'go.sum': { mono: 'GO', color: '#00add8' },
  'pom.xml': { mono: 'MV', color: '#c71a36' },
  'build.gradle': { mono: 'GD', color: '#02303a' },
  'build.gradle.kts': { mono: 'GD', color: '#02303a' },
  license: { mono: 'LI', color: '#d0b000' },
  'license.md': { mono: 'LI', color: '#d0b000' },
  readme: { mono: 'MD', color: '#7aa6da' },
  'readme.md': { mono: 'MD', color: '#7aa6da' },
}

/**
 * The icon for one path.
 *
 * The whole-name table wins over the extension table, so `package.json` reads
 * as npm rather than as generic JSON — the name is the more specific fact.
 *
 * @param path - repo-relative or bare filename; only the last segment matters.
 */
export function fileIcon(path: string): FileIcon {
  const name = (path.split('/').pop() ?? '').toLowerCase()
  if (name.length === 0) return PLAIN
  const byName = BY_NAME[name]
  if (byName !== undefined) return byName
  const dot = name.lastIndexOf('.')
  // A leading dot is the whole name of a dotfile, not the start of a suffix:
  // `.gitignore` has no extension, and `git` is not a language.
  if (dot <= 0) return PLAIN
  return BY_EXT[name.slice(dot + 1)] ?? PLAIN
}
