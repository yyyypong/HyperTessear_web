# hyperTessera — W1 Control Console

A zero-build, role-based wallet console for exercising the Week 1 contracts. Single static page
(`index.html`) using ethers.js (CDN) + MetaMask. No npm, no build step.

The panel reads two files loaded as plain `<script>`s, so it runs straight from `file://`:
- **`abis.js`** — contract ABIs (committed; stable, regenerate only if a contract ABI changes).
- **`config.js`** — deployed addresses + role assignments for the active environment.

## Simplest path — a deployed (e.g. testnet) instance

If `config.js` is already committed for a deployment, there is **nothing to run**:

> **Just open `control-panel/index.html` in a browser, connect MetaMask to the right network, done.**

(If MetaMask doesn't inject into `file://` pages on your setup, either enable "Allow access to file
URLs" for the extension, or serve the folder: `python3 -m http.server 8777`.)

To produce/refresh `config.js` for a testnet deployment, deploy once and commit it:

```bash
PRIVATE_KEY=0x... forge script script/Deploy.s.sol --tc Deploy --rpc-url <bnb-testnet-rpc> --broadcast
git add control-panel/config.js && git commit -m "panel: BNB testnet addresses"
```

On a non-Anvil chain the deploy does **not** auto-grant demo roles — the deployer (GOVERNOR) grants
them from the console's HyperAccessControl panel. Point MetaMask at chainId 97.

## Local Anvil (full local loop)

```bash
anvil                                                                          # chain 31337
forge script script/Deploy.s.sol --tc Deploy --rpc-url http://localhost:8545 --broadcast   # writes config.js
./control-panel/build-abis.sh                                                  # writes abis.js
open control-panel/index.html        # (or: cd control-panel && python3 -m http.server 8777)
```

In MetaMask: add network **localhost:8545 / chainId 31337**, then import an Anvil private key
(printed when `anvil` starts). The deploy script pre-assigns roles to the standard Anvil accounts:

| Account # | Role | Use it to test |
|---|---|---|
| 0 | GOVERNOR | grant/revoke roles, register assets, NAV signer admin, timelock cancel/setDelay, unpause |
| 1 | CURATOR | `setNavTolerance`, schedule timelock changes |
| 2 | GUARDIAN | `pauseModule` (demo the emergency pause) |
| 3 | ISSUER | `initiateMint` / `initiateBurn` |
| 4 | TOKEN_AGENT | `approveMint` / `approveBurn` |
| 5 | NAV signer | `updateNAV` for the demo vault |

Switch the active MetaMask account to act as a different role. The console auto-detects and badges
the connected account's roles; actions you lack the role for are still clickable (they'll revert,
which is useful for negative testing).

Switch the active MetaMask account to act as a different role.

## Single-file hosting (pagedrop / GitHub Pages / S3 / IPFS)

To get **one** HTML file you can drop on any static host and have it just work — ABIs, deployment
config, and ethers.js all inlined, zero other files:

```bash
# after deploying (config.js) and ./build-abis.sh (abis.js):
./control-panel/bundle.sh        # writes control-panel/standalone.html (one self-contained file)
```

Upload `standalone.html` and open it; connect MetaMask to the deployment's network. The only
external resource is the Google Fonts stylesheet (cosmetic — falls back to monospace if blocked).
Regenerate it whenever `config.js` or the ABIs change. `standalone.html` is git-ignored (it's a
large, environment-specific build artifact).

## Files
- `index.html` — the console (self-contained; loads `abis.js` + `config.js`, falls back to `fetch`).
- `bundle.sh` — inlines abis + config + ethers into a single `standalone.html` for static hosting.
- `config.js` — `window.HT_DEPLOYMENTS = {…}` (addresses + roles). Written by `forge script Deploy`; **commit it** for a shared/testnet instance.
- `abis.js` / `abis.json` — contract ABIs. Written by `build-abis.sh`; committed.
- `build-abis.sh` — regenerates `abis.js` + `abis.json` from `out/` (run after `forge build`).
- `deployments.json` — JSON twin of `config.js` for tooling (git-ignored).
