/**
 * This example fetches a pool and reads its state.
 */

import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

(async function() {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const usdc = await pact.fetchAsset(31566704);

  const pool = await pact.fetchPoolsByAssets(algo, usdc)[0];

  console.log(`State ${pool.state}`);
})();
