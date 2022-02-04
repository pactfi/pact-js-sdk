const { default: algosdk } = require('algosdk');
const pact = require('../dist/pactsdk.cjs');

(async function() {
  const algod = new algosdk.Algodv2(); // provide options
  const client = new pact.Client(algod);

  const algo = await client.fetchAsset(0);
  const jamnik = await client.fetchAsset(41409282);

  const pool = await client.fetchPool(algo, jamnik);

  console.log(`State ${pool.state}`);
})();
