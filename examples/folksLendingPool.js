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
  const primaryFolksPool = await pact.fetchFolksLendingPool(
    folksLendingPoolIds[0]
  );
  const secondaryFolksPool = await pact.fetchFolksLendingPool(
    folksLendingPoolIds[1]
  );

  // Pact pool.
  console.log("Fetching or creating pact pool...");
  const factory = await pact.getConstantProductPoolFactory();
  const poolBuildParams = {
    primaryAssetId: primaryFolksPool.fAsset.index,
    secondaryAssetId: secondaryFolksPool.fAsset.index,
    feeBps: 2,
  };
  const [pact_pool, created] = await factory.buildOrGet(
    account.addr,
    poolBuildParams,
    (txGroup) => Promise.resolve(txGroup.signTxn(account.sk))
  );

  // Adapter.
  const lendingPoolAdapter = pact.getFolksLendingPoolAdapter(
    pact_pool,
    primaryFolksPool,
    secondaryFolksPool
  );

  let txGroup;

  if (created) {
    // Adapter opt-in to all the assets.
    console.log("Opting in adapter to assets...");
    const assetIds = [
      primaryFolksPool.originalAsset.index,
      secondaryFolksPool.originalAsset.index,
      primaryFolksPool.fAsset.index,
      secondaryFolksPool.fAsset.index,
      pact_pool.liquidityAsset.index,
    ];
    txGroup = await lendingPoolAdapter.prepareOptInToAssetTxGroup(
      account.addr,
      assetIds
    );
    await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
    console.log(txGroup.groupId);
    console.log();
  }

  // Add liquidity.
  console.log("Adding liquidity...");
  const liquidityAddition = lendingPoolAdapter.prepareAddLiquidity(
    100_000,
    100_000
  );
  txGroup = await lendingPoolAdapter.prepareAddLiquidityTxGroup(
    account.addr,
    liquidityAddition
  );
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
  console.log();

  // Swap.
  console.log("Swapping...");
  const swap = lendingPoolAdapter.prepareSwap(
    primaryFolksPool.originalAsset,
    100_000,
    100
  );
  txGroup = await lendingPoolAdapter.prepareSwapTxGroup(swap, account.addr);
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
  console.log();

  // Remove liquidity.
  console.log("Removing liquidity...");
  txGroup = await lendingPoolAdapter.prepareRemoveLiquidityTxGroup(
    account.addr,
    20_000
  );
  await algod.sendRawTransaction(txGroup.signTxn(account.sk)).do();
  console.log(txGroup.groupId);
})();
