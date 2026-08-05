import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import App from '../App';

const roles = [
  ['/workspaces/governor', 'Governor'],
  ['/workspaces/vault-owner/0x1111111111111111111111111111111111111111', 'Vault Owner'],
  ['/workspaces/curator/0x1111111111111111111111111111111111111111', 'Curator'],
  ['/workspaces/guardian/0x1111111111111111111111111111111111111111', 'Guardian'],
  ['/workspaces/allocator/0x1111111111111111111111111111111111111111', 'Allocator'],
  ['/workspaces/settlement-operator/0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea', 'Settlement Operator'],
  ['/workspaces/keeper/0x1111111111111111111111111111111111111111', 'Keeper'],
  ['/workspaces/asset-owner/7', 'Asset Owner / Issuer'],
  ['/workspaces/token-agent/7', 'Token Agent'],
  ['/workspaces/proof-publisher/7', 'Proof Publisher'],
  ['/workspaces/wrapper-controller/7', 'Wrapper Controller'],
  ['/workspaces/nav-signer/0x1111111111111111111111111111111111111111', 'NAV Signer'],
  ['/workspaces/adapter-data-provider/0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4', 'Adapter Data Provider'],
  ['/workspaces/psm-authorized-signer/7', 'PSM Authorized Signer'],
  ['/workspaces/relayer', 'Relayer'],
];

const parameterizedRoles = roles.filter(([path]) => path.split('/').length === 4);

function renderRoute(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
  localStorage.clear();
});

describe('workspace routes', () => {
  it('renders the object selector at the workspace index', () => {
    renderRoute('/workspaces');

    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByLabelText('Object type')).toBeInTheDocument();
  });

  it.each(roles)('resolves %s to the localized %s role workspace', (path, title) => {
    renderRoute(path);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it.each(parameterizedRoles)('uses a valid object fixture for %s', (path) => {
    renderRoute(path);

    expect(screen.queryByText(/^Invalid (vault|asset|adapter) route\./i)).not.toBeInTheDocument();
  });

  it.each(parameterizedRoles)('marks only the matching %s sidebar role current', (path, title) => {
    renderRoute(path);

    const navigation = screen.getByRole('navigation', { name: 'Workspace roles' });
    const current = within(navigation).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(title);
  });

  it.each([
    ['/workspaces/vault-owner', 'a vault route without a vault parameter'],
    ['/workspaces/asset-owner', 'an asset route without an assetId'],
    ['/workspaces/not-a-role', 'an unknown workspace route'],
  ])('renders the workspace not-found page for %s', (path) => {
    renderRoute(path);

    expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('keeps public marketing routes available outside the workspace shell', () => {
    renderRoute('/products');

    expect(screen.getByRole('heading', { name: 'HyperTessera Earn 产品矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});
