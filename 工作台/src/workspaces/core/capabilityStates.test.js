import { describe, expect, it } from 'vitest';
import { CAPABILITY_STATES, isActionEnabled } from './capabilityStates';

describe('isActionEnabled', () => {
  it('only enables available actions', () => {
    expect(isActionEnabled(CAPABILITY_STATES.AVAILABLE)).toBe(true);
    for (const state of Object.values(CAPABILITY_STATES).filter(value => value !== 'available')) {
      expect(isActionEnabled(state)).toBe(false);
    }
  });
});
