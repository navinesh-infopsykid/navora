/** Business settings shared by every page (name, currency…). Loaded once, refreshed after saving. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Settings } from "./api";
import { setCurrency } from "./money";

interface SettingsContextValue {
  settings: Settings | null;
  reload: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({ settings: null, reload: async () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<Settings>("/settings");
      setCurrency(data.currency);
      setSettings(data);
    } catch {
      // Pages show their own connection errors.
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <SettingsContext.Provider value={{ settings, reload }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
