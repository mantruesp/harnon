import { useEffect, useState } from "react";

// Detect the local auto-apply helper (only reachable when running on the user's machine)
export function useLocalHelper(): boolean {
  const [localReady, setLocalReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    fetch("http://localhost:8787/ping", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => { if (!cancelled) setLocalReady(true); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  return localReady;
}
