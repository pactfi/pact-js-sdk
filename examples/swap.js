const { default: algosdk } = require('algosdk');
const pact = require('../dist/pactifysdk.cjs');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const client = new pact.Client({
    algod: new algosdk.Algodv2(), // provide options
  })

  const algo = await client.fetchAsset(0)
  const jamnik = await client.fetchAsset(41409282)

  // Opt-in for jamnik
  const optInTxn = await jamnik.prepareOptInTx(account.addr);
  sentOptInTxn = await client.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(client.algod, sentOptInTxn.txId, 2);

  const pool = await client.fetchPool(algo, jamnik);

  const txGroup = await pool.prepareSwapTx({
    address: account.addr,
    asset: algo,
    amount: 100_000,
    slippagePct: 2,
  });
  const signedTxs = txGroup.signWithPrivateKey(account.sk)
  const tx = await client.algod.sendRawTransaction(signedTxs).do();

  console.log(`Transaction ${tx.txId}`);
})();
