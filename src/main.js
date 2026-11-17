// CryptoidPad — read-only launchpad explorer for GIWA Sepolia.
// Built with @ammora-protocol/sdk 0.3.9 + viem. No wallet, no signature,
// no transaction: every value below is a read against the public GIWA RPC.
import { createPublicClient, formatUnits, http, parseUnits } from 'viem';
import {
  AmmoraRouteClient,
  getAmmoraV4ConfigAtBlock,
  getAmmoraV4NextConfigId,
  giwaSepoliaAutoRouteCatalog,
  giwaSepoliaAutoRouteDeployment,
  giwaSepoliaAutoRouteDeploymentCatalog,
  resolveAmmoraFinalizedHead,
  verifyAmmoraV4CoreAtBlock,
} from '@ammora-protocol/sdk';

const RPC_URL = 'https://sepolia-rpc.giwa.io';
const CHAIN_ID = 91342;
const WETH = '0x4200000000000000000000000000000000000006'; // wrapped native, 18 dec
const TAMM = '0x10B3Cc2fc981277Ada576891CF649D0ABA768B06'; // tAMM, 6 dec
const MIGRATION_MODE = { 0: 'Concentrated', 1: 'Compounding' };

const $ = (id) => document.getElementById(id);
const short = (addr) => (addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—');
const errText = (e) => (e && e.shortMessage) || (e && e.message) || String(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The public GIWA RPC rate-limits bursts (HTTP 429), so the transport retries
// with backoff and the config loader stays at low concurrency.
const client = createPublicClient({
  transport: http(RPC_URL, { retryCount: 3, retryDelay: 1000, timeout: 30_000 }),
});
const deployment = giwaSepoliaAutoRouteDeployment;
const registry = deployment.contracts.launch.configRegistry;

const snapshots = new Map(); // configId (string) -> snapshot
let headBlock = null;

// ---------- Deployment panel (from the SDK catalog, no RPC needed) ----------
function renderDeployment() {
  const c = deployment.contracts;
  $('deployStatus').textContent =
    'Deployment slot ' + deployment.slot + ' · ' + deployment.environment +
    ' · source commit ' + deployment.sourceCommit.slice(0, 12) + '.';
  const rows = [
    ['Chain', deployment.chain.name + ' (id ' + deployment.chain.id + ')'],
    ['Deployment slot', deployment.slot],
    ['Start block', deployment.startBlock.toString()],
    ['ConfigRegistry', registry],
    ['LaunchFactory', c.launch.factory],
    ['GraduationAdapter', c.launch.graduationAdapter],
    ['FeePolicy', c.launch.feePolicy],
    ['Concentrated factory', c.launch.concentratedFactory],
    ['Wrapped native (WETH)', c.tokens.wrappedNative],
    ['RPC', deployment.chain.rpcUrls.join(', ')],
    ['Explorer', deployment.chain.blockExplorerUrl],
  ];
  $('deployKv').innerHTML = rows
    .map(([k, v]) => '<dt>' + k + '</dt><dd class="mono">' + v + '</dd>')
    .join('');
}

// ---------- Config explorer ----------
function renderRow(snap) {
  const cfg = snap.config;
  const tr = document.createElement('tr');
  tr.dataset.configId = snap.configId.toString();
  tr.innerHTML =
    '<td class="num">' + snap.configId + '</td>' +
    '<td>' + (snap.enabled ? '<span class="ok">enabled</span>' : '<span class="warn">disabled</span>') + '</td>' +
    '<td class="mono">' + short(snap.identity.owner) + '</td>' +
    '<td class="mono">' + short(cfg.quoteToken) + '</td>' +
    '<td class="num">' + Number(formatUnits(cfg.totalSupply, cfg.tokenDecimals)).toLocaleString('en-US') + '</td>' +
    '<td class="num">' + cfg.tokenDecimals + '</td>' +
    '<td>' + (MIGRATION_MODE[cfg.migrationMode] ?? ('mode ' + cfg.migrationMode)) + '</td>' +
    '<td class="num">' + snap.segments.length + '</td>';
  tr.addEventListener('click', () => showDetail(snap, tr));
  return tr;
}

function renderTable() {
  const tbody = $('configTable').querySelector('tbody');
  tbody.innerHTML = '';
  const ordered = [...snapshots.values()].sort((a, b) => Number(a.configId - b.configId));
  for (const snap of ordered) tbody.appendChild(renderRow(snap));
}

function showDetail(snap, tr) {
  document.querySelectorAll('#configTable tbody tr').forEach((r) => r.classList.remove('selected'));
  tr.classList.add('selected');
  const cfg = snap.config;
  const lines = [
    'Config #' + snap.configId + (snap.enabled ? ' (enabled)' : ' (disabled)'),
    'configHash: ' + snap.configHash,
    'owner: ' + snap.identity.owner,
    'feeClaimer: ' + snap.identity.feeClaimer,
    'createdAtBlock: ' + snap.identity.createdAtBlock,
    'asOfBlock: ' + snap.asOfBlock,
    '--- config ---',
    'quoteToken: ' + cfg.quoteToken,
    'partnerRecipient: ' + cfg.partnerRecipient,
    'totalSupply: ' + formatUnits(cfg.totalSupply, cfg.tokenDecimals) + ' (decimals ' + cfg.tokenDecimals + ')',
    'poolCreationFee: ' + cfg.poolCreationFee,
    'startSqrtPrice: ' + cfg.startSqrtPrice,
    'cliffFeeBps: ' + cfg.cliffFeeBps,
    'creatorShareOfNonProtocolBps: ' + cfg.creatorShareOfNonProtocolBps,
    'feeSchedulerMode: ' + cfg.feeSchedulerMode + ' · periods: ' + cfg.feeNumberOfPeriods +
      ' · frequency: ' + cfg.feePeriodFrequency + ' · reductionFactorBps: ' + cfg.feeReductionFactorBps,
    'rateLimiter: ' + (cfg.rateLimiterEnabled ? 'enabled' : 'disabled'),
    'dynamicFee: ' + (cfg.dynamicFeeEnabled ? 'enabled' : 'disabled'),
    'collectFeeMode: ' + cfg.collectFeeMode,
    'migrationMode: ' + (MIGRATION_MODE[cfg.migrationMode] ?? cfg.migrationMode),
    'migrationQuoteThreshold: ' + formatUnits(cfg.migrationQuoteThreshold, 18) + ' WETH',
    'migrationBaseThreshold: ' + cfg.migrationBaseThreshold,
    'postMigrationFeeBps: ' + cfg.postMigrationFeeBps,
    'postMigrationLiquidity: ' + cfg.postMigrationLiquidity,
    '--- segments (' + snap.segments.length + ') ---',
  ];
  snap.segments.forEach((s, i) => {
    lines.push(
      '#' + i + ' lowerSqrtPrice: ' + s.lowerSqrtPrice +
      ' · upperSqrtPrice: ' + s.upperSqrtPrice +
      ' · liquidity: ' + s.liquidity,
    );
  });
  $('detailHint').textContent = 'Config #' + snap.configId + ' — full parameters as stored on-chain.';
  $('detail').textContent = lines.join('\n');
}

async function loadConfigs() {
  const nextId = await getAmmoraV4NextConfigId(client, registry, headBlock);
  const total = Number(nextId) - 1; // IDs start at 1; nextConfigId is the exclusive bound
  $('configStatus').textContent = 'Registry holds ' + total + ' launch configs (IDs 1–' + total + '). Loading…';
  const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1));
  let loaded = 0;
  let failed = 0;
  // Each config snapshot is 7 parallel contract reads; keep concurrency low
  // and retry with backoff so the public RPC's rate limit (HTTP 429) does
  // not kill the load.
  const CONCURRENCY = 2;
  let cursor = 0;
  async function loadOne(id) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await getAmmoraV4ConfigAtBlock(client, registry, id, headBlock);
      } catch (e) {
        if (attempt === 4) throw e;
        await sleep(1000 * 2 ** attempt + Math.random() * 500);
      }
    }
  }
  async function worker(startDelay) {
    await sleep(startDelay);
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const snap = await loadOne(id);
        snapshots.set(id.toString(), snap);
        loaded++;
      } catch (e) {
        failed++;
        console.warn('config', id.toString(), 'failed:', e);
      }
      $('configStatus').textContent =
        'Loaded ' + loaded + ' / ' + total + ' configs' + (failed ? ' (' + failed + ' failed)' : '') + '…';
      renderTable();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i * 300)));
  $('configStatus').textContent =
    'Loaded ' + loaded + ' / ' + total + ' configs from the ConfigRegistry at finalized block ' +
    headBlock + (failed ? ' (' + failed + ' failed to load)' : '') + '. Click a row for full parameters.';
}

