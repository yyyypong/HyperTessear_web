import { describe, expect, it } from 'vitest';
import { getDeployment } from './deployments';

describe('getDeployment', () => {
  it('returns the legacy BNB testnet profile', () => {
    const deployment = getDeployment(97);

    expect(deployment.profile).toBe('legacy');
    expect(deployment.addresses.hyperAccessControl).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(deployment.addresses.settlement).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('normalizes numeric chain identifiers', () => {
    expect(getDeployment('97')?.chainId).toBe(97);
  });

  it('prevents mutation of the selected deployment profile', () => {
    const deployment = getDeployment(97);

    expect(() => { deployment.profile = 'target'; }).toThrow(TypeError);
    expect(getDeployment(97).profile).toBe('legacy');
  });

  it('prevents mutation of deployment addresses', () => {
    const deployment = getDeployment(97);

    expect(() => { deployment.addresses.settlement = '0x0000000000000000000000000000000000000000'; }).toThrow(TypeError);
    expect(getDeployment(97).addresses.settlement).toBe('0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c');
  });

  it('returns null for unsupported networks', () => {
    expect(getDeployment(1)).toBeNull();
  });
});
