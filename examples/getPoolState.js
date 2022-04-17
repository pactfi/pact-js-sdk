const { default: algosdk } = require('algosdk');
const pactsdk = require('../dist/cjs/pactsdk.js');

(async function() {
  const algod = new algosdk.Algodv2(); // provide options
  const pact = new pactsdk.PactClient(algod);

  const algo = await pact.fetchAsset(0);
  const usdc = await pact.fetchAsset(37074699);

  const pools = await pact.fetchPoolsByAssets(algo, usdc);

  console.log(`State ${pools[0].state}`);
})();
