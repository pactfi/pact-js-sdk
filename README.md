# pact-js-sdk

JavaScript SDK for Pact smart contracts.

# Basic usage

```js
const account = algosdk.mnemonicToSecretKey('<mnemonic>');

const client = new pact.Client({
  algod: new algosdk.Algodv2(...), // provide algod options
})

const algo = await client.fetchAsset(0)
const otherCoin = await client.fetchAsset(...) // provide asset index

// Opt-in for other coin.
const optInTxn = await otherCoin.prepareOptInTx(account.addr);

sentOptInTxn = await client.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
await algosdk.waitForConfirmation(client.algod, sentOptInTxn.txId, 2);

// Fetch pool.
const pool = await client.fetchPool(algo, otherCoin);

// Make a swap.
const txGroup = await pool.prepareSwapTx({
  address: account.addr,
  asset: algo,
  amount: 100_000,
  slippagePct: 2,
});
const signedTxs = txGroup.signWithPrivateKey(account.sk)
const tx = await client.algod.sendRawTransaction(signedTxs).do();

console.log(`Transaction ${tx.txId}`);
```

Look for more [examples](examples).

# Development

Development process requires [Pact contracts V1](https://github.com/pactfi/contracts_v1) to be checked out.

- `git clone git@github.com:pactfi/contracts_v1.git`
- `cd contracts_v1`
- `poetry install`
- `cd ..`

## Running tests

- `npm run test`

## Building

- `npm run build`
