import { Asset } from "./asset";
import { Client } from "./client";
import {
  TestPool,
  algod,
  makeFreshTestPool,
  signSendAndWait,
} from "./testUtils";

let apiAppId: number;
let apiSecondaryAssetIndex: number;

function get_api_pool_data() {
  if (!apiAppId) {
    return { results: [] };
  }
  return {
    results: [
      {
        appid: apiAppId,
        primary_asset: { algoid: "0" },
        secondary_asset: { algoid: apiSecondaryAssetIndex },
      },
    ],
  };
}

jest.mock("./crossFetch", () => {
  return {
    crossFetch: () => Promise.resolve(get_api_pool_data()),
  };
});

describe("Pool", () => {
  let testPool: TestPool;

  beforeAll(async () => {
    testPool = await makeFreshTestPool();

    apiAppId = testPool.pool.appId;
    apiSecondaryAssetIndex = testPool.coin.index;
  });

  it("listing pools", async () => {
    const client = new Client(algod);

    const pools = await client.listPools();
    expect(pools).toEqual({
      results: [
        {
          appid: apiAppId,
          primary_asset: { algoid: "0" },
          secondary_asset: { algoid: apiSecondaryAssetIndex },
        },
      ],
    });
  });

  it("fetching pool from api", async () => {
    const client = new Client(algod);

    const pool = await client.fetchPool(testPool.algo, testPool.coin);

    expect(pool.primaryAsset.index).toBe(testPool.algo.index);
    expect(pool.secondaryAsset.index).toBe(testPool.coin.index);
    expect(pool.liquidityAsset.index).toBe(testPool.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testPool.pool.appId);
  });

  it("fetching not existing pool from api", async () => {
    apiAppId = 0;
    const client = new Client(algod);

    const coin = new Asset(client.algod, 999999999);

    await expect(() => client.fetchPool(testPool.algo, coin)).rejects.toBe(
      "Cannot find pool for assets 0 and 999999999.",
    );
  });

  it("fetching pool by providing appid", async () => {
    const client = new Client(algod);

    const pool = await client.fetchPool(testPool.algo, testPool.coin, {
      appId: testPool.pool.appId,
    });

    expect(pool.primaryAsset.index).toBe(testPool.algo.index);
    expect(pool.secondaryAsset.index).toBe(testPool.coin.index);
    expect(pool.liquidityAsset.index).toBe(testPool.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testPool.pool.appId);
  });

  it("fetching pool with reversed assets", async () => {
    const client = new Client(algod);

    // We reverse the assets order here.
    const pool = await client.fetchPool(testPool.coin, testPool.algo, {
      appId: testPool.pool.appId,
    });

    expect(pool.primaryAsset.index).toBe(testPool.algo.index);
    expect(pool.secondaryAsset.index).toBe(testPool.coin.index);
    expect(pool.liquidityAsset.index).toBe(testPool.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testPool.pool.appId);
  });
});

it("Pool e2e scenario", async () => {
  const { account, algo, coin, pool } = await makeFreshTestPool();

  expect(pool.state).toEqual({
    totalLiquidity: 0,
    totalPrimary: 0,
    totalSecondary: 0,
    primaryAssetPrice: 0,
    secondaryAssetPrice: 0,
  });

  // Opt in for liquidity asset.
  const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
  await signSendAndWait(liqOptInTx, account);

  // Add liquidity.
  const addLiqTx = await pool.prepareAddLiquidityTx({
    address: account.addr,
    primaryAssetAmount: 100_000,
    secondaryAssetAmount: 100_000,
  });
  await signSendAndWait(addLiqTx, account);
  await pool.updateState();
  expect(pool.state).toEqual({
    totalLiquidity: 100_000,
    totalPrimary: 100_000,
    totalSecondary: 100_000,
    primaryAssetPrice: 1,
    secondaryAssetPrice: 1,
  });

  // Remove liquidity.
  const removeLiqTx = await pool.prepareRemoveLiquidityTx({
    address: account.addr,
    amount: 10_000,
  });
  await signSendAndWait(removeLiqTx, account);
  await pool.updateState();
  expect(pool.state).toEqual({
    totalLiquidity: 90_000,
    totalPrimary: 90_000,
    totalSecondary: 90_000,
    primaryAssetPrice: 1,
    secondaryAssetPrice: 1,
  });

  // Swap algo.
  const algoSwap = await pool.prepareSwap({
    asset: algo,
    amount: 20_000,
    slippagePct: 2,
  });
  const algoSwapTx = await algoSwap.prepareTx(account.addr);
  await signSendAndWait(algoSwapTx, account);
  await pool.updateState();
  expect(pool.state.totalLiquidity).toBe(90_000);
  expect(pool.state.totalPrimary > 100_000).toBe(true);
  expect(pool.state.totalSecondary < 100_000).toBe(true);
  expect(pool.state.primaryAssetPrice < 1).toBe(true);
  expect(pool.state.secondaryAssetPrice > 1).toBe(true);

  // Swap secondary.
  const coinSwap = await pool.prepareSwap({
    asset: coin,
    amount: 50_000,
    slippagePct: 2,
  });
  const coinSwapTx = await coinSwap.prepareTx(account.addr);
  await signSendAndWait(coinSwapTx, account);
  await pool.updateState();
  expect(pool.state.totalLiquidity).toBe(90_000);
  expect(pool.state.totalPrimary < 100_000).toBe(true);
  expect(pool.state.totalSecondary > 100_000).toBe(true);
  expect(pool.state.primaryAssetPrice > 1).toBe(true);
  expect(pool.state.secondaryAssetPrice < 1).toBe(true);
});
