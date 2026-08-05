import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../i18n';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import ActionAccordionItem from './ActionAccordionItem';

const action = {
  id: 'vault.pause',
  title: 'Pause vault',
  description: 'Pause a selected vault.',
  capability: { legacy: { badge: 'legacyCompatible' } },
};

function renderItem(overrides = {}) {
  const props = {
    action,
    capability: { state: CAPABILITY_STATES.AVAILABLE },
    open: false,
    onToggle: vi.fn(),
    onExecute: vi.fn(),
    ...overrides,
  };
  return { ...render(<LocaleProvider><ActionAccordionItem {...props} /></LocaleProvider>), props };
}

beforeEach(() => localStorage.setItem('hyt.locale', 'en'));
afterEach(cleanup);

describe('ActionAccordionItem', () => {
  it('shows title and capability badge while hiding the form when closed', () => {
    renderItem({ open: false });
    expect(screen.getByRole('button', { name: /Pause vault/i })).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute action' })).not.toBeInTheDocument();
  });

  it('mounts ActionPanel when open', () => {
    renderItem({ open: true });
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeInTheDocument();
  });

  it('calls onToggle when the summary is clicked', async () => {
    const { props } = renderItem({ open: false });
    await userEvent.click(screen.getByRole('button', { name: /Pause vault/i }));
    expect(props.onToggle).toHaveBeenCalledWith('vault.pause');
  });

  it('marks dangerous actions with a high-risk badge on the summary', () => {
    renderItem({ dangerous: true, open: false });
    expect(screen.getByText('High risk')).toBeInTheDocument();
  });
});
