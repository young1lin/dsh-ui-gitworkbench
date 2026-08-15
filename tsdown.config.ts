/**
 * Out-of-tree build — CLIENT half (lib/client.js) in the closure-factory shape.
 *
 * Host half (lib/index.js) is emitted by `tsc` (tsconfig.json) — it reliably
 * transforms the stage-3 @Remote decorator, which tsdown/rolldown does not.
 *
 * Vendored from packages/client/tsdown.client.ts: the closure-factory
 * banner/footer/intro, the platform externals, AND the CSS-modules-inline
 * plugin (so this plugin can ship a .module.css using the --dsw-* theme
 * tokens, exactly like in-tree plugins). Dropped: the repo-relative
 * sourcemap path transform (not needed out-of-tree).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The dsh shell shares these into its frozen module table (PLATFORM_MODULES + the runtime/client exemption). */
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form', '@deepseek-ai/dsh-client-runtime/client',
]

const PLUGIN_ID = '@young1lin/dsh-ui-gitworkbench'
const nodeEnv = JSON.stringify(process.env.NODE_ENV ?? 'production')

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline.
 *
 * The id must stay machine-independent (cwd-relative, posix separators):
 * rolldown echoes it into the bundle as a `//#region` comment. An earlier
 * version used the absolute path here, shipping the dev machine's checkout
 * layout inside lib/client.js — which is exactly what gets published by a
 * manual first `npm publish`. ci.yml/publish.yml grep the built lib/ for
 * machine paths as a backstop. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export default defineConfig([
  {
    name: 'gitworkbench-client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': nodeEnv,
      'import.meta.env.MODE': nodeEnv,
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [
      {
        name: 'dsh-css-modules-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.module.css')) return null
          const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
          return CSS_VIRTUAL_PREFIX + relative(process.cwd(), abs).split(sep).join('/') + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
          const fileId = resolvePath(process.cwd(), virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
          if (!existsSync(fileId)) return null
          this.addWatchFile(fileId)
          const source = await readFile(fileId)
          const { code, exports: cssExports } = transform({
            filename: fileId, code: source,
            cssModules: { pattern: '[hash]_[local]' }, minify: true,
          })
          const classMap: Record<string, string> = {}
          for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
          const tagId = `${PLUGIN_ID}/${basename(fileId)}`
          return [
            `const css = ${JSON.stringify(code.toString())};`,
            `const tagId = ${JSON.stringify(tagId)};`,
            'if (typeof document !== "undefined" && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
            '  const tag = document.createElement(\'style\');',
            `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
            '  tag.dataset.pluginCss = tagId;',
            '  tag.textContent = css;',
            '  document.head.appendChild(tag);',
            '}',
            `export default ${JSON.stringify(classMap)};`,
          ].join('\n')
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      inlineDynamicImports: true,
    },
  },
])
