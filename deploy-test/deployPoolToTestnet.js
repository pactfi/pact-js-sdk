/**
 * A script that creates a new pool.
 * Before start, run `npm i` in the `deploy-test` folder.
 *
 * To run the script, enter the following command with proper variables:
 * node deployPoolToTestnet.js --mnemonic='one two three' --assetA=0 --assetB=73483148 --feeBps=45
 */
const algosdk = require("algosdk");
const pactsdk = require("@pactfi/pactsdk");
const argv = require('minimist')(process.argv.slice(2));

const account = algosdk.mnemonicToSecretKey(argv.mnemonic);

(async function() {
  const algod = new algosdk.Algodv2("", "https://testnet-algorand.pact.fi/ps2");
  const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});
  const poolCreator = pact.getPoolCreator({
    primary_asset_id: argv.assetA.toString(),
    secondary_asset_id: argv.assetB.toString(),
    fee_bps: argv.feeBps,
  });

  try {
    console.log('Creating pool...');
    const initTxn = await poolCreator.preparePoolCreationTx(account.addr);
    const signedInitTx = initTxn.signTxn(account.sk);
    const initTxnBlob = Buffer.from(signedInitTx).toString('base64');

    console.log('Deploying pool...');
    const poolId = await poolCreator.deployPool(initTxnBlob);
    console.log(`Deployed pool id: ${poolId}`);

    console.log('Funding pool...');
    const fundingTxns = await poolCreator.prepareFundingTxGroup(account.addr);
    const signedTxns = fundingTxns.signTxn(account.sk);
    const txnsBlobs = signedTxns.map(txn => ({
      blob: Buffer.from(txn).toString('base64'),
    }));
    console.log('Sending fund txns...');
    const createdPool = await poolCreator.sendFundingTxs(txnsBlobs);
    console.log('Created pool object:');
    console.log(createdPool);
  } catch(e) {
    console.error(e);
  }
})();
