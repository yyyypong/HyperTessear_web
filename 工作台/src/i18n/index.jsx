import { createContext, useContext, useEffect, useMemo, useState, Fragment } from 'react';
import zhCN from './zh-CN';
import en from './en';

const DICTS = { 'zh-CN': zhCN, en };
const DEFAULT_LOCALE = 'zh-CN';
const STORAGE_KEY = 'hyt.locale';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return DICTS[saved] ? saved : DEFAULT_LOCALE;
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = DICTS[locale].meta.title;
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    setLocale: (l) => DICTS[l] && setLocaleState(l),
    t: DICTS[locale],
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n must be used inside <LocaleProvider>');
  return ctx;
}

/** Replace {name} placeholders: fmt('显示 {n} / {total}', {n: 3, total: 5}) */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

/**
 * Renders locale strings that carry light markup:
 *   *text*   -> gold emphasis
 *   **text** -> bold
 *   \n       -> line break
 * Keeps the emphasis decisions in the translation file rather than
 * hardcoded in JSX, so a translator can move them.
 */
export function Highlight({ text, as: Tag = 'span', className }) {
  if (!text) return null;

  const renderLine = (line, lineKey) => {
    // ** first, then * — split keeps the delimiters' content in odd slots
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
    return parts.map((part, i) => {
      const key = `${lineKey}-${i}`;
      if (part.startsWith('**') && part.endsWith('**')) {
        return <b key={key}>{part.slice(2, -2)}</b>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
  };

  const lines = String(text).split('\n');
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderLine(line, i)}
        </Fragment>
      ))}
    </Tag>
  );
}
