import { createContext, useContext } from 'react'

export const WorkbenchVisibility = createContext(true)
export const useWorkbenchVisible = (): boolean => useContext(WorkbenchVisibility)
