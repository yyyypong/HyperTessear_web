import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, Highlight } from '../i18n';

/* Geometric clover mark — same signature as the masthead. */
function CloverMark({ size = 26 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <g fill="currentColor">
        <rect x="13.2" y="3" width="5.6" height="12.4" rx="2.8" />
        <rect x="13.2" y="16.6" width="5.6" height="12.4" rx="2.8" />
        <rect x="3" y="13.2" width="12.4" height="5.6" rx="2.8" />
        <rect x="16.6" y="13.2" width="12.4" height="5.6" rx="2.8" />
      </g>
    </svg>
  );
}

/* Official brand glyphs for the social row. */
const SOCIALS = [
  {
    id: 'x', label: 'X',
    path: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  },
  {
    id: 'linkedin', label: 'LinkedIn',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  {
    id: 'github', label: 'GitHub',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  {
    id: 'discord', label: 'Discord',
    path: 'M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.098 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.077.077 0 00-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.029 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.028-.029zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z',
  },
];

/* Giant faded wordmark closing the page. The SVG viewBox is refit to
   the rendered glyphs so the visible edges sit flush against the card
   width above — the same trick as the Kresna footer. */
function Watermark({ text }) {
  const svgRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    const fit = () => {
      const svg = svgRef.current;
      const el = textRef.current;
      if (!svg || !el) return;
      try {
        const b = el.getBBox();
        svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
      } catch { /* fonts not ready yet — the refit retries on fonts.ready */ }
    };
    fit();
    if (document.fonts?.ready) document.fonts.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);

  return (
    <div className="lftr__watermark" aria-hidden="true">
      <svg ref={svgRef} viewBox="0 0 100 24" preserveAspectRatio="xMidYMid meet">
        <text ref={textRef} x="50" y="19" textAnchor="middle" fontSize="22">{text}</text>
      </svg>
    </div>
  );
}

/**
 * Footer: a layered light card (gray shell, white directory box)
 * carrying the brand column, the three link directories, the legal
 * notes, and the legal bar — then the oversized faded wordmark.
 * All legal content from the original footer is preserved.
 */
export default function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="lftr">
      <div className="lftr__card">
        <div className="lftr__inner">
          <div className="lftr__brandcol">
            <Link to="/" className="lftr__brand">
              <CloverMark />
              <span className="lftr__brand-name">{t.brand}</span>
            </Link>
            <div className="lftr__entity">
              {t.footer.entity}
              <Highlight text={t.footer.address} as="div" />
            </div>
            <div className="lftr__socials">
              {SOCIALS.map(s => (
                <button key={s.id} type="button" className="lftr__social" aria-label={s.label} title={s.label}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d={s.path} />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="lftr__col">
            <div className="lftr__col-title">{t.footer.resources}</div>
            <Link to="/products">{t.footer.linkProducts}</Link>
            <Link to="/transparency">{t.footer.linkTransparency}</Link>
            <Link to="/liquidity">{t.footer.linkLiquidity}</Link>
            <span>{t.footer.linkDocs}</span>
          </div>

          <div className="lftr__col">
            <div className="lftr__col-title">{t.footer.company}</div>
            <Link to="/about">{t.footer.linkAbout}</Link>
            <span>{t.footer.linkCareers}</span>
            <span>{t.footer.linkBlog}</span>
          </div>

          <div className="lftr__col">
            <div className="lftr__col-title">{t.footer.legal}</div>
            <span>{t.footer.linkTerms}</span>
            <span>{t.footer.linkPrivacy}</span>
            <span>{t.footer.linkImprint}</span>
          </div>
        </div>

        <div className="lftr__notes">
          <p><sup>1</sup>{t.footer.note1}</p>
          <p><sup>2</sup>{t.footer.note2}</p>
          <p><sup>3</sup>{t.footer.note3}</p>
          <p>{t.footer.restriction}</p>
        </div>

        <div className="lftr__legal">
          <span>© {year} {t.brand}. {t.footer.rights}</span>
          <span className="lftr__legal-links">
            <Link to="/about">{t.footer.linkImprint}</Link>
            <span className="lftr__legal-sep" aria-hidden="true" />
            <Link to="/transparency">{t.footer.linkTransparency}</Link>
          </span>
        </div>
      </div>

      <Watermark text={t.brand} />
    </footer>
  );
}
