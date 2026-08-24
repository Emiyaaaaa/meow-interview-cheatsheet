import { useCallback, useEffect, useState } from "react";

export const DEFAULT_APP_NAME = "神奇面试小抄";
const STORAGE_KEY = "app-name";

export function getStoredAppName(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored?.trim() || DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}

export function storeAppName(name: string): string {
  const trimmed = name.trim() || DEFAULT_APP_NAME;
  localStorage.setItem(STORAGE_KEY, trimmed);
  return trimmed;
}

function syncAppNameDisplay(name: string) {
  document.title = name;
  window.desktop.setWindowTitle(name);
}

export function useAppName() {
  const [appName, setAppNameState] = useState(getStoredAppName);

  useEffect(() => {
    const name = getStoredAppName();
    syncAppNameDisplay(name);
  }, []);

  const setAppName = useCallback((name: string) => {
    const trimmed = storeAppName(name);
    setAppNameState(trimmed);
    syncAppNameDisplay(trimmed);
  }, []);

  return { appName, setAppName };
}
