"use client";

import { createContext, useContext } from "react";
import { adminPaths, pathsFor, type AppKind, type AppPaths } from "./paths";

const AppPathsContext = createContext<AppPaths>(adminPaths);

/** Rendered by each surface's layout so client components link to the right place. Defaults to the legacy admin table. */
export function AppPathsProvider({ kind, children }: { kind: AppKind; children: React.ReactNode }) {
  return <AppPathsContext.Provider value={pathsFor(kind)}>{children}</AppPathsContext.Provider>;
}

export function useAppPaths(): AppPaths {
  return useContext(AppPathsContext);
}
