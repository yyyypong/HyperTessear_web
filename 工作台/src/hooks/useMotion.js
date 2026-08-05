import { useEffect, useRef, useState } from 'react';

/**
 * Motion primitives.
 *
 * All three respect prefers-reduced-motion by resolving immediately to
 * their end state rather than by running a shorter animation — a user who
 * has asked for no motion wants no motion, not less of it.
 */

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One-shot scroll reveal. Returns [ref, isIn].
 *
 * One-shot rather than symmetric: re-hiding a block when it leaves the
 * viewport means anything the reader scrolls back to flickers, and on a
 * long page that reads as a rendering bug rather than as an effect.
 */
export function useInView({ threshold = 0.1, rootMargin = '0px 0px -10% 0px' } = {}) {
  const ref = useRef(null);
  const [isIn, setIsIn] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) { setIsIn(true); return undefined; }

    const el = ref.current;
    if (!el) return undefined;

    // No IntersectionObserver (old Safari, jsdom): show everything rather
    // than leave the page permanently blank.
    if (typeof IntersectionObserver === 'undefined') { setIsIn(true); return undefined; }

    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setIsIn(true); obs.disconnect(); }
    }, { threshold, rootMargin });

    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, rootMargin]);

  return [ref, isIn];
}

/**
 * Counts from zero to `target` once `active` is true.
 *
 * Eased rather than linear: a linear counter reads as a loading spinner,
 * an eased one reads as a value settling.
 */
export function useCountUp(target, active, { duration = 1400 } = {}) {
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const end = Number(target);
    if (!active || !Number.isFinite(end)) return undefined;
    if (prefersReducedMotion()) { setValue(end); return undefined; }

    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(end * eased);
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, active, duration]);

  return value;
}

/** True once the page has scrolled past `offset`. Drives the masthead state. */
export function useScrolled(offset = 24) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => setScrolled(window.scrollY > offset);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, [offset]);

  return scrolled;
}
