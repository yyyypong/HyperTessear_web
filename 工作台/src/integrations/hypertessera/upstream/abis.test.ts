import { describe, expect, it } from 'vitest';
import { getAbi } from './abis';

describe('browser ABI loader', () => {
  it('returns current SDK contract ABIs without Node fs', () => {
    expect(getAbi('HyperAccessControl')).toEqual(expect.any(Array));
    expect(getAbi('Settlement')).toEqual(expect.any(Array));
    expect(getAbi('ReservePSM')).toEqual(expect.any(Array));
  });

  it('rejects an unknown contract name at runtime', () => {
    expect(() => getAbi('MissingContract' as never)).toThrow('No ABI found');
  });

  it('rejects inherited object property names at runtime', () => {
    expect(() => getAbi('toString' as never)).toThrow('No ABI found');
  });
});
