/**
 * This examples lists constant product pools created by the factory.
 * It will not list old pools created before introducing pool factory to the Pact architecture.
 * Each pool type require using a dedicated factory.
 */

 import algosdk from "algosdk";
 import pactsdk from "@pactfi/pactsdk";

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod, {network: "testnet"});

  const factory = await pact.getConstantProductPoolFactory();

  const poolParams = await factory.listPools()
  console.log('Pools:')
  console.log(poolParams)

  // To fully fetch the pool of choice...
  const pool = await factory.fetchPool(poolParams[0])
  console.log('Pool:')
  console.log(pool)
})();
