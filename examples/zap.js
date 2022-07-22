/**
 * This example performs a zap on a pool.
 */

 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

 const account = algosdk.mnemonicToSecretKey('<mnemonic>');

 (async function() {
   const algod = new algosdk.Algodv2("<token>", "<url>");
   const pact = new pactsdk.PactClient(algod);

   const algo = await pact.fetchAsset(0)
   const usdc = await pact.fetchAsset(37074699)
   const pool = await pact.fetchPoolsByAssets(algo, usdc)[0];

   // Opt-in for usdc.
   const optInTxn = await usdc.prepareOptInTx(account.addr);
   const sentOptInTxn = await pact.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
   await algosdk.waitForConfirmation(pact.algod, sentOptInTxn.txId, 2);
   console.log(`OptIn transaction ${sentOptInTxn.txId}`);

  // Opt-in for liquidity token.
  const plpOptInTxn = await pool.liquidityAsset.prepareOptInTx(account.addr);
  const sentPlpOptInTxn = await algod.sendRawTransaction(plpOptInTxn.signTxn(account.sk)).do();
  await algosdk.waitForConfirmation(algod, sentPlpOptInTxn.txId, 2);
  console.log(`OptIn transaction ${sentPlpOptInTxn.txId}`);

   // Do a zap.
   const zap = pool.prepareZap({
     asset: algo,
     amount: 100_000,
     slippagePct: 2,
   });
   const zapTxGroup = await zap.prepareTxGroup(account.addr);
   const signedTxs = zapTxGroup.signTxn(account.sk)
   await algod.sendRawTransaction(signedTxs).do();
   console.log(`Zap transaction group ${zapTxGroup.groupId}`);
 })();
