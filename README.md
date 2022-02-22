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
const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});
```

Fetching a pool.

```js
const algo = await pact.fetchAsset(0);
const otherCoin = await pact.fetchAsset(8949213);

const pool = await pact.fetchPool(algo, otherCoin); // The pool will be fetched regardless of assets order.
```

Fetching a pool also accepts optional parameters.

```js
const pool = await pact.fetchPool(algo, otherCoin, {
  appId: 456321, // Use if the pool is not visible in the Pact API.
  feeBps: 30, // Use if your custom contract uses non-default fee.
});
```

You can list all pools from the Pact API.

```js
const pools = await pact.listPools();
console.log(pools);
// {
//   "count":19,
//   "next":"http://api.pact.fi/api/pools?page=2",
//   "previous":null,
//   "results": [...],
// }

// The listing uses pagination and filtering. Look at typings for details.
const pools = await pact.listPools({page: 2, primary_asset__algoid: 9843123});
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
const addLiqTx = await pool.prepareAddLiquidityTx({
  address: account.addr,
  primaryAssetAmount: 100_000,
  secondaryAssetAmount: 50_000,
});
const signedAddLiqTx = addLiqTx.signTxn(account.sk);
const sentAddLiqTx = await algod.sendRawTransaction(signedAddLiqTx).do();
await algosdk.waitForConfirmation(algod, sentAddLiqTx.txId, 2);

// Remove liquidity.
const removeLiqTx = await pool.prepareRemoveLiquidityTx({
  address: account.addr,
  amount: 100_000,
});
const signedRemoveLiqTx = removeLiqTx.signTxn(account.sk);
const sentRemoveLiqtx = await algod.sendRawTransaction(signedRemoveLiqTx).do();
await algosdk.waitForConfirmation(algod, sentRemoveLiqtx.txId, 2);
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
//   amountOut: 200000,
//   amountIn: 146529,
//   minimumAmountIn: 143598,
//   price: 0.73485,
//   primaryAssetPriceAfterSwap: 0.6081680080300244,
//   secondaryAssetPriceAfterSwap: 1.6442824791774173,
//   primaryAssetPriceChangePct: -31.549580645715963,
//   secondaryAssetPriceChangePct: 46.091142966447585,
//   fee: 441
// }

// Let's submit the swap.
const swapTx = await swap.prepareTx(account.addr);
const signedTxs = swapTx.signTxn(account.sk)
const tx = await algod.sendRawTransaction(signedTxs).do();
await algosdk.waitForConfirmation(algod, tx.txId, 2);
```

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
