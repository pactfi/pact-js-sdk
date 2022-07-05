import { Asset } from "./asset";
import { PactClient } from "./client";
import { StableswapPoolParams } from "./pool";
import {
  TestBed,
  algod,
  createAsset,
  deployExchangeContract,
  deployStableswapContract,
  makeFreshTestBed,
  newAccount,
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

describe("Generic pool", () => {
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
    const second_app_id = await deployExchangeContract(
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
    expect(pools[0].params.feeBps).toBe(30);

    expect(pools[1].primaryAsset.index).toBe(testBed.algo.index);
    expect(pools[1].secondaryAsset.index).toBe(testBed.coin.index);
    expect(
      pools[1].liquidityAsset.index === testBed.pool.liquidityAsset.index,
    ).toBe(false);
    expect(pools[1].liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pools[1].appId).toBe(second_app_id);
    expect(pools[1].params.feeBps).toBe(100);
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

  it("should add big liquidity to an empty pool using split", async () => {
    const { pact, account } = testBed;
    const coinAIndex = await createAsset(account, "coinA", 0, 2 ** 50 - 1);
    const coinBIndex = await createAsset(account, "coinB", 0, 2 ** 50 - 1);

    const appId = await deployExchangeContract(account, coinAIndex, coinBIndex);
    const pool = await pact.fetchPoolById(appId);

    expect(pool.calculator.isEmpty).toBe(true);

    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
    await signAndSend(liqOptInTx, account);

    // Adding initial liquidity has a limitation that the product of 2 assets must be lower then 2**64.
    // Let's go beyond that limit and check what happens.
    const [primaryAssetAmount, secondaryAssetAmount] = [2 ** 40, 2 ** 30];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });
    const txGroup = await pool.prepareAddLiquidityTxGroup({
      address: account.addr,
      liquidityAddition,
    });

    // liquidity is split into two chunks, so 6 txs instead of 3.
    expect(txGroup.transactions.length).toBe(6);

    await signAndSend(txGroup, account);

    await pool.updateState();
    expect(pool.state.totalPrimary).toBe(primaryAssetAmount);
    expect(pool.state.totalSecondary).toBe(secondaryAssetAmount);
  });
});

describe("Constant product pool", () => {
  it("parsing state", async () => {
    const testBed = await makeFreshTestBed({ poolType: "CONSTANT_PRODUCT" });
    const pact = new PactClient(algod);

    const pool = await pact.fetchPoolById(testBed.pool.appId);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);

    expect(pool.poolType).toBe("CONSTANT_PRODUCT");
    expect(pool.version).toBe(2);

    expect(pool.internalState).toEqual({
      A: 0,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      CONTRACT_NAME: "PACT AMM",
      FEE_BPS: pool.feeBps,
      L: 0,
      PACT_FEE_BPS: 0,
      PRIMARY_FEES: 0,
      SECONDARY_FEES: 0,
      TREASURY: testBed.account.addr,
      VERSION: 2,
    });
  });

  it("e2e scenario", async () => {
    const { account, algo, coin, pool } = await makeFreshTestBed({
      poolType: "CONSTANT_PRODUCT",
    });

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
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000,
      secondaryAssetAmount: 100_000,
    });
    const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
      address: account.addr,
      liquidityAddition,
    });
    expect(addLiqTxGroup.transactions.length).toBe(3);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toEqual({
      totalLiquidity: 100_000,
      totalPrimary: 100_000,
      totalSecondary: 100_000,
      primaryAssetPrice: 1,
      secondaryAssetPrice: 1,
    });

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: account.addr,
      amount: 10_000,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2);
    await signAndSend(removeLiqTxGroup, account);
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
    const algoSwapTxGroup = await algoSwap.prepareTxGroup(account.addr);
    expect(algoSwapTxGroup.transactions.length).toBe(2);
    await signAndSend(algoSwapTxGroup, account);
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
    const coinSwapTxGroup = await coinSwap.prepareTxGroup(account.addr);
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(90_000);
    expect(pool.state.totalPrimary < 100_000).toBe(true);
    expect(pool.state.totalSecondary > 100_000).toBe(true);
    expect(pool.state.primaryAssetPrice > 1).toBe(true);
    expect(pool.state.secondaryAssetPrice < 1).toBe(true);
  });

  it("Pool e2e scenario for asset with 19 decimals", async () => {
    const { account, algo, pact } = await makeFreshTestBed();

    const coinBIndex = await createAsset(account, "coinA", 19, 10 ** 19);

    const appId = await deployExchangeContract(account, algo.index, coinBIndex);
    const pool = await pact.fetchPoolById(appId);

    expect(pool.calculator.isEmpty).toBe(true);
    expect(pool.secondaryAsset.decimals).toBe(19);

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
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000,
      secondaryAssetAmount: 10 ** 18,
    });
    const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
      address: account.addr,
      liquidityAddition,
    });
    expect(addLiqTxGroup.transactions.length).toBe(6);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(10 ** 18);
    let lastState = pool.state;

    // Swap algo.
    const algoSwap = await pool.prepareSwap({
      asset: algo,
      amount: 20_000,
      slippagePct: 2,
    });
    const algoSwapTxGroup = await algoSwap.prepareTxGroup(account.addr);
    expect(algoSwapTxGroup.transactions.length).toBe(2);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalPrimary).toBeGreaterThan(lastState.totalPrimary);
    expect(pool.state.totalSecondary).toBeLessThan(lastState.totalSecondary);
    expect(pool.state.totalLiquidity).toBe(lastState.totalLiquidity);
    lastState = pool.state;

    // Swap secondary.
    const coinSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 10 ** 18,
      slippagePct: 2,
    });
    const coinSwapTxGroup = await coinSwap.prepareTxGroup(account.addr);
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalPrimary).toBeLessThan(lastState.totalPrimary);
    expect(pool.state.totalSecondary).toBeGreaterThan(lastState.totalSecondary);
    expect(pool.state.totalLiquidity).toBe(lastState.totalLiquidity);

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: account.addr,
      amount: pool.state.totalLiquidity - 1000,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2);
    await signAndSend(removeLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(1000);
  });
});

