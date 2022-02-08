const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();  // provide options
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const jamnik = await pact.fetchAsset(41409282);

  const pool = await pact.fetchPool(algo, jamnik);

  // Opt-in for liquidity token.
  const optInTxn = await pool.liquidityAsset.prepareOptInTx(account.addr);
  sentOptInTxn = await algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(algod, sentOptInTxn.txId, 2);

  const addLiqTx = await pool.prepareAddLiquidityTx({
    address: account.addr,
    primaryAssetAmount: 1_000_000,
    secondaryAssetAmount: 500_000,
  });
  const signedTx = addLiqTx.signTxn(account.sk)
  const sentTx = await algod.sendRawTransaction(signedTx).do();

  console.log(`Transaction ${sentTx.txId}`);
})();
