import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface Pov {
  versionId: string | null;
  fiscalYear: number;
  period: number;
  consGroupId: string | null;
}

interface PovContextValue {
  pov: Pov;
  setPov: (patch: Partial<Pov>) => void;
  ready: boolean;
}

const STORAGE_KEY = "cons.pov.v1";

const defaultPov: Pov = {
  versionId: null,
  fiscalYear: new Date().getUTCFullYear(),
  period: 12,
  consGroupId: null,
};

const PovContext = createContext<PovContextValue | null>(null);

export function PovProvider({ children }: { children: ReactNode }) {
  const [pov, setPovState] = useState<Pov>(defaultPov);
  const [ready, setReady] = useState(false);

  // Read localStorage after mount only — reading it during render or in a
  // useState initializer causes hydration mismatches.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setPovState({ ...defaultPov, ...(JSON.parse(raw) as Partial<Pov>) });
    } catch {
      /* ignore malformed storage */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pov));
    } catch {
      /* storage unavailable */
    }
  }, [pov, ready]);

  const value = useMemo<PovContextValue>(
    () => ({
      pov,
      ready,
      setPov: (patch) => setPovState((prev) => ({ ...prev, ...patch })),
    }),
    [pov, ready],
  );

  return <PovContext.Provider value={value}>{children}</PovContext.Provider>;
}

export function usePov(): PovContextValue {
  const ctx = useContext(PovContext);
  if (!ctx) throw new Error("usePov must be used inside <PovProvider>");
  return ctx;
}
