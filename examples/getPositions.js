const { default: algosdk } = require('algosdk');
const pact = require('../dist/pactifysdk.cjs');

(async function() {
  const client = new pact.Client({
    algod: new algosdk.Algodv2(), // provide options
  })

  const algo = await client.fetchAsset(0)
  const jamnik = await client.fetchAsset(41409282)

  const pool = await client.fetchPool(algo, jamnik);

  console.log(`Positions ${pool.positions}`);
})();