// ---------- Boot: finalized head -> core verification -> configs ----------
async function boot() {
  renderDeployment();
  try {
    headBlock = await resolveAmmoraFinalizedHead([client], { kind: 'finalized' });
    $('quoteBtn').disabled = false; // route client needs the finalized head
    $('verifyStatus').innerHTML =
      'Finalized head: <b class="mono">' + headBlock + '</b>. Verifying the V4 core contracts…';
    const verified = await verifyAmmoraV4CoreAtBlock(client, {
      configRegistry: registry,
      launchFactory: deployment.contracts.launch.factory,
      graduationAdapter: deployment.contracts.launch.graduationAdapter,
      feePolicy: deployment.contracts.launch.feePolicy,
    }, headBlock);
    $('verifyStatus').innerHTML =
      '<span class="ok">Core contracts verified against the finalized head.</span>';
    $('verifyKv').innerHTML =
      '<dt>Verified at block</dt><dd class="mono">' + verified.asOfBlock + '</dd>' +
      '<dt>ConfigRegistry</dt><dd class="mono">' + verified.addresses.configRegistry + '</dd>' +
      '<dt>LaunchFactory</dt><dd class="mono">' + verified.addresses.launchFactory + '</dd>' +
      '<dt>GraduationAdapter</dt><dd class="mono">' + verified.addresses.graduationAdapter + '</dd>' +
      '<dt>FeePolicy</dt><dd class="mono">' + verified.addresses.feePolicy + '</dd>';
  } catch (e) {
    $('verifyStatus').innerHTML = '<span class="err">Core verification failed: ' + errText(e) + '</span>';
    $('configStatus').textContent = 'Config loading skipped: the finalized head could not be resolved.';
    return;
  }
  try {
    await loadConfigs();
  } catch (e) {
    $('configStatus').innerHTML = '<span class="err">Failed to load configs: ' + errText(e) + '</span>';
  }
}

