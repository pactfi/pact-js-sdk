const { default: algosdk } = require('algosdk');
const pact = require('../dist/pactsdk.cjs');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();
  const client = new pact.Client(algod);

  const algo = await client.fetchAsset(0)
  const jamnik = await client.fetchAsset(41409282)

  // Opt-in for jamnik
  const optInTxn = await jamnik.prepareOptInTx(account.addr);
  sentOptInTxn = await client.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(client.algod, sentOptInTxn.txId, 2);

  const pool = await client.fetchPool(algo, jamnik);

  const swap = pool.prepareSwap({
    asset: algo,
    amount: 100_000,
    slippagePct: 2,
  });
  const swapTx = await swap.prepareTx(account.addr);
  const signedTxs = swapTx.signTxn(account.sk)
  const sentTx = await client.algod.sendRawTransaction(signedTxs).do();

  console.log(`Transaction ${sentTx.txId}`);
})();
