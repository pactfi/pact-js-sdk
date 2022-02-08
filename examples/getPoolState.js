const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

(async function() {
  const algod = new algosdk.Algodv2(); // provide options
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const jamnik = await pact.fetchAsset(41409282);

  const pool = await pact.fetchPool(algo, jamnik);

  console.log(`State ${pool.state}`);
})();
