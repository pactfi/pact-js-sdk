import algosdk from "algosdk";

import { PactClient } from "./client";
import { PoolType, StableswapPoolParams } from "./pool";
import { PoolState } from "./poolState";
import { StableswapCalculator } from "./stableswapCalculator";
import { Swap } from "./swap";
import {
  addLiqudity,
  algod,
  createAsset,
  deployExchangeContract,
  deployStableswapContract,
  makeFreshTestBed,
  newAccount,
  signAndSend,
} from "./testUtils";
import { TransactionGroup } from "./transactionGroup";

async function testSwap(swap: Swap, account: algosdk.Account) {
  // Perform the swap.
  const oldState = swap.pool.state;
  const swapTxGroup = await swap.prepareTxGroup(account.addr);
  await signAndSend(swapTxGroup, account);
  await swap.pool.updateState();

  // Compare the simulated effect with what really happened on the blockchain.
  assertSwapEffect(swap, oldState, swap.pool.state);
}

function assertSwapEffect(
  swap: Swap,
  oldState: PoolState,
  newState: PoolState,
) {
  if (swap.assetOut === swap.pool.primaryAsset) {
    expect(swap.effect.amountOut).toBe(
      newState.totalPrimary - oldState.totalPrimary,
    );
    expect(swap.effect.amountIn).toBe(
      oldState.totalSecondary - newState.totalSecondary,
    );
  } else {
    expect(swap.effect.amountIn).toBe(
      oldState.totalPrimary - newState.totalPrimary,
    );
    expect(swap.effect.amountOut).toBe(
      newState.totalSecondary - oldState.totalSecondary,
    );
  }

  expect(swap.effect.minimumAmountIn).toBe(
    Math.ceil(
      swap.effect.amountIn - swap.effect.amountIn * (swap.slippagePct / 100),
    ),
  );

  const diff_ratio = swap.assetOut.ratio / swap.assetIn.ratio;
  expect(swap.effect.price).toBe(
    ((swap.effect.amountIn + swap.effect.fee) / swap.effect.amountOut) *
      diff_ratio,
  );

  expect(swap.effect.primaryAssetPriceAfterSwap).toEqual(
    newState.primaryAssetPrice,
  );
  expect(swap.effect.secondaryAssetPriceAfterSwap).toEqual(
    newState.secondaryAssetPrice,
  );

  expect(swap.effect.primaryAssetPriceImpactPct).toBe(
    (newState.primaryAssetPrice * 100) / oldState.primaryAssetPrice - 100,
  );
  expect(swap.effect.secondaryAssetPriceImpactPct).toBe(
    (newState.secondaryAssetPrice * 100) / oldState.secondaryAssetPrice - 100,
  );
}

