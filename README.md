# CryptoidPad

A mini launchpad explorer for **GIWA Sepolia**, built with the **Ammora SDK**
(`@ammora-protocol/sdk` 0.3.9) and [viem](https://viem.sh).

CryptoidPad verifies the live Ammora V4 launch deployment (auto-route generation,
Concentrated Graduation) against the SDK catalog at the finalized chain head,
then reads launch configs straight from the on-chain ConfigRegistry and renders
them as an explorer: status, owner, quote token, total supply, migration mode
and curve segments, with a full parameter view per config. It also shows a
read-only swap quote (WETH → tAMM) from the Ammora route client.

Live data only: every value is read from GIWA Sepolia testnet contracts
(chain 91342, public RPC `https://sepolia-rpc.giwa.io`). CryptoidPad is
read-only — it never asks for a signature and never sends a transaction.

## Features

- Deployment panel rendered from the SDK catalog (`giwaSepoliaAutoRouteDeployment`):
  chain, deployment slot, ConfigRegistry, LaunchFactory, GraduationAdapter, FeePolicy.
- Live core verification with `verifyAmmoraV4CoreAtBlock` at the finalized head
  (`resolveAmmoraFinalizedHead`).
- Launch config explorer using `getAmmoraV4NextConfigId` and
  `getAmmoraV4ConfigAtBlock` against the public GIWA Sepolia RPC.
- Swap quote widget (read-only) using `AmmoraRouteClient.quoteExactIn`
  (WETH → a live Ammora launch token, e.g. the AIV4C canary from config #1).
  Quote only: no swap is prepared or executed, no wallet needed. Note: tAMM
  itself has no reviewed route through the route client — the SDK refuses it
  with `ARLORA_CONTRACT_UNSUPPORTED_TOKEN` ("input or output token requires
  aggregation policy review"), even after a full pool discovery (95 pools,
  ~14 minutes on the public RPC). The widget offers tAMM as a choice and shows
  that refusal honestly instead of pretending a quote exists.

## Files

- `index.html` — the page (styles inline).
- `src/main.js` — the application source, written against the SDK.
- `app.js` — the browser bundle built from `src/main.js` with esbuild.
- `package.json` — dependencies and the build script.

## Run locally

```
npm install
npm run build   # bundles src/main.js into app.js
# then serve the folder with any static server, e.g.
npx serve .
```

## Notes

- All data is read live from GIWA Sepolia testnet contracts; values change as
  new configs are registered.
- Built by [@CryptoidIDN](https://x.com/CryptoidIDN) for the Ammora Season 2
  Builder Mission. Testnet only, not financial advice.
- MIT licensed.
