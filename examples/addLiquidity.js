const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();  // provide options
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const usdc = await pact.fetchAsset(37074699);

  const pools = await pact.fetchPoolsByAssets(algo, usdc);
  const pool = pools[0];

  // Opt-in for liquidity token.
  const optInTxn = await pool.liquidityAsset.prepareOptInTx(account.addr);
  sentOptInTxn = await algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(algod, sentOptInTxn.txId, 2);

  const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
    address: account.addr,
    primaryAssetAmount: 1_000_000,
    secondaryAssetAmount: 500_000,
  });
  const signedTx = addLiqTxGroup.signTxn(account.sk)
  await algod.sendRawTransaction(signedTx).do();

  console.log(`Transaction ${addLiqTxGroup.groupId}`);
})();
