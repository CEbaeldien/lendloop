"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

/**
 * Ensures the signed-in person has a Convex user row, then returns their
 * profile. Private queries should be skipped until this returns a user.
 */
export function useStoreUser() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [stored, setStored] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    store({}).then(() => !cancelled && setStored(true));
    return () => {
      cancelled = true;
      setStored(false);
    };
  }, [isAuthenticated, store]);

  const me = useQuery(api.users.me, stored ? {} : "skip");
  return { isLoading: isLoading || (isAuthenticated && !me), me: me ?? null, isAuthenticated };
}
