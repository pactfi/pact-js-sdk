/**
 * This example creates a new pool.
 */

 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey("<mnemonic>");

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod);
  const poolCreator = pact.getPoolCreator({
    primary_asset_id: 0,
    secondary_asset_id: 31566704,
    fee_bps: 10,
  });

  // Create & deploy pool
  const initTxn = await poolCreator.preparePoolCreationTx(account.addr);
  const signedInitTx = initTxn.signTxn(account.sk);
  const initTxnBlob = Buffer.from(signedInitTx).toString('base64');

  const poolId = await poolCreator.deployPool(initTxnBlob);
  console.log(`Deployed pool id: ${poolId}`);

  // Fund pool
  const fundingTxns = await poolCreator.prepareFundingTxGroup(account.addr);
  const signedTxns = fundingTxns.signTxn(account.sk);
  const txnsBlobs = signedTxns.map(txn => ({
    blob: Buffer.from(txn).toString('base64'),
  }));
  const createdPool = await poolCreator.sendFundingTxs(txnsBlobs);
  console.log('Created pool object:')
  console.log(createdPool)
})();
