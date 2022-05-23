const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0)
  const usdc = await pact.fetchAsset(37074699)

  // Opt-in for usdc
  const optInTxn = await usdc.prepareOptInTx(account.addr);
  sentOptInTxn = await pact.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);
  await algosdk.waitForConfirmation(pact.algod, sentOptInTxn.txId, 2);

  const pools = await pact.fetchPoolsByAssets(algo, usdc);

  const swap = pools[0].prepareSwap({
    asset: algo,
    amount: 100_000,
    slippagePct: 2,
  });
  const swapTxGroup = await swap.prepareTxGroup(account.addr);
  const signedTxs = swapTxGroup.signTxn(account.sk)
  await algod.sendRawTransaction(signedTxs).do();

  console.log(`Transaction ${swapTxGroup.groupId}`);
})();
