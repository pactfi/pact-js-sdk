/**
 * This example deploys a new pool if pool with the given params doesn't exist yet.
 */

 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

const account = algosdk.mnemonicToSecretKey("<mnemonic>");

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod, {network: "testnet"});

  const factory = await pact.getConstantProductPoolFactory();

  const poolParams = {
    primaryAssetId: 0,
    secondaryAssetId: 14111329,
    feeBps: 100,
  }

  const [pool, created] = await factory.buildOrGet(
    account.addr,
    poolParams,
    txGroup => Promise.resolve(txGroup.signTxn(account.sk)),
  )

  console.log(created ? 'New pool created.' : 'Pool with specified params already exists.')
  console.log(pool);
})();
