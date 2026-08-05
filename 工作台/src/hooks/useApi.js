import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/**
 * Minimal data-fetching hook: loading / error / data / retry, with
 * in-flight requests aborted on unmount or locale change.
 *
 * Deliberately dependency-free. If this app grows past a handful of
 * endpoints, swap it for TanStack Query — the call sites won't change
 * much because the returned shape is the same.
 *
 *   const { data, loading, error, retry } = useApi(api.products);
 */
export function useApi(fetcher, deps = []) {
  const { locale } = useI18n();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    setState(s => ({ ...s, loading: true, error: null }));

    fetcher({ locale, signal: controller.signal })
      .then(data => { if (alive) setState({ data, loading: false, error: null }); })
      .catch(err => {
        if (!alive || err.name === 'AbortError') return;
        setState({ data: null, loading: false, error: err });
      });

    return () => { alive = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, nonce, ...deps]);

  return { ...state, retry };
}
