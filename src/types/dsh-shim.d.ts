/**
 * Ambient shims so `tsc` can transpile the host half WITHOUT the @deepseek-ai
 * packages installed locally — they resolve from the web profile's module farm
 * at runtime. Types here are intentionally loose (strict is off); they exist
 * only to let the decorator transform and emit. The real types live in the
 * harness monorepo and govern behaviour once loaded in-profile.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: {
      /** ToolRuntime.register — returns the dispose callback; loose here, see file header. */
      register(definition: unknown): () => void
    }
    /**
     * SystemPrompt registry. Only `context()` is mirrored — the dynamic
     * per-assembly contribution, whose `text` provider is SYNCHRONOUS (see the
     * real `PromptContext` in packages/core/system-prompt/src/index.ts). The
     * `agent` field on the assemble context is merged in by `dsh-agent`.
     */
    systemPrompt: {
      context(input: {
        name: string
        order: number
        text: (context: { agent?: { session: { id: string } } }) => string
      }): () => void
    }
    /** Mount a child scope once the named services are available; loose here, see file header. */
    inject(services: readonly string[], apply: (scope: Context) => void): void
    subprocess: {
      spawn(spec: {
        argv: readonly string[]
        cwd: string
        stdio: { stdin: unknown; stdout: 'pipe'; stderr: 'pipe' }
        graceMs: number
        signal?: AbortSignal
        /** Merged onto the implementation's scrubbed base environment. */
        env?: Record<string, string> | undefined
      }): {
        stdout: import('node:stream').Readable | undefined
        stderr: import('node:stream').Readable | undefined
        done: Promise<{ exitCode: number | null; signal: string | null }>
      }
    }
  }
  export class Service<T = never> {
    constructor(ctx: Context, name: string)
    readonly ctx: Context
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Service, Context } from '@deepseek-ai/cordis'
  type Stage3MethodDecorator = (value: Function, context: ClassMethodDecoratorContext) => void
  export class TypertRemoteService<T = never> extends Service<T> {
    protected constructor(ctx: Context, serviceKey: string, options?: { namespace?: string })
    readonly typertRemote: unknown
  }
  export function Remote(): Stage3MethodDecorator
  export function Remote(exportName: string): Stage3MethodDecorator
}

declare module '@deepseek-ai/dsh-tools' {
  /**
   * Loose mirror of the real ToolRunContext (packages/core/tools/src/index.ts):
   * only the agent → session → header.cwd path the worktree tools read. The
   * real type carries far more (signal, deferContext, events, ...); the shim
   * keeps tsc happy while the runtime object provides these fields.
   */
  export interface ToolRunContext {
    agent?: { id: string; session: { id: string; header: { cwd?: string } } }
    /** Turn-scoped cancellation the executor always supplies; forward it to every subprocess. */
    signal: AbortSignal
  }
  /** Identity-typed defineTool — it only wraps the definition object at runtime. */
  export function defineTool(tool: Record<string, unknown>): unknown
}
