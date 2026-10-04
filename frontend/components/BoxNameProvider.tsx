"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, onUserChanged } from "@/lib/auth";
import { boxNameFor, DEFAULT_BOX_NAME } from "@/lib/box-name";

const BoxNameContext = createContext<string>(DEFAULT_BOX_NAME);

/** Gives every client component the signed-in person's list name ("Amir Box"). */
export function BoxNameProvider({ displayName, children }: { displayName: string; children: React.ReactNode }) {
  const [name, setName] = useState(boxNameFor(displayName));
  useEffect(
    () =>
      onUserChanged(() => {
        getCurrentUser()
          .then((u) => u && setName(boxNameFor(u.display_name)))
          .catch(() => {});
      }),
    []
  );
  return <BoxNameContext.Provider value={name}>{children}</BoxNameContext.Provider>;
}

export function useBoxName(): string {
  return useContext(BoxNameContext);
}
