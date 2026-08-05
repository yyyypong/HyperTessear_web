import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import '../styles/workspaces.css';

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

function setViewport(width) {
  const listeners = new Set();
  const query = {
    matches: width <= 959,
    media: '(max-width: 959px)',
    addEventListener: (type, listener) => { if (type === 'change') listeners.add(listener); },
    removeEventListener: (type, listener) => { if (type === 'change') listeners.delete(listener); },
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

function renderWorkspace(path = '/workspaces/governor') {
  window.history.pushState({}, '', path);
  return render(<App />);
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
  localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
});

describe('workspace shell', () => {
  it('keeps role navigation and context inside the workspace while hiding the marketing footer', () => {
    renderWorkspace();

    expect(screen.getByRole('navigation', { name: 'Workspace roles' })).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace context')).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('does not navigate when an invalid vault selector is submitted', () => {
    renderWorkspace('/workspaces');

    fireEvent.change(screen.getByLabelText('Vault address'), { target: { value: 'not-an-address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(window.location.pathname).toBe('/workspaces');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid EVM address');
  });

  it('rejects zero because asset identifiers are positive integers', () => {
    renderWorkspace('/workspaces');

    fireEvent.click(screen.getByRole('button', { name: 'Asset' }));
    fireEvent.change(screen.getByLabelText('Asset ID'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(window.location.pathname).toBe('/workspaces');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a positive integer');
  });

  it('applies workspace layout styles only inside the workspace theme boundary', () => {
    window.history.pushState({}, '', '/workspaces');
    render(<><App /><div data-testid="outside-shell" className="ws-shell" /></>);

    expect(getComputedStyle(document.querySelector('.ht-workspaces .ws-shell')).display).toBe('grid');
    expect(getComputedStyle(screen.getByTestId('outside-shell')).display).not.toBe('grid');
  });

  it('removes the closed mobile drawer from the accessibility tree', () => {
    setViewport(959);
    renderWorkspace();

    const sidebar = document.getElementById('workspace-sidebar');
    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    expect(sidebar).toHaveAttribute('inert');
  });

  it('opens the mobile drawer at its close control and restores the trigger after Escape', () => {
    setViewport(959);
    renderWorkspace();

    const trigger = document.querySelector('.ws-menu-button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger);
    expect(document.querySelector('.ws-sidebar__close')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(trigger).toHaveFocus();
    expect(document.getElementById('workspace-sidebar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the persistent desktop sidebar accessible', () => {
    setViewport(960);
    renderWorkspace();

    const sidebar = document.getElementById('workspace-sidebar');
    expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
    expect(sidebar).not.toHaveAttribute('inert');
    expect(screen.getByRole('navigation', { name: 'Workspace roles' })).toBeInTheDocument();
  });

  it('uses 959px as the final mobile width and keeps 960px visually desktop', () => {
    setViewport(959);
    const mobile = renderWorkspace();
    expect(document.querySelector('.ht-workspaces')).toHaveAttribute('data-mobile', 'true');
    expect(document.getElementById('workspace-sidebar')).toHaveAttribute('inert');
    expect(getComputedStyle(document.querySelector('.ws-menu-button')).display).not.toBe('none');
    mobile.unmount();

    setViewport(960);
    renderWorkspace();
    expect(document.querySelector('.ht-workspaces')).toHaveAttribute('data-mobile', 'false');
    expect(document.getElementById('workspace-sidebar')).not.toHaveAttribute('inert');
    expect(getComputedStyle(document.querySelector('.ws-menu-button')).display).toBe('none');
  });
});
