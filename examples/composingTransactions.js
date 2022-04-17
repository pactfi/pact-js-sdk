const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2();
  const pact = new pactsdk.PactClient(algod);

  // Let's do a swap and optin in a single transaction group.

  const pool = await pact.fetchPoolById(85767720);

  const swap = pool.prepareSwap({
    asset: pool.primaryAsset,
    amount: 100_000,
    slippagePct: 2,
  });

  const suggestedParams = await algod.getTransactionParams().do();
  const optInTx = pool.secondaryAsset.buildOptInTx(account.addr, suggestedParams);
  const txs = [
    optInTx,
    ...pool.buildSwapTxs({swap, address: account.addr, suggestedParams}),
  ];
  const group = new pactsdk.TransactionGroup(txs);

  const signedTx = group.signTxn(account.sk)
  await algod.sendRawTransaction(signedTx).do();

  console.log(`Transaction ${group.groupId}`);
})();
