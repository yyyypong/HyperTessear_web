import { useInView } from '../hooks/useMotion';

/**
 * Fades and lifts its children into place the first time they scroll into
 * view. The actual transition lives in app.css so the timing stays with the
 * rest of the motion vocabulary.
 *
 * `step` staggers siblings: pass the index and each one starts 70ms after
 * the last, which makes a grid arrive as a group rather than as a burst.
 */
export default function Reveal({
  as: Tag = 'div', step = 0, className = '', style, children, ...rest
}) {
  const [ref, isIn] = useInView();

  return (
    <Tag
      ref={ref}
      className={`reveal${isIn ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--step': step, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
