/**
 * Ambient shims for the CLIENT half, so `tsc` can check it WITHOUT
 * `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-ui-slots`
 * installed — they are peer dependencies resolved from the web profile's module
 * farm at runtime, and this repository never installs them.
 *
 * WHAT THIS IS FOR: catching mistakes in THIS plugin's own code — a stale
 * identifier after a refactor, a prop that no longer exists, a missing field, a
 * type that does not line up. Before it existed the client half was never
 * typechecked at all: `tsconfig.json` includes only the host entry, and tsdown
 * builds with `dts: false` while rolldown does no checking.
 *
 * WHAT THIS IS NOT: a copy of the harness's types. Everything at the dsh
 * boundary below is deliberately loose, so it can confirm a call is shaped
 * roughly right but never that it matches the real signature. The authority is
 * the harness monorepo, and a green check here does NOT prove this plugin still
 * fits the host it mounts into — only running it does. Widen a declaration when
 * it blocks correct code; never narrow one to encode a guess.
 */

declare module '*.module.css' {
  /** CSS-module class map; the build inlines the stylesheet and exports this. */
  const classes: Record<string, string>
  export default classes
}

/** Host frozen table supplies this at runtime; only `createPortal` is used here. */
declare module 'react-dom' {
  import type { ReactNode } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode
}

/** Bare specifier imported for load ordering only; it contributes no types here. */
declare module '@deepseek-ai/dsh-client-runtime' {}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  /** One slot contribution, as `ctx.slots.register` accepts it. */
  export interface SlotRegistration {
    /** Slot to contribute to. */
    readonly name: string
    /** Identity of this contribution within the slot. */
    readonly id: string
    /** Sort key among the slot's entries. */
    readonly order?: number
    /**
     * Locale namespace. Declaring it makes the framework synthesize the `t` prop;
     * this plugin's namespace is outside dsh's typed map, so the component
     * declares `t` itself rather than receiving a checked type here.
     */
    readonly locale?: string
    /** Business callbacks handed to the component as props. */
    readonly inject?: () => Record<string, unknown>
  }

  /** The client-side plugin context an `apply` receives. */
  export interface ClientContext {
    /**
     * Register a contribution as a disposable effect.
     * @param apply - performs the registration and returns its disposer.
     * @param label - diagnostic name for the effect.
     * @returns a disposer for the effect itself.
     */
    effect(apply: () => (() => void) | void, label?: string): () => void
    slots: {
      /**
       * Run `apply` once the named slot exists.
       * @param name - slot being contributed to.
       * @param apply - performs the registration.
       */
      inject(name: string, apply: () => void): void
      /**
       * Contribute one component to a slot.
       * @param registration - slot, identity, ordering, locale and injected props.
       * @param component - the component rendered for this entry.
       * @returns the disposer.
       */
      register(registration: SlotRegistration, component: unknown): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /**
   * Props every slot component receives from the runtime.
   *
   * The real type is keyed on the slot name; this approximation carries only the
   * members this plugin reads, which is what lets its own usage be checked.
   */
  export interface PropsRuntime<N extends string = string> {
    /** Session this header belongs to. */
    readonly sessionId: string
    /**
     * Subscribe to a slice of the sessions store. The store's type lives in the
     * harness, so the selector's parameter is annotated at each call site.
     * @param selector - picks the slice to subscribe to.
     * @returns the selected slice.
     */
    readonly useSessions: <T>(selector: (state: never) => T) => T
  }
}