// ---------- Swap quote widget (read-only) ----------
// Quotable tokens, verified live on GIWA Sepolia (17 Nov 2026):
// the three Ammora canary launches still trade on their DBC curves, so the
// route client can quote them from the pools below (supplied via the SDK's
// `pools` option — the supported way to hand an app-known pool inventory to
// the client, no log scan needed). tAMM is listed too, but it has NO reviewed
// route through AmmoraRouteClient: quoting it fails with
// ARLORA_CONTRACT_UNSUPPORTED_TOKEN ("input or output token requires
// aggregation policy review"), even after a full pool discovery. That is a
// property of the token's policy status, not of this app.
const QUOTE_TOKENS = [
  { symbol: 'AIV4C', name: 'Ammora Isolated V4 Canary (config #1)', address: '0xc23220d34534aE3C8bbe231dB911b7E662743B6e', decimals: 9,
    pool: { model: 'dbc', pool: '0x2C4e147617Ca14502c438a35a370680494E8BD7B', baseToken: '0xc23220d34534aE3C8bbe231dB911b7E662743B6e', quoteToken: WETH } },
  { symbol: 'AISDK', name: 'Ammora SDK Isolated Canary', address: '0x43613EF621526E6fC4C6b079B40C8f49Df9e440C', decimals: 9,
    pool: { model: 'dbc', pool: '0x6D2cE5c47443330ECD3eB7c9d0f6c18FbC39C7D7', baseToken: '0x43613EF621526E6fC4C6b079B40C8f49Df9e440C', quoteToken: WETH } },
  { symbol: 'AUAUTO', name: 'Ammora Unattended Registration Canary', address: '0x755B4b2172F7Ae54Ff010fdD5cdf112F843d448e', decimals: 9,
    pool: { model: 'dbc', pool: '0xF3746A666E464a65996e4C037bAb95Ca36E94D4A', baseToken: '0x755B4b2172F7Ae54Ff010fdD5cdf112F843d448e', quoteToken: WETH } },
  { symbol: 'tAMM', name: 'tAMM (no reviewed route — see note below)', address: TAMM, decimals: 6, pool: null },
];

