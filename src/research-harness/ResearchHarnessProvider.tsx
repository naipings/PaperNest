import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { loadDshSnapshot } from "./sessionBridge";

type HarnessContextValue = {
  loading: boolean;
  error: string | null;
  eventCount: number;
  reload: (researchSessionId: string) => Promise<void>;
};

const HarnessContext = createContext<HarnessContextValue | null>(null);

export function ResearchHarnessProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);

  const reload = useCallback(async (researchSessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadDshSnapshot(researchSessionId);
      setEventCount(snapshot.events.length);
    } catch (e) {
      setEventCount(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({ loading, error, eventCount, reload }),
    [loading, error, eventCount, reload],
  );

  return <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>;
}

export function useResearchHarness() {
  const ctx = useContext(HarnessContext);
  if (!ctx) {
    throw new Error("useResearchHarness 必须在 ResearchHarnessProvider 内使用");
  }
  return ctx;
}
