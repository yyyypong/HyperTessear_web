import { createContext, useContext } from 'react';
import { api } from '../lib/api';
import { useApi } from './useApi';

/**
 * Homepage metrics are needed by both the header (live TVL badge +
 * status dot) and the home page (KPI row). Fetching once at the app
 * root and sharing keeps it to a single request per locale.
 */
const MetricsContext = createContext(null);

export function MetricsProvider({ children }) {
  const state = useApi(api.homepageMetrics);
  return <MetricsContext.Provider value={state}>{children}</MetricsContext.Provider>;
}

export function useMetrics() {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error('useMetrics must be used inside <MetricsProvider>');
  return ctx;
}
