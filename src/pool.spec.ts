import { Asset } from "./asset";
import { PactClient } from "./client";
import {
  TestBed,
  algod,
  deployContract,
  makeFreshTestBed,
  signAndSend,
} from "./testUtils";

let poolsApiResults: any[];

function get_api_pool_data() {
  return { results: poolsApiResults };
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

    poolsApiResults = [
      {
        appid: testBed.pool.appId.toString(),
        primary_asset: { algoid: "0" },
        secondary_asset: { algoid: testBed.coin.index.toString() },
      },
    ];
  });

  it("listing pools", async () => {
    const pact = new PactClient(algod);

    const pools = await pact.listPools();
    expect(pools).toEqual({
      results: [
        {
          appid: testBed.pool.appId.toString(),
          primary_asset: { algoid: "0" },
          secondary_asset: { algoid: testBed.coin.index.toString() },
        },
      ],
    });
  });

  it("fetching pool by assets", async () => {
    const pact = new PactClient(algod);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, testBed.coin);

    expect(pools.length === 1);
    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(pools[0].liquidityAsset.index).toBe(
      testBed.pool.liquidityAsset.index,
    );
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);

    expect(pools[0].getEscrowAddress()).toBeTruthy();

    // Can fetch by ids.
    const pools2 = await pact.fetchPoolsByAssets(
      testBed.algo.index,
      testBed.coin.index,
    );
    expect(pools2.length === 1);
    expect(pools2[0].primaryAsset.index).toBe(testBed.algo.index);
  });

  it("fetching pool by assets with reversed order", async () => {
    const pact = new PactClient(algod);

    // We reverse the assets order here.
    const pools = await pact.fetchPoolsByAssets(testBed.coin, testBed.algo);

    expect(pools.length === 1);
    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(pools[0].liquidityAsset.index).toBe(
      testBed.pool.liquidityAsset.index,
    );
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);
  });

  it("fetching pool by assets with multiple results", async () => {
    const second_app_id = await deployContract(
      testBed.account,
      testBed.algo.index,
      testBed.coin.index,
      { feeBps: 100 },
    );

    poolsApiResults = [
      {
        appid: testBed.pool.appId.toString(),
        primary_asset: { algoid: "0" },
        secondary_asset: { algoid: testBed.coin.index.toString() },
      },
      {
        appid: second_app_id.toString(),
        primary_asset: { algoid: "0" },
        secondary_asset: { algoid: testBed.coin.index.toString() },
      },
    ];

    const pact = new PactClient(algod);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, testBed.coin);

    expect(pools.length === 2);

    expect(pools[0].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[0].secondaryAsset.index).toBe(testBed.coin.index);
    expect(
      pools[0].liquidityAsset.index === testBed.pool.liquidityAsset.index,
    ).toBe(true);
    expect(pools[0].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[0].appId).toBe(testBed.pool.appId);
    expect(pools[0].feeBps).toBe(30);

    expect(pools[1].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[1].secondaryAsset.index).toBe(testBed.coin.index);
    expect(
      pools[1].liquidityAsset.index === testBed.pool.liquidityAsset.index,
    ).toBe(false);
    expect(pools[1].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[1].appId).toBe(second_app_id);
    expect(pools[1].feeBps).toBe(100);
  });

  it("fetching by assets not existing pool", async () => {
    poolsApiResults = [];
    const pact = new PactClient(algod);

    const coin = new Asset(pact.algod, 999999999);

    const pools = await pact.fetchPoolsByAssets(testBed.algo, coin);
    expect(pools).toEqual([]);
  });

  it("fetching pool by id", async () => {
    const pact = new PactClient(algod);

    const pool = await pact.fetchPoolById(testBed.pool.appId);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);
    expect(pool.liquidityAsset.index).toBe(testBed.pool.liquidityAsset.index);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(testBed.pool.appId);
  });

  it("fetching pool by id not existing", async () => {
    const pact = new PactClient(algod);

    await expect(() => pact.fetchPoolById(9999999)).rejects.toMatchObject({
      status: 404,
    });
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
