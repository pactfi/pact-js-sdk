/**
 * This example performs a swap on a pool.
 */

import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey('<mnemonic>');

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod, {network: "testnet"});

  const algo = await pact.fetchAsset(0)
  const usdc = await pact.fetchAsset(37074699)
  const pool = await pact.fetchPoolsByAssets(algo, usdc)[0];

  // Opt-in for usdc.
  const optInTxn = await usdc.prepareOptInTx(account.addr);
  sentOptInTxn = await pact.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  await algosdk.waitForConfirmation(pact.algod, sentOptInTxn.txId, 2);
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);

  // Do a swap.
  const swap = pool.prepareSwap({
    asset: algo,
    amount: 100_000,
    slippagePct: 2,
  });
  const swapTxGroup = await swap.prepareTxGroup(account.addr);
  const signedTxs = swapTxGroup.signTxn(account.sk)
  await algod.sendRawTransaction(signedTxs).do();
  console.log(`Swap transaction group ${swapTxGroup.groupId}`);
})();