describe("Stableswap pool", () => {
  it("parsing state", async () => {
    const testBed = await makeFreshTestBed({ poolType: "STABLESWAP" });
    const pact = new PactClient(algod);

    const pool = await pact.fetchPoolById(testBed.pool.appId);

    expect(pool.primaryAsset.index).toBe(testBed.algo.index);
    expect(pool.secondaryAsset.index).toBe(testBed.coin.index);

    expect(pool.poolType).toBe("STABLESWAP");
    expect(pool.version).toBe(1);

    const timestamp = pool.internalState.INITIAL_A_TIME;

    expect(pool.internalState).toEqual({
      A: 0,
      ADMIN: testBed.account.addr,
      ASSET_A: pool.primaryAsset.index,
      ASSET_B: pool.secondaryAsset.index,
      LTID: pool.liquidityAsset.index,
      B: 0,
      CONTRACT_NAME: "[SI] PACT AMM",
      FEE_BPS: pool.feeBps,
      L: 0,
      PACT_FEE_BPS: 0,
      PRIMARY_FEES: 0,
      SECONDARY_FEES: 0,
      TREASURY: testBed.account.addr,
      VERSION: 1,
      INITIAL_A: 80000,
      INITIAL_A_TIME: timestamp,
      FUTURE_A: 80000,
      FUTURE_A_TIME: timestamp,
      PRECISION: 1000,
    });
  });

  it("e2e scenario", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, "COIN_A", 6, 10 ** 10);
    const coinBIndex = await createAsset(account, "COIN_B", 6, 10 ** 10);

    const appId = await deployStableswapContract(
      account,
      coinAIndex,
      coinBIndex,
      { amplifier: 20, feeBps: 60 },
    );
    const pool = await pact.fetchPoolById(appId);

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
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 100_000_000,
      secondaryAssetAmount: 100_000_000,
    });
    const addLiqTxGroup = await pool.prepareAddLiquidityTxGroup({
      address: account.addr,
      liquidityAddition,
    });
    expect(addLiqTxGroup.transactions.length).toBe(3);
    await signAndSend(addLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 100_000_000,
      totalPrimary: 100_000_000,
      totalSecondary: 100_000_000,
    });
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.00");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("1.00");

    // Remove liquidity.
    const removeLiqTxGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: account.addr,
      amount: 1_000_000,
    });
    expect(removeLiqTxGroup.transactions.length).toBe(2);
    await signAndSend(removeLiqTxGroup, account);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 99_000_000,
      totalPrimary: 99_000_000,
      totalSecondary: 99_000_000,
    });
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.00");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("1.00");

    // Swap coinA.
    const coinASwap = await pool.prepareSwap({
      asset: pool.primaryAsset,
      amount: 2_000_000,
      slippagePct: 2,
    });
    const algoSwapTxGroup = await coinASwap.prepareTxGroup(account.addr);
    expect(algoSwapTxGroup.transactions.length).toBe(2);
    await signAndSend(algoSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(99_000_000);
    expect(pool.state.totalPrimary > 99_000_000).toBe(true);
    expect(pool.state.totalSecondary < 99_000_000).toBe(true);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.00");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("1.00");

    // Swap coinB.
    const coinBSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 5_000_000,
      slippagePct: 2,
    });
    const coinSwapTxGroup = await coinBSwap.prepareTxGroup(account.addr);
    await signAndSend(coinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.totalLiquidity).toBe(99_000_000);
    expect(pool.state.totalPrimary < 99_000_000).toBe(true);
    expect(pool.state.totalSecondary > 99_000_000).toBe(true);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.00");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("1.00");

    // Only big swaps should affect the price.
    const bigCoinBSwap = await pool.prepareSwap({
      asset: pool.secondaryAsset,
      amount: 90_000_000,
      slippagePct: 2,
    });
    const bigCoinSwapTxGroup = await bigCoinBSwap.prepareTxGroup(account.addr);
    await signAndSend(bigCoinSwapTxGroup, account);
    await pool.updateState();
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.61");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.62");

    // Check different amplifiers.
    const poolParams = pool.params as StableswapPoolParams;
    poolParams.futureA = 1;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("13.97");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.07");

    poolParams.futureA = 1000;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("5.15");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.20");

    poolParams.futureA = 5 * 1000;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("2.78");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.36");

    poolParams.futureA = 100 * 1000;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.14");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.88");

    poolParams.futureA = 1000 * 1000;
    pool.state = pool["parseInternalState"](pool.internalState);
    expect(pool.state.primaryAssetPrice.toFixed(2)).toBe("1.01");
    expect(pool.state.secondaryAssetPrice.toFixed(2)).toBe("0.99");
  });
});
