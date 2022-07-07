/**
 * This example adds liquidity to the pool.
 */

import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey("<mnemonic>");

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const usdc = await pact.fetchAsset(31566704);
  const pool = await pact.fetchPoolsByAssets(algo, usdc)[0];

  // Opt-in for liquidity token.
  const optInTxn = await pool.liquidityAsset.prepareOptInTx(account.addr);
  sentOptInTxn = await algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
  await algosdk.waitForConfirmation(algod, sentOptInTxn.txId, 2);
  console.log(`OptIn transaction ${sentOptInTxn.txId}`);

  // Add liquidity.
  const liquidityAddition = await pool.prepareAddLiquidity({
    primaryAssetAmount: 1_000_000,
    secondaryAssetAmount: 500_000,
  });
  const addLiqTxGroup = await liquidityAddition.prepareTxGroup(account.addr);
  const signedTx = addLiqTxGroup.signTxn(account.sk)
  await algod.sendRawTransaction(signedTx).do();
  console.log(`Adde liquidity transaction group ${addLiqTxGroup.groupId}`);
})();
