import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [statuses, setStatuses] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    return Promise.all([api.listStatuses(), api.listOutcomes(), api.listCustomFields()]).then(([s, o, c]) => {
      setStatuses(s);
      setOutcomes(o);
      setCustomFields(c);
      setLoaded(true);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SettingsContext.Provider value={{ statuses, outcomes, customFields, loaded, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
