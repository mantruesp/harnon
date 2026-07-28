import { useEffect, useState } from "react";
import type { ModelInfo } from "../types";

export function useModels() {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // Fetch available models from the backend
  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        const list: ModelInfo[] = d.models || [];
        setAvailableModels(list);
        if (list.length > 0 && !selectedModel) {
          // Default to Sonnet — the best cost/capability balance with live
          // search — regardless of the order /api/models happens to return.
          const preferred = list.find((m) => m.id === "claude-sonnet-5") || list[0];
          setSelectedModel(preferred.id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel = availableModels.find((m) => m.id === selectedModel);
  const hasWebSearch = currentModel?.webSearch === true;

  return { availableModels, selectedModel, setSelectedModel, currentModel, hasWebSearch };
}
