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
  if (swap.assetDeposited === swap.pool.primaryAsset) {
    expect(swap.effect.amountDeposited).toBe(
      newState.totalPrimary - oldState.totalPrimary,
    );
    expect(swap.effect.amountReceived).toBe(
      oldState.totalSecondary - newState.totalSecondary,
    );
  } else {
    expect(swap.effect.amountReceived).toBe(
      oldState.totalPrimary - newState.totalPrimary,
    );
    expect(swap.effect.amountDeposited).toBe(
      newState.totalSecondary - oldState.totalSecondary,
    );
  }

  expect(swap.effect.minimumAmountReceived).toBe(
    Math.ceil(
      swap.effect.amountReceived -
        swap.effect.amountReceived * (swap.slippagePct / 100),
    ),
  );

  const diff_ratio = swap.assetDeposited.ratio / swap.assetReceived.ratio;
  expect(swap.effect.price).toBe(
    ((swap.effect.amountReceived + swap.effect.fee) /
      swap.effect.amountDeposited) *
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
    const [primaryLiq, secondaryLiq, amount] = [10_000, 10_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.assetReceived).toBe(coin);
    expect(swap.assetDeposited).toBe(algo);
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
    expect(swapB.effect.amountReceived).toBeLessThan(
      swapA.effect.amountReceived,
    );

    // Perform the swaps and check if the simulated effect matches what really happened in the blockchain.

    const swapATxGroup = await swapA.prepareTxGroup(TestBedA.account.addr);
    await signAndSend(swapATxGroup, TestBedA.account);
    await TestBedA.pool.updateState();

    const swapBTxGroup = await swapB.prepareTxGroup(TestBedB.account.addr);
    await signAndSend(swapBTxGroup, TestBedB.account);
    await TestBedB.pool.updateState();

    expect(TestBedA.pool.state.totalSecondary).toBe(
      20_000 - swapA.effect.amountReceived,
    );
    expect(TestBedB.pool.state.totalSecondary).toBe(
      20_000 - swapB.effect.amountReceived,
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

    expect(swapA.effect.minimumAmountReceived).toBe(
      swapA.effect.amountReceived,
    );

    expect(swapB.effect.minimumAmountReceived).toBeLessThan(
      swapB.effect.amountReceived,
    );
    expect(swapB.effect.minimumAmountReceived).toBeGreaterThan(0);

    expect(swapC.effect.minimumAmountReceived).toBeLessThan(
      swapC.effect.amountReceived,
    );
    expect(swapC.effect.minimumAmountReceived).toBeLessThan(
      swapB.effect.minimumAmountReceived,
    );
    expect(swapC.effect.minimumAmountReceived).toBeGreaterThan(0);

    expect(swapD.effect.minimumAmountReceived).toBe(0);

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
    expect(pool.state.totalSecondary).toBe(20_000 - swap.effect.amountReceived); // no change yet

    // Swap C and D should pass;
    const swapCTxGroup = await swapC.prepareTxGroup(account.addr);
    await signAndSend(swapCTxGroup, account);
    await pool.updateState();
    const swappedCAmount =
      20_000 - swap.effect.amountReceived - pool.state.totalSecondary;
    expect(swappedCAmount).toBeLessThan(swapC.effect.amountReceived);
    expect(swappedCAmount).toBeGreaterThan(swapC.effect.minimumAmountReceived);

    const swapDTxGroup = await swapD.prepareTxGroup(account.addr);
    await signAndSend(swapDTxGroup, account);
    await pool.updateState();
    const swappedDAmount =
      20_000 -
      swap.effect.amountReceived -
      swappedCAmount -
      pool.state.totalSecondary;
    expect(swappedDAmount).toBeLessThan(swapD.effect.amountReceived);
    expect(swappedDAmount).toBeGreaterThan(swapD.effect.minimumAmountReceived);
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
      swapForExact: true,
    });

    expect(reversedSwap.assetReceived).toBe(coin);
    expect(reversedSwap.assetDeposited).toBe(algo);
    expect(reversedSwap.slippagePct).toBe(10);
    expect(reversedSwap.effect.amountReceived).toBe(1000);
    expect(reversedSwap.effect.amountDeposited).toBeGreaterThan(1000);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

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
      swapForExact: true,
    });

    expect(reversedSwap.effect.amountReceived).toBe(2000);

    const swap = pool.prepareSwap({
      amount: reversedSwap.effect.amountDeposited,
      asset: algo,
      slippagePct: 10,
    });

    expect(swap.effect.fee).toBe(reversedSwap.effect.fee);
    expect(swap.effect.amountDeposited).toBe(
      reversedSwap.effect.amountDeposited,
    );
    expect(swap.effect.amountReceived).toBe(reversedSwap.effect.amountReceived);

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
      amplifier: 10,
    });

    const aPrecision = 1000n;

    const params = pool.params as StableswapPoolParams;
    const swapCalculator = pool.calculator
      .swapCalculator as StableswapCalculator;

    let initialTime = params.initialATime;

    jest.useFakeTimers("modern");
    jest.setSystemTime(initialTime);

    expect(swapCalculator.getAmplifier()).toBe(10n * aPrecision);

    // Let's increase the amplifier.
    params.futureA = 20 * 1000;
    params.futureATime += 1000;

    const swapArgs: [bigint, bigint, bigint] = [2000n, 1500n, 1000n];

    expect(swapCalculator.getAmplifier()).toBe(10n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(933n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1084n);

    jest.setSystemTime(initialTime + 100);
    expect(swapCalculator.getAmplifier()).toBe(11n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(938n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1077n);

    jest.setSystemTime(initialTime + 500);
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(952n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1056n);

    jest.setSystemTime(initialTime + 1000);
    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1043n);

    jest.setSystemTime(initialTime + 2000);
    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);

    // Let's decrease the amplifier.
    params.initialA = params.futureA;
    params.initialATime = Date.now();
    params.futureA = 15 * 1000;
    params.futureATime = params.initialATime + 2000;
    initialTime = params.initialATime;

    expect(swapCalculator.getAmplifier()).toBe(20n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1043n);

    jest.setSystemTime(initialTime + 100);
    expect(swapCalculator.getAmplifier()).toBe(19750n);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(962n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1044n);

    jest.setSystemTime(initialTime + 1000);
    expect(swapCalculator.getAmplifier()).toBe(17500n);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(957n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1050n);

    jest.setSystemTime(initialTime + 2000);
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(952n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1056n);

    jest.setSystemTime(initialTime + 3000);
    expect(swapCalculator.getAmplifier()).toBe(15n * aPrecision);

    params.futureA = 100 * 1000;
    expect(swapCalculator.getAmplifier()).toBe(100n * aPrecision);
    expect(swapCalculator.getSwapGrossAmountReceived(...swapArgs)).toBe(992n);
    expect(swapCalculator.getSwapAmountDeposited(...swapArgs)).toBe(1008n);
  });

  it("swap with big amplifier", async () => {
    const { account, pool, algo } = await makeFreshTestBed({
      poolType: "STABLESWAP",
      amplifier: 200,
    });

    await addLiqudity(account, pool, 20000, 15000);

    const swap = pool.prepareSwap({
      amount: 1000,
      asset: algo,
      slippagePct: 0,
    });

    expect(swap.effect.amountReceived + swap.effect.fee).toBe(999);

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
