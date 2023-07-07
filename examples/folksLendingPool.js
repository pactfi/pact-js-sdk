import pactsdk from "@pactfi/pactsdk";
import algosdk from "algosdk";

const NETWORK = "testnet";
const FOLKS_POOL_A = 147169673; // ALGO
const FOLKS_POOL_B = 147170678; // USDC

(async function () {
  const algod = new algosdk.Algodv2("<token>", "<url>");
  const pact = new pactsdk.PactClient(algod, { network: NETWORK });

  const folksLendingPoolIds = [FOLKS_POOL_A, FOLKS_POOL_B].sort(
    (a, b) => a - b
  );

  const account = algosdk.mnemonicToSecretKey("<mnemonic>");

  // Folks pools.
  console.log("Fetching folks lending pools...");
  const primaryLendingPool = await pact.fetchFolksLendingPool(
    folksLendingPoolIds[0]
  );
  const secondaryLendingPool = await pact.fetchFolksLendingPool(
    folksLendingPoolIds[1]
  );

  // Pact pool.
  console.log("Fetching or creating pact pool...");
  const factory = await pact.getConstantProductPoolFactory();
  const poolBuildParams = {
    primaryAssetId: primaryLendingPool.fAsset.index,
    secondaryAssetId: secondaryLendingPool.fAsset.index,
    feeBps: 2,
  };
  const [pactPool, created] = await factory.buildOrGet(
    account.addr,
    poolBuildParams,
    (txGroup) => Promise.resolve(txGroup.signTxn(account.sk))
  );

  // Adapter.
  const lendingPoolAdapter = pact.getFolksLendingPoolAdapter({
    pactPool,
    primaryLendingPool,
    secondaryLendingPool,
  });

  let txGroup;

  if (created) {
    // Adapter opt-in to all the assets.
    console.log("Opting in adapter to assets...");
    const assetIds = [
      primaryLendingPool.originalAsset.index,
      secondaryLendingPool.originalAsset.index,
      primaryLendingPool.fAsset.index,
      secondaryLendingPool.fAsset.index,
      pactPool.liquidityAsset.index,
    ];
    txGroup = await lendingPoolAdapter.prepareOptInToAssetTxGroup(
      {address:account.addr, assetIds}
    );
    await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
    console.log(txGroup.groupId);
    console.log();
  }

  // Add liquidity.
  console.log("Adding liquidity...");
  const liquidityAddition = lendingPoolAdapter.prepareAddLiquidity({
    primaryAssetAmount: 100_000,
    secondaryAssetAmount: 100_000,
    slippagePct: 0.5,
  });
  txGroup = await lendingPoolAdapter.prepareAddLiquidityTxGroup({
    address: account.addr,
    liquidityAddition,
  });
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
  console.log();

  // Swap.
  console.log("Swapping...");
  const swap = lendingPoolAdapter.prepareSwap({
    amount: 100_000,
    asset: primaryLendingPool.originalAsset,
    slippagePct: 100,
  });
  txGroup = await lendingPoolAdapter.prepareSwapTxGroup({
    address: account.addr,
    swap,
  });
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
  console.log();

  // Remove liquidity.
  console.log("Removing liquidity...");
  txGroup = await lendingPoolAdapter.prepareRemoveLiquidityTxGroup({
    address: account.addr,
    amount: 20_000,
  });
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
})();
