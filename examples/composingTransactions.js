/**
 * This example performs asset opt-in and a swap in a single atomic group.
*/

import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod);

  const pool = await pact.fetchPoolById(620995314);  // ALGO/USDC

  const suggestedParams = await algod.getTransactionParams().do();

  const optInTx = pool.secondaryAsset.buildOptInTx(account.addr, suggestedParams);

  const swap = pool.prepareSwap({
    asset: pool.primaryAsset,
    amount: 100_000,
    slippagePct: 2,
  });
  const swapTxs = pool.buildSwapTxs({swap, address: account.addr, suggestedParams})

  const txs = [optInTx, ...swapTxs];

  const group = new pactsdk.TransactionGroup(txs);
  const signedGroup = group.signTxn(account.sk)
  await algod.sendRawTransaction(signedGroup).do();

  console.log(`Transaction group ${group.groupId}`);
})();
