import { useState } from 'react';
import { getAddress } from 'ethers';
import { useNavigate } from 'react-router-dom';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';

const OBJECT_TYPES = Object.freeze({
  vault: { label: 'Vault', param: 'vault', roles: ['vault-owner', 'curator', 'guardian', 'allocator', 'settlement-operator', 'keeper', 'nav-signer'] },
  asset: { label: 'Asset', param: 'assetId', roles: ['asset-owner', 'token-agent', 'proof-publisher', 'wrapper-controller', 'psm-authorized-signer'] },
  adapter: { label: 'Adapter', param: 'adapter', roles: ['adapter-data-provider'] },
});

function isAssetId(value) {
  return /^[1-9]\d*$/.test(value);
}

export default function ObjectSelector() {
  const [type, setType] = useState('vault');
  const [value, setValue] = useState('');
  const [roleId, setRoleId] = useState('vault-owner');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const object = OBJECT_TYPES[type];
  const fieldLabel = type === 'asset' ? 'Asset ID' : `${object.label} address`;

  const chooseType = (nextType) => {
    setType(nextType);
    setRoleId(OBJECT_TYPES[nextType].roles[0]);
    setValue('');
    setError('');
  };

  const openWorkspace = (event) => {
    event.preventDefault();
    let selected = value.trim();
    if (type === 'asset') {
      if (!isAssetId(selected)) {
        setError('Enter a positive integer');
        return;
      }
    } else {
      try { selected = getAddress(selected); } catch {
        setError('Enter a valid EVM address');
        return;
      }
    }
    setError('');
    const path = ROLE_DEFINITIONS[roleId].path.replace(`:${object.param}`, selected);
    navigate(path);
  };

  return (
    <form className="ws-selector" onSubmit={openWorkspace} noValidate>
      <fieldset>
        <legend>Object type</legend>
        <div className="ws-selector__types" role="group" aria-label="Object type">
          {Object.entries(OBJECT_TYPES).map(([id, option]) => (
            <button key={id} type="button" aria-pressed={type === id} onClick={() => chooseType(id)}>{option.label}</button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>{fieldLabel}</span>
        <input value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'workspace-object-error' : undefined} />
      </label>
      <label>
        <span>Role</span>
        <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          {object.roles.map((id) => <option key={id} value={id}>{ROLE_DEFINITIONS[id].id}</option>)}
        </select>
      </label>
      {error && <p id="workspace-object-error" className="ws-selector__error" role="alert">{error}</p>}
      <button type="submit" className="ws-selector__submit">Open workspace</button>
    </form>
  );
}
