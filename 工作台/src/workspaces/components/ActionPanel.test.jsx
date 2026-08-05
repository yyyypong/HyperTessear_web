import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../i18n';
import { FORM_SCHEMAS } from '../config/formSchemas';
import ActionPanel from './ActionPanel';

const address = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const available = { state: 'available' };
const action = { id: 'vault.pause', title: 'Pause vault', description: 'Pause a selected vault.', capability: { legacy: { badge: 'legacyCompatible' } } };

function renderPanel(overrides = {}) {
  return render(
    <LocaleProvider>
      <ActionPanel action={action} capability={available} onExecute={vi.fn()} {...overrides} />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => localStorage.setItem('hyt.locale', 'en'));

describe('ActionPanel', () => {
  it('enables an available action and sends raw field strings only through its injected executor', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    renderPanel({ action: { ...action, id: 'protocol.modules.pause' }, schema: FORM_SCHEMAS['protocol.modules.pause'], onExecute });

    expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Module'), '4');
    await userEvent.selectOptions(screen.getByLabelText('Paused'), 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Execute action' }));

    expect(onExecute).toHaveBeenCalledWith('protocol.modules.pause', { module: '4', paused: 'true' });
  });

  it('labels a reviewed built-in signature action as payload signing, not execution', () => {
    renderPanel({ action: { ...action, id: 'nav.sign' }, schema: FORM_SCHEMAS['nav.sign'] });

    expect(screen.getByRole('button', { name: 'Sign payload' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /execute|transaction/i })).not.toBeInTheDocument();
  });

  it('reports an offline signature as signed rather than submitted', async () => {
    renderPanel({ action: { ...action, id: 'nav.sign' }, schema: { id: 'nav.sign', fields: [] }, onExecute: vi.fn().mockResolvedValue({ signature: '0xsigned' }) });

    await userEvent.click(screen.getByRole('button', { name: 'Sign payload' }));
    expect(screen.getByText('Payload signed.')).toBeInTheDocument();
    expect(screen.queryByText('Action submitted.')).not.toBeInTheDocument();
  });

  it('disables a target-only action and names the missing method and module', () => {
    renderPanel({ capability: { state: 'targetOnly', detail: { requiredMethod: 'setVaultFees', requiredModule: 'VaultFeeController' } } });

    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
    expect(screen.getByText(/setVaultFees/)).toBeInTheDocument();
    expect(screen.getByText(/VaultFeeController/)).toBeInTheDocument();
  });

  it('shows the connected address when authorization is missing', () => {
    renderPanel({ capability: { state: 'unauthorized', detail: { address } } });

    expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
  });

  it('offers only the injected switch control on the wrong network', async () => {
    const onSwitchNetwork = vi.fn();
    renderPanel({ capability: { state: 'wrongNetwork' }, onSwitchNetwork });

    await userEvent.click(screen.getByRole('button', { name: 'Switch network' }));
    expect(onSwitchNetwork).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
  });

  it('never calls the executor from a disabled panel', () => {
    const onExecute = vi.fn();
    renderPanel({ capability: { state: 'paused' }, onExecute });

    fireEvent.submit(screen.getByRole('button', { name: 'Execute action' }).closest('form'));
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('fails closed for a dangerous action until the final four target characters are typed', async () => {
    const onExecute = vi.fn();
    renderPanel({
      action: { ...action, id: 'psm.protocol.pause' },
      schema: FORM_SCHEMAS['psm.protocol.pause'],
      onExecute,
      dangerous: true,
      targetAddress: address,
      preview: { functionName: 'pause', params: '[]', network: 'BNB Smart Chain Testnet' },
    });

    expect(screen.getByText(/Type the final four characters/i)).toBeInTheDocument();
    expect(screen.getAllByText(/F6C9/).length).toBeGreaterThan(0);
    expect(screen.getByText('pause')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Confirmation'), 'f6c9');
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Confirmation'));
    await userEvent.type(screen.getByLabelText('Confirmation'), 'F6C9');
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Execute action' }));
    expect(onExecute).toHaveBeenCalledWith('psm.protocol.pause', { paused: 'false' });
  });

  it('cannot submit a dangerous action when no canonical target is supplied', () => {
    const onExecute = vi.fn();
    renderPanel({ action: { ...action, id: 'psm.protocol.pause' }, schema: FORM_SCHEMAS['psm.protocol.pause'], onExecute, dangerous: true });

    expect(screen.getByText(/No canonical target address was supplied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Execute action' }).closest('form'));
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('fails closed for a malformed target even when its suffix matches the confirmation', async () => {
    const onExecute = vi.fn();
    renderPanel({ action: { ...action, id: 'psm.protocol.pause' }, schema: FORM_SCHEMAS['psm.protocol.pause'], onExecute, dangerous: true, targetAddress: 'not-an-addressaBcD' });

    expect(screen.getByText(/No canonical target address was supplied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeDisabled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('canonicalizes a valid lowercase target before checking dangerous confirmation', async () => {
    const onExecute = vi.fn();
    renderPanel({ action: { ...action, id: 'psm.protocol.pause' }, schema: FORM_SCHEMAS['psm.protocol.pause'], onExecute, dangerous: true, targetAddress: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9' });

    await userEvent.type(screen.getByLabelText('Confirmation'), 'F6C9');
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Execute action' }));
    expect(onExecute).toHaveBeenCalledWith('psm.protocol.pause', { paused: 'false' });
  });

  it('links representative input errors and focuses the first invalid control', async () => {
    renderPanel({
      action: { ...action, id: 'test.fields' },
      schema: { id: 'test.fields', fields: [
        { name: 'recipient', type: 'address', required: true, labelKey: 'workspaces.forms.fields.account.label', descriptionKey: 'workspaces.forms.fields.account.description' },
        { name: 'payload', type: 'json', required: true, labelKey: 'workspaces.forms.fields.order.label', descriptionKey: 'workspaces.forms.fields.order.description' },
      ] },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Execute action' }));
    const recipient = screen.getByLabelText('Account');
    expect(recipient).toHaveFocus();
    expect(recipient).toHaveAttribute('aria-invalid', 'true');
    expect(recipient.getAttribute('aria-describedby')).toMatch(/recipient-error/);
    const errorId = recipient.getAttribute('aria-describedby').split(' ').find(id => id.endsWith('recipient-error'));
    expect(document.getElementById(errorId)).toHaveTextContent('This field is required.');
  });

  it('renders each supported schema field type with a visible label and description', () => {
    const types = ['address', 'amount', 'bigint', 'integer', 'text', 'bytes', 'bytes32', 'bytes-array', 'datetime', 'json', 'select', 'boolean'];
    const fields = types.map((type, index) => ({
      name: `field${index}`,
      type,
      required: false,
      options: type === 'select' ? ['one'] : undefined,
      labelKey: 'workspaces.forms.fields.account.label',
      descriptionKey: 'workspaces.forms.fields.account.description',
    }));
    renderPanel({ action: { ...action, id: 'all.types' }, schema: { id: 'all.types', fields } });

    for (let index = 0; index < types.length; index += 1) {
      const control = screen.getAllByLabelText('Account')[index];
      expect(control).toHaveAttribute('aria-describedby', expect.stringContaining(`field${index}-description`));
      expect(document.getElementById(control.getAttribute('aria-describedby'))).not.toBeEmptyDOMElement();
    }
  });

  it('scopes field, description and error ids to each action panel on a multi-action page', () => {
    render(
      <LocaleProvider>
        <ActionPanel action={{ ...action, id: 'protocol.modules.pause' }} schema={FORM_SCHEMAS['protocol.modules.pause']} capability={available} onExecute={vi.fn()} />
        <ActionPanel action={{ ...action, id: 'second.modules.pause' }} schema={FORM_SCHEMAS['protocol.modules.pause']} capability={available} onExecute={vi.fn()} />
      </LocaleProvider>,
    );
    const controls = screen.getAllByLabelText('Module');
    expect(controls).toHaveLength(2);
    expect(controls[0].id).not.toBe(controls[1].id);
    expect(controls[0].getAttribute('aria-describedby')).not.toBe(controls[1].getAttribute('aria-describedby'));
    controls.forEach(control => expect(document.getElementById(control.getAttribute('aria-describedby'))).not.toBeEmptyDOMElement());
  });
});