function swapTestCase(poolType: PoolType) {
  it("empty liquidity", async () => {
    const { algo, pool } = await makeFreshTestBed({ poolType: poolType });

    expect(() =>
      pool.prepareSwap({
        amount: 1000,
        asset: algo,
        slippagePct: 10,
      }),
    ).toThrow("Pool is empty and swaps are impossible.");
  });

  it("asset not in the pool", async () => {
    const { pact, pool, account } = await makeFreshTestBed({
      poolType: poolType,
    });
    const shitcoinIndex = await createAsset(account);
    const shitcoin = await pact.fetchAsset(shitcoinIndex);

    expect(() =>
      pool.prepareSwap({
        amount: 1000,
        asset: shitcoin,
        slippagePct: 10,
      }),
    ).toThrow(`Asset ${shitcoin.index} not in the pool`);
  });

  it("primary with equal liquidity", async () => {
    const { account, algo, coin, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.assetIn).toBe(coin);
    expect(swap.assetOut).toBe(algo);
    expect(swap.slippagePct).toBe(10);

    await testSwap(swap, account);
  });

  it("primary with not equal liquidity", async () => {
    const { account, algo, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000, 25_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
    });

    await testSwap(swap, account);
  });

  it("secondary with equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10,
    });

    await testSwap(swap, account);
  });

  it("secondary with not equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [25_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10,
    });

    await testSwap(swap, account);
  });

  it("with custom fee bps", async () => {
    const TestBedA = await makeFreshTestBed({ poolType: poolType, feeBps: 10 });
    const TestBedB = await makeFreshTestBed({
      poolType: poolType,
      feeBps: 2000,
    });

    expect(TestBedA.pool.params.feeBps).toBe(10);
    expect(TestBedB.pool.params.feeBps).toBe(2000);

    await addLiqudity(TestBedA.account, TestBedA.pool, 20_000, 20_000);
    await addLiqudity(TestBedB.account, TestBedB.pool, 20_000, 20_000);

    const swapA = TestBedA.pool.prepareSwap({
      amount: 10_000,
      asset: TestBedA.algo,
      slippagePct: 10,
    });
    const swapB = TestBedB.pool.prepareSwap({
      amount: 10_000,
      asset: TestBedB.algo,
      slippagePct: 10,
    });

    expect(swapB.effect.price).toBe(swapA.effect.price);
    expect(swapB.effect.fee).toBeGreaterThan(swapA.effect.fee);
    expect(swapB.effect.amountIn).toBeLessThan(swapA.effect.amountIn);

    // Perform the swaps and check if the simulated effect matches what really happened in the blockchain.

    const swapATxGroup = await swapA.prepareTxGroup(TestBedA.account.addr);
    await signAndSend(swapATxGroup, TestBedA.account);
    await TestBedA.pool.updateState();

    const swapBTxGroup = await swapB.prepareTxGroup(TestBedB.account.addr);
    await signAndSend(swapBTxGroup, TestBedB.account);
    await TestBedB.pool.updateState();

    expect(TestBedA.pool.state.totalSecondary).toBe(
      20_000 - swapA.effect.amountIn,
    );
    expect(TestBedB.pool.state.totalSecondary).toBe(
      20_000 - swapB.effect.amountIn,
    );
  });

  it("with different slippage", async () => {
    const { account, algo, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    await addLiqudity(account, pool, 20_000, 20_000);

    expect(() =>
      pool.prepareSwap({
        amount: 10_000,
        asset: algo,
        slippagePct: -1,
      }),
    ).toThrow("Splippage must be between 0 and 100");

    expect(() =>
      pool.prepareSwap({
        amount: 10_000,
        asset: algo,
        slippagePct: 100.1,
      }),
    ).toThrow("Splippage must be between 0 and 100");

    const swapA = pool.prepareSwap({
      amount: 10_000,
      asset: algo,
      slippagePct: 0,
    });
    const swapB = pool.prepareSwap({
      amount: 10_000,
      asset: algo,
      slippagePct: 2,
    });
    const swapC = pool.prepareSwap({
      amount: 10_000,
      asset: algo,
      slippagePct: 60,
    });
    const swapD = pool.prepareSwap({
      amount: 10_000,
      asset: algo,
      slippagePct: 100,
    });

    expect(swapA.effect.minimumAmountIn).toBe(swapA.effect.amountIn);

    expect(swapB.effect.minimumAmountIn).toBeLessThan(swapB.effect.amountIn);
    expect(swapB.effect.minimumAmountIn).toBeGreaterThan(0);

    expect(swapC.effect.minimumAmountIn).toBeLessThan(swapC.effect.amountIn);
    expect(swapC.effect.minimumAmountIn).toBeLessThan(
      swapB.effect.minimumAmountIn,
    );
    expect(swapC.effect.minimumAmountIn).toBeGreaterThan(0);

    expect(swapD.effect.minimumAmountIn).toBe(0);

    // Now let's do a swap that change the price.
    const swap = pool.prepareSwap({
      amount: 10_000,
      asset: algo,
      slippagePct: 0,
    });
    const swapTxGroup = await swap.prepareTxGroup(account.addr);
    await signAndSend(swapTxGroup, account);

    // Swap A and B should fail because slippage is too low.
    const swapATxGroup = await swapA.prepareTxGroup(account.addr);
    expect(() => signAndSend(swapATxGroup, account)).rejects.toMatchObject({
      status: 400,
    });
    const swapBTxGroup = await swapB.prepareTxGroup(account.addr);
    expect(() => signAndSend(swapBTxGroup, account)).rejects.toMatchObject({
      status: 400,
    });

    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(20_000 - swap.effect.amountIn); // no change yet

    // Swap C and D should pass;
    const swapCTxGroup = await swapC.prepareTxGroup(account.addr);
    await signAndSend(swapCTxGroup, account);
    await pool.updateState();
    const swappedCAmount =
      20_000 - swap.effect.amountIn - pool.state.totalSecondary;
    expect(swappedCAmount).toBeLessThan(swapC.effect.amountIn);
    expect(swappedCAmount).toBeGreaterThan(swapC.effect.minimumAmountIn);

    const swapDTxGroup = await swapD.prepareTxGroup(account.addr);
    await signAndSend(swapDTxGroup, account);
    await pool.updateState();
    const swappedDAmount =
      20_000 -
      swap.effect.amountIn -
      swappedCAmount -
      pool.state.totalSecondary;
    expect(swappedDAmount).toBeLessThan(swapD.effect.amountIn);
    expect(swappedDAmount).toBeGreaterThan(swapD.effect.minimumAmountIn);
  });

  it("primary with equal liquidity reversed", async () => {
    const { account, algo, coin, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
      reverse: true,
    });

    expect(reversedSwap.assetIn).toBe(coin);
    expect(reversedSwap.assetOut).toBe(algo);
    expect(reversedSwap.slippagePct).toBe(10);
    expect(reversedSwap.effect.amountIn).toBe(1000);
    expect(reversedSwap.effect.amountOut).toBeGreaterThan(1000);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountOut,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountOut).toBe(reversedSwap.effect.amountOut);
    expect(swap.effect.amountIn).toBe(reversedSwap.effect.amountIn);

    await testSwap(reversedSwap, account);
  });

  it("primary with not equal liquidity reversed", async () => {
    const { account, algo, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [15_000, 25_000, 2_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const reversedSwap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
      reverse: true,
    });

    expect(reversedSwap.effect.amountIn).toBe(2000);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountOut,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountOut).toBe(reversedSwap.effect.amountOut);
    expect(swap.effect.amountIn).toBe(reversedSwap.effect.amountIn);

    await testSwap(reversedSwap, account);
  });

  it("swap and optin in a single group", async () => {
    const otherAccount = await newAccount();
    const { pact, account, coin, algo, pool } = await makeFreshTestBed({
      poolType,
    });
    const [primaryLiq, secondaryLiq, amount] = [20_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
    });

    const suggestedParams = await pact.algod.getTransactionParams().do();
    const optInTx = coin.buildOptInTx(otherAccount.addr, suggestedParams);
    const txs = [
      optInTx,
      ...pool.buildSwapTxs({
        swap,
        address: otherAccount.addr,
        suggestedParams,
      }),
    ];

    const group = new TransactionGroup(txs);
    await signAndSend(group, otherAccount);
  });
}

