# Pact JS SDK

JavaScript SDK for Pact smart contracts.

The library is written is Typescript and includes typings. It can be used in NodeJS, as well as in web browsers.

What is covered by the library:

- Fetching pools
- Opt-in for assets
- Managing liquidity
- Inspecting pools state
- Making swaps

Signing and sending transactions is not covered by the library. The provided examples use algosdk directly to send the transactions.

# Installation

`npm install --save @pactfi/pactsdk`

# Basic usage

**CAUTION** - The library uses integers for asset amounts e.g. microalgos instead of algos so if you want to send 1 algo, you need to specify it as 1_000_000.

Create a Pact client.

```js
import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const algod = new algosdk.Algodv2(token, url, port);
const pact = new pactsdk.PactClient(algod);
```

Optionally you can specify custom Pact API url. By default it directs to production API.

```js
const pact = new pactsdk.PactClient(algod, {
  pactApiUrl: "https://api.testnet.pact.fi",
});
```

Fetching pools by assets pair. It uses Pact API to retrieve the pool. Can return multiple pools with differing fee_bps.

```js
const algo = await pact.fetchAsset(0);
const otherCoin = await pact.fetchAsset(37074699);

// The pool will be fetched regardless of assets order.
const pools = await pact.fetchPoolsByAssets(algo, otherCoin);
```

You can fetch a pool by providing assets ids instead of Asset objects.

```js
const pools = await pact.fetchPoolsByAssets(0, 37074699)
```

You can also fetch a pool by providing app id. This way the pool is retrieved directly from the chain.

```js
const pool = await pact.fetchPoolById(85767720);
```

You can list all pools from the Pact API.

```js
const pools = await pact.listPools();
console.log(pools);
// {
//   "count": 19,
//   "offset": 0,
//   "limit": 10,
//   "results": [...],
// }

// The listing uses pagination and filtering. Look at typings for details.
const pools = await pact.listPools({offset: 20, primary_asset__algoid: 37074699});
```

Before making the transactions you need to opt-in for the assets. There's no need to opt-in for algo.

```js
const account = algosdk.mnemonicToSecretKey('<mnemonic>');

async function optIn(asset) {
  let isOptedIn = await asset.isOptedIn(account.addr);
  if (!isOptedIn)) {
    const optInTx = await asset.prepareOptInTx(account.addr);
    const signedTx = optInTx.signTxn(account.sk);
    const sentTx = await algod.sendRawTransaction(signedTx).do();
    await algosdk.waitForConfirmation(algod, sentTx.txId, 2);
  }
}

await optIn(pool.primaryAsset);
await optIn(pool.secondaryAsset);
await optIn(pool.liquidityAsset); // Needed if you want to manage the liquidity.
```

Check the current pool state.

```js
console.log(pool.state);
// {
//   totalLiquidity: 900000,
//   totalPrimary: 956659,
//   totalSecondary: 849972,
//   primaryAssetPrice: 0.8884795940873393,
//   secondaryAssetPrice: 1.1255182523659604,
// }
```

Explicit pool state update is necessary periodically and after each pool operation.

```js
await pool.updateState();
pool.state // Now holds fresh values.
```

Managing the liquidity.

```js
// Add liquidity.
const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
  address: account.addr,
  primaryAssetAmount: 100_000,
  secondaryAssetAmount: 50_000,
});
const signedAddLiqTx = addLiqTxGroup.signTxn(account.sk);
const sentAddLiqTx = await algod.sendRawTransaction(signedAddLiqTx).do();
await algosdk.waitForConfirmation(algod, sentAddLiqTx.txId, 2);

// Remove liquidity.
const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
  address: account.addr,
  amount: 100_000,
});
const signedRemoveLiqTx = removeLiqTxGroup.signTxn(account.sk);
const sentRemoveLiqTx = await algod.sendRawTransaction(signedRemoveLiqTx).do();
await algosdk.waitForConfirmation(algod, sentRemoveLiqTx.txId, 2);
```

Making a swap.

```js
const swap = pool.prepareSwap({
  asset: algo,
  amount: 200_000,
  slippagePct: 2,
});

// You can inspect swap effect before submitting the transaction.
console.log(swap.effect);
// {
//   amountDeposited: 200000,
//   amountReceived: 146529,
//   minimumAmountReceived: 143598,
//   price: 0.73485,
//   primaryAssetPriceAfterSwap: 0.6081680080300244,
//   secondaryAssetPriceAfterSwap: 1.6442824791774173,
//   primaryAssetPriceChangePct: -31.549580645715963,
//   secondaryAssetPriceChangePct: 46.091142966447585,
//   fee: 441
// }

// Let's submit the swap.
const swapTxGroup = await swap.prepareTxGroup(account.addr);
const signedTxs = swapTxGroup.signTxn(account.sk)
const tx = await algod.sendRawTransaction(signedTxs).do();
await algosdk.waitForConfirmation(algod, tx.txId, 2);
```

## Composability of transactions.

The SDK has two sets of methods for creating transactions:

1. `prepare...TxGroup` e.g. `pool.prepareSwapTxGroup`

Those methods are convenience methods which ask algod for suggested transaction parameters, builds transactions and creates a transactions group. You can't add you own transactions to the group using those methods.

2. `build...Txs` e.g. `pool.buildSwapTxs`

Those methods return a list of transactions. You can extend that list with your own transactions and create a `TransactionGroup` manually from this list. See [composingTransactions](examples/composingTransactions.js) example for details.

Look for more [examples](examples).

# Development

- `npm install`

Development requires [Pact testbed](https://github.com/pactfi/algorand-testbed) to be checked out.

- `git clone git@github.com:pactfi/algorand-testbed.git`
- `cd algorand-testbed`
- `poetry install`
- `docker compose up -d`
- `cd ..`

## Running tests

- `npm run test`

## Building

- `npm run build`
- `npm pack`

You can install the package locally with
`sudo npm install -g pactsdk-<version>.tgz`
