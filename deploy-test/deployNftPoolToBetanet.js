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
  const algod = new algosdk.Algodv2("<api_key>", "https://betanet-algorand.pact.fi/ps2");
  const pact = new pactsdk.PactClient(algod, {pactApiUrl: "https://api.testnet.pact.fi"});
  const poolCreator = pact.getPoolCreator({
    primary_asset_id: argv.assetA.toString(),
    secondary_asset_id: argv.assetB.toString(),
    fee_bps: argv.feeBps,
    pool_type: "NFT_CONSTANT_PRODUCT"
  });

 
  try {
    //  // DEPLOY
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



    //Fetch pool by ID
    console.log('Fetch pool by ID');
    let pool = await pact.fetchPoolById(poolId);

    // Opt-in for liquidity token.
    let optInTxn = await pool.liquidityAsset.prepareOptInTx(account.addr);
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
    const sentAddTx = await algod.sendRawTransaction(signedTx).do();
     await algosdk.waitForConfirmation(pact.algod, sentAddTx.txId, 2);
    console.log(`Add liquidity transaction group ${addLiqTxGroup.groupId}`);

    // SWAP
    await pool.updateState();
    const algo = await pact.fetchAsset(0)
    const nft_coin = await pact.fetchAsset(parseInt(argv.assetB.toString()))
    optInTxn = await nft_coin.prepareOptInTx(account.addr);
    sentOptInTxn = await pact.algod.sendRawTransaction(optInTxn.signTxn(account.sk)).do();
    await algosdk.waitForConfirmation(pact.algod, sentOptInTxn.txId, 2);
    console.log(`OptIn transaction ${sentOptInTxn.txId}`);

    console.log('Prepare swap')
    const swap = pool.prepareSwap({
      asset: algo,
      amount: 100_000,
      slippagePct: 2,
    });
    const swapTxGroup = await swap.prepareTxGroup(account.addr);
    const signedTxs = swapTxGroup.signTxn(account.sk)
    await algod.sendRawTransaction(signedTxs).do();
    console.log(`Swap transaction group ${swapTxGroup.groupId}`);
  } catch(e) {
    console.error(e);
  }
  
})();
