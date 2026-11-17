import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { ReferenceNavigation } from './reference-navigation.ts'
import { matchesReferenceSource, type ReferenceScope } from './reference-reveal.ts'
import type { WorkbenchReference } from './workbench-reference.ts'
import type { CodeSource } from './code-excerpt.ts'

export const ReferenceRevealNavigation = createContext<{ navigation: ReferenceNavigation; sessionId: string } | null>(null)
const Scope = createContext<(ReferenceScope & { onReveal(): void }) | null>(null)

export function ReferenceRevealScope({ children, repository, view, active, onReveal }: ReferenceScope & { children: ReactNode; onReveal?: () => void }) {
  return <Scope.Provider value={onReveal ? { repository, view, active, onReveal } : null}>{children}</Scope.Provider>
}

/** Only the originating workbench participates; preview panes cannot consume navigation. */
export function useReferenceReveal(path: string | undefined, source: CodeSource, reveal: (target: WorkbenchReference) => boolean): void {
  const service = useContext(ReferenceRevealNavigation), scope = useContext(Scope)
  const latest = useRef({ path, source, reveal, scope })
  latest.current = { path, source, reveal, scope }
  useEffect(() => {
    if (!service || !scope?.active || path === undefined) return
    return service.navigation.bindReveal(service.sessionId, target => {
      const current = latest.current
      if (!current.scope || !matchesReferenceSource(target, current.scope, current.path!, current.source) || !current.reveal(target)) return false
      current.scope.onReveal()
      return true
    })
  })
}
