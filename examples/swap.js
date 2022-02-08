const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0)
  const jamnik = await pact.fetchAsset(41409282)

  // Opt-in for jamnik
  const optInTxn = await jamnik.prepareOptInTx(account.addr);
  sentOptInTxn = await pact.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(pact.algod, sentOptInTxn.txId, 2);

  const pool = await pact.fetchPool(algo, jamnik);

  const swap = pool.prepareSwap({
    asset: algo,
    amount: 100_000,
    slippagePct: 2,
  });
  const swapTx = await swap.prepareTx(account.addr);
  const signedTxs = swapTx.signTxn(account.sk)
  const sentTx = await algod.sendRawTransaction(signedTxs).do();

  console.log(`Transaction ${sentTx.txId}`);
})();
