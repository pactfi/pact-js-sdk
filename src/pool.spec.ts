import { Asset } from "./asset";
import { PactClient } from "./client";
import { TestBed, algod, makeFreshTestBed, signAndSend } from "./testUtils";

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
  let testBed: TestBed;

  beforeAll(async () => {
    testBed = await makeFreshTestBed();

    apiAppId = testBed.pool.appId;
    apiSecondaryAssetIndex = testBed.coin.index;
  });

  it("listing pools", async () => {
    const pact = new PactClient(algod);

    const pools = await pact.listPools();
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
    const pact = new PactClient(algod);

    const pool = await pact.fetchPool(testBed.algo, testBed.coin);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);
    expect(pool.liquidityAsset.index).toBe(testBed.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testBed.pool.appId);
  });

  it("fetching not existing pool from api", async () => {
    apiAppId = 0;
    const pact = new PactClient(algod);

    const coin = new Asset(pact.algod, 999999999);

    await expect(() => pact.fetchPool(testBed.algo, coin)).rejects.toBe(
      "Cannot find pool for assets 0 and 999999999.",
    );
  });

  it("fetching pool by providing appid", async () => {
    const pact = new PactClient(algod);

    const pool = await pact.fetchPool(testBed.algo, testBed.coin, {
      appId: testBed.pool.appId,
    });

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);
    expect(pool.liquidityAsset.index).toBe(testBed.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testBed.pool.appId);
  });

  it("fetching pool with reversed assets", async () => {
    const pact = new PactClient(algod);

    // We reverse the assets order here.
    const pool = await pact.fetchPool(testBed.coin, testBed.algo, {
      appId: testBed.pool.appId,
    });

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);
    expect(pool.liquidityAsset.index).toBe(testBed.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testBed.pool.appId);
  });

  it("get other asset", async () => {
    expect(testBed.pool.getOtherAsset(testBed.algo)).toBe(testBed.coin);
    expect(testBed.pool.getOtherAsset(testBed.coin)).toBe(testBed.algo);

    const shitcoin = new Asset(testBed.pact.algod, testBed.coin.index + 1);
    expect(() => testBed.pool.getOtherAsset(shitcoin)).toThrow(
      `Asset with index ${shitcoin.index} is not a pool asset.`,
    );
  });
});

it("Pool e2e scenario", async () => {
  const { account, algo, coin, pool } = await makeFreshTestBed();

  expect(pool.state).toEqual({
    totalLiquidity: 0,
    totalPrimary: 0,
    totalSecondary: 0,
    primaryAssetPrice: 0,
    secondaryAssetPrice: 0,
  });

  // Opt in for liquidity asset.
  const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
  await signAndSend(liqOptInTx, account);

  // Add liquidity.
  const addLiqTx = await pool.prepareAddLiquidityTx({
    address: account.addr,
    primaryAssetAmount: 100_000,
    secondaryAssetAmount: 100_000,
  });
  await signAndSend(addLiqTx, account);
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
  await signAndSend(removeLiqTx, account);
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
  await signAndSend(algoSwapTx, account);
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
  await signAndSend(coinSwapTx, account);
  await pool.updateState();
  expect(pool.state.totalLiquidity).toBe(90_000);
  expect(pool.state.totalPrimary < 100_000).toBe(true);
  expect(pool.state.totalSecondary > 100_000).toBe(true);
  expect(pool.state.primaryAssetPrice > 1).toBe(true);
  expect(pool.state.secondaryAssetPrice < 1).toBe(true);
});