describe("constant product swap", () => {
  swapTestCase("CONSTANT_PRODUCT");

  it("ASA to ASA", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, "COIN_A", 3);
    const coinBIndex = await createAsset(account, "COIN_B", 2);

    const appId = await deployExchangeContract(account, coinAIndex, coinBIndex);
    const pool = await pact.fetchPoolById(appId);

    await addLiqudity(account, pool, 20_000, 20_000);
    await pool.updateState();
    expect(pool.state).toEqual({
      primaryAssetPrice: 10, // because different decimal places for both assets.
      secondaryAssetPrice: 0.1,
      totalLiquidity: 20000,
      totalPrimary: 20000,
      totalSecondary: 20000,
    });

    const swap = pool.prepareSwap({
      amount: 1000,
      asset: pool.primaryAsset,
      slippagePct: 10,
    });
    await testSwap(swap, account);
  });
});

describe("stable swap", () => {
  swapTestCase("STABLESWAP");

  it("changing amplifier", async () => {
    const { pool } = await makeFreshTestBed({
      poolType: "STABLESWAP",
      amplifier: 100,
    });

    const params = pool.params as StableswapPoolParams;
    const swapCalculator = pool.calculator
      .swapCalculator as StableswapCalculator;

    let initialTime = params.initialATime;

    jest.useFakeTimers("modern");
    jest.setSystemTime(initialTime);

    expect(swapCalculator.getAmplifier()).toBe(100n);

    // Let's increase the amplifier.
    params.futureA = 200;
    params.futureATime += 1000;

    const swapArgs: [bigint, bigint, bigint] = [2000n, 1500n, 1000n];

    expect(swapCalculator.getAmplifier()).toBe(100n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(984n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1017n);

    jest.setSystemTime(initialTime + 100);
    expect(swapCalculator.getAmplifier()).toBe(110n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(985n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1016n);

    jest.setSystemTime(initialTime + 500);
    expect(swapCalculator.getAmplifier()).toBe(150n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(989n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1011n);

    jest.setSystemTime(initialTime + 1000);
    expect(swapCalculator.getAmplifier()).toBe(200n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(992n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1008n);

    jest.setSystemTime(initialTime + 2000);
    expect(swapCalculator.getAmplifier()).toBe(200n);

    // Let's decrease the amplifier.
    params.initialA = params.futureA;
    params.initialATime = Date.now();
    params.futureA = 150;
    params.futureATime = params.initialATime + 2000;
    initialTime = params.initialATime;

    expect(swapCalculator.getAmplifier()).toBe(200n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(992n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1008n);

    jest.setSystemTime(initialTime + 100);
    expect(swapCalculator.getAmplifier()).toBe(198n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(992n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1008n);

    jest.setSystemTime(initialTime + 1000);
    expect(swapCalculator.getAmplifier()).toBe(175n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(991n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1010n);

    jest.setSystemTime(initialTime + 2000);
    expect(swapCalculator.getAmplifier()).toBe(150n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(989n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(1011n);

    jest.setSystemTime(initialTime + 3000);
    expect(swapCalculator.getAmplifier()).toBe(150n);

    params.futureA = 5000;
    expect(swapCalculator.getAmplifier()).toBe(5000n);
    expect(swapCalculator.getSwapGrossAmountIn(...swapArgs)).toBe(1001n);
    expect(swapCalculator.getSwapAmountOut(...swapArgs)).toBe(999n);
  });

  it("swap with big amplifier", async () => {
    const { account, pool, algo } = await makeFreshTestBed({
      poolType: "STABLESWAP",
      amplifier: 5000,
    });

    await addLiqudity(account, pool, 20000, 15000);

    const swap = pool.prepareSwap({
      amount: 1000,
      asset: algo,
      slippagePct: 0,
    });

    expect(swap.effect.amountIn + swap.effect.fee).toBe(1001);

    await testSwap(swap, account);
  });

  it("ASA to ASA", async () => {
    const account = await newAccount();
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, "COIN_A", 2);
    const coinBIndex = await createAsset(account, "COIN_B", 2);

    const appId = await deployStableswapContract(
      account,
      coinAIndex,
      coinBIndex,
    );
    const pool = await pact.fetchPoolById(appId);

    await addLiqudity(account, pool, 1_000_000, 1_000_000);
    await pool.updateState();
    expect(pool.state).toMatchObject({
      totalLiquidity: 1_000_000,
      totalPrimary: 1_000_000,
      totalSecondary: 1_000_000,
      primaryAssetPrice: 1,
      secondaryAssetPrice: 1,
    });

    const swap = pool.prepareSwap({
      amount: 100_000,
      asset: pool.primaryAsset,
      slippagePct: 10,
    });
    await testSwap(swap, account);
  });
});