function renderQuoteTokens() {
  const sel = $('quoteToken');
  sel.innerHTML = '';
  for (const t of QUOTE_TOKENS) {
    const opt = document.createElement('option');
    opt.value = t.address;
    opt.textContent = t.symbol + ' — ' + t.name;
    sel.appendChild(opt);
  }
}

let routeClientPromise = null;
function getRouteClient() {
  if (!routeClientPromise) {
    routeClientPromise = AmmoraRouteClient.create({
      client,
      routeCatalog: giwaSepoliaAutoRouteCatalog,
      deploymentCatalog: giwaSepoliaAutoRouteDeploymentCatalog,
      pools: QUOTE_TOKENS.filter((t) => t.pool).map((t) => t.pool),
      verificationBlock: headBlock,
    });
  }
  return routeClientPromise;
}

async function getQuote() {
  const btn = $('quoteBtn');
  const amountStr = $('quoteAmount').value.trim();
  const out = $('quoteOut');
  if (headBlock === null) {
    out.innerHTML = '<p class="dim">Still resolving the finalized head — please wait a moment and try again.</p>';
    return;
  }
  const token = QUOTE_TOKENS.find((t) => t.address === $('quoteToken').value) || QUOTE_TOKENS[0];
  let amountIn;
  try {
    amountIn = parseUnits(amountStr, 18);
    if (amountIn <= 0n) throw new Error('amount must be > 0');
  } catch {
    out.innerHTML = '<p class="err">Enter a valid WETH amount greater than 0.</p>';
    return;
  }
  btn.disabled = true;
  out.innerHTML = '<p class="dim">Requesting a live quote (read-only)…</p>';
  try {
    const routes = await getRouteClient();
    const quote = await routes.quoteExactIn({
      tokenIn: WETH, tokenOut: token.address, amountIn, slippageBps: 100,
    });
    const rate = Number(formatUnits(quote.expectedAmountOut, token.decimals)) / Number(formatUnits(amountIn, 18));
    out.innerHTML =
      '<dl class="kv">' +
      '<dt>You pay</dt><dd class="mono">' + formatUnits(amountIn, 18) + ' WETH</dd>' +
      '<dt>You receive (expected)</dt><dd class="mono">' + formatUnits(quote.expectedAmountOut, token.decimals) + ' ' + token.symbol + '</dd>' +
      '<dt>Minimum out (1% slippage)</dt><dd class="mono">' + formatUnits(quote.minimumAmountOut, token.decimals) + ' ' + token.symbol + '</dd>' +
      '<dt>Implied rate</dt><dd class="mono">1 WETH ≈ ' + rate.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + token.symbol + '</dd>' +
      '<dt>Price impact</dt><dd class="mono">' + (quote.priceImpactBps === null ? 'n/a' : (Number(quote.priceImpactBps) / 100).toFixed(2) + '%') + '</dd>' +
      '<dt>Provider</dt><dd class="mono">' + quote.providerId + ' · ' + quote.hops.length + ' hop(s)</dd>' +
      '<dt>Quote block</dt><dd class="mono">' + quote.quoteBlockNumber + '</dd>' +
      '</dl>' +
      '<p class="dim">Quote only. No swap was prepared or executed and no wallet is connected.</p>';
  } catch (e) {
    const note = token.symbol === 'tAMM'
      ? '<p class="dim">tAMM has no reviewed route through the Ammora route client: the SDK refuses it with “input or output token requires aggregation policy review” (ARLORA_CONTRACT_UNSUPPORTED_TOKEN), even after a full pool discovery. The canary tokens above do have live quotes.</p>'
      : '<p class="dim">This is a read-only quote. Try again later; the route may simply have no reviewed liquidity for this pair at the moment.</p>';
    out.innerHTML = '<p class="err">No live quote available right now: ' + errText(e) + '</p>' + note;
  } finally {
    btn.disabled = false;
  }
}

renderQuoteTokens();
$('quoteBtn').addEventListener('click', getQuote);
boot();
