import Reveal from './Reveal';

/**
 * The opening band every inner page shares: full-bleed dark, eyebrow,
 * display title, lede.
 *
 * Previously each page opened with the same `.phead` block copied six
 * times inside `.wrap`, so every page began with a title floating on the
 * page background and the site had no sense of arrival. Pulling it into
 * one component also means the masthead can rely on always sitting over a
 * dark field at the top of a route.
 */
export default function PageHead({ eyebrow, title, lede, children }) {
  return (
    <header className="phead">
      <div className="phead__bg" aria-hidden="true" />
      <div className="wrap phead__inner">
        {eyebrow && <Reveal className="eyebrow eyebrow--on-dark">{eyebrow}</Reveal>}
        <Reveal as="h1" step={1} className="phead__title">{title}</Reveal>
        {lede && <Reveal as="p" step={2} className="phead__lede">{lede}</Reveal>}
        {children && <Reveal step={3} className="phead__extra">{children}</Reveal>}
      </div>
    </header>
  );
}
