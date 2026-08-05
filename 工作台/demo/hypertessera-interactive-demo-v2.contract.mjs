import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(currentDir, 'hypertessera-interactive-demo-v2.html');

async function source() {
  return readFile(htmlPath, 'utf8');
}

test('standalone demo exposes every required route', async () => {
  const html = await source();
  const routes = ['#/home','#/products','#/access','#/issuance','#/vaults','#/workspace/','#/vault-listing/','#/ops/login','#/ops/dashboard','#/ops/reviews','#/ops/listings','#/ops/history'];
  routes.forEach((route) => assert.match(html, new RegExp(route.replaceAll('/', '\\/'))));
});

test('standalone demo includes the complete role catalogue', async () => {
  const html = await source();
  const roles = ['governor','vault-owner','curator','guardian','allocator','settlement-operator','keeper','asset-owner','token-agent','proof-publisher','wrapper-controller','nav-signer','adapter-data-provider','psm-authorized-signer','relayer'];
  roles.forEach((role) => assert.match(html, new RegExp(`['\"]${role}['\"]`)));
});

test('standalone demo keeps ops authentication independent from wallet state', async () => {
  const html = await source();
  assert.match(html, /reviewer@hypertessera\.demo/);
  assert.match(html, /Demo2026!/);
  assert.match(html, /opsSession/);
  assert.match(html, /walletSession/);
  assert.doesNotMatch(html, /opsSession\s*=\s*walletSession/);
});

test('standalone demo persists state and exposes core render functions', async () => {
  const html = await source();
  assert.match(html, /hypertessera_interactive_demo_v2/);
  assert.match(html, /localStorage\.getItem/);
  assert.match(html, /localStorage\.setItem/);
  ['renderApp','renderProducts','renderAccess','renderWorkspace','renderOpsLogin','renderReviewDetail'].forEach((name) => assert.match(html, new RegExp(`function ${name}\\(`)));
});

test('standalone demo declares UTF-8 and responsive behavior', async () => {
  const html = await source();
  assert.match(html, /<meta charset="UTF-8">/i);
  assert.match(html, /name="viewport"/i);
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
  assert.match(html, /data-mobile-nav/);
  assert.doesNotMatch(html, /\uFFFD/);
});

test('modal backdrop does not swallow clicks on controls inside the modal', async () => {
  const html = await source();
  assert.doesNotMatch(html, /closest\('\[data-close-modal\]'\)/);
  assert.match(html, /target\.matches\('\[data-close-modal\]'\)/);
});
