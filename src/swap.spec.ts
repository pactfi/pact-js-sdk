import algosdk from "algosdk";
import D, { Decimal } from "decimal.js";

import { Client } from "./client";
import { PoolState } from "./pool";
import { Swap } from "./swap";
import {
  addLiqudity,
  algod,
  createAsset,
  deployContract,
  makeFreshTestPool,
  newAccount,
  signSendAndWait,
} from "./testUtils";

async function testSwap(
  swap: Swap,
  primaryLiq: number,
  secondaryLiq: number,
  amountOut: number,
  account: algosdk.Account,
) {
  assertStats(swap, primaryLiq, secondaryLiq, amountOut);

  const oldState = swap.pool.state;
  const swapTx = await swap.prepareTx(account.addr);
  await signSendAndWait(swapTx, account);
  await swap.pool.updateState();

  assertPoolState(swap, oldState, swap.pool.state);
}

function assertStats(
  swap: Swap,
  primaryLiq: number,
  secondaryLiq: number,
  amountOut: number,
) {
  const [dPrimaryLiq, dSecondaryLiq, dAmountOut] = [
    new D(primaryLiq),
    new D(secondaryLiq),
    new D(amountOut),
  ];

  const feeBps = swap.pool.feeBps;
  let grossAmountIn: Decimal;

  if (swap.assetOut === swap.pool.primaryAsset) {
    grossAmountIn = dAmountOut
      .mul(dSecondaryLiq)
      .div(dPrimaryLiq.add(dAmountOut))
      .trunc();
  } else {
    grossAmountIn = dAmountOut
      .mul(dPrimaryLiq)
      .div(dSecondaryLiq.add(dAmountOut))
      .trunc();
  }
  const amountIn = grossAmountIn.mul(10_000 - feeBps).div(10_000);

  expect(swap.effect).toMatchObject({
    amountOut,
    amountIn: Math.floor(amountIn.toNumber()),
    minimumAmountIn: Math.floor(
      amountIn.sub(amountIn.mul(swap.slippagePct).div(100)).toNumber(),
    ),
    fee: Math.round(grossAmountIn.sub(amountIn).toNumber()),
    price: grossAmountIn.div(dAmountOut).toNumber(),
  });

  expect(swap.effect.amountOut * swap.effect.price - swap.effect.fee).toBe(
    swap.effect.amountIn,
  );
}

function assertPoolState(swap: Swap, oldState: PoolState, newState: PoolState) {
  expect(newState.primaryAssetPrice).toEqual(
    swap.effect.primaryAssetPriceAfterSwap,
  );
  expect(newState.secondaryAssetPrice).toEqual(
    swap.effect.secondaryAssetPriceAfterSwap,
  );

  // We use toFixed(5) to avoid numerical differences as tests don't use decimal calculations for simplicity.
  expect(swap.effect.primaryAssetPriceChangePct.toFixed(5)).toBe(
    (
      (newState.primaryAssetPrice / oldState.primaryAssetPrice) * 100 -
      100
    ).toFixed(5),
  );
  expect(swap.effect.secondaryAssetPriceChangePct.toFixed(5)).toBe(
    (
      (newState.secondaryAssetPrice / oldState.secondaryAssetPrice) * 100 -
      100
    ).toFixed(5),
  );

  if (swap.assetOut === swap.pool.primaryAsset) {
    expect(newState.totalPrimary - oldState.totalPrimary).toBe(
      swap.effect.amountOut,
    );
    expect(oldState.totalSecondary - newState.totalSecondary).toBe(
      swap.effect.amountIn,
    );
  } else {
    expect(oldState.totalPrimary - newState.totalPrimary).toBe(
      swap.effect.amountIn,
    );
    expect(newState.totalSecondary - oldState.totalSecondary).toBe(
      swap.effect.amountOut,
    );
  }
}

describe("swap", () => {
  it("empty liquidity", async () => {
    const { algo, pool } = await makeFreshTestPool();

    expect(() =>
      pool.prepareSwap({
        amount: 1000,
        asset: algo,
        slippagePct: 10,
      }),
    ).toThrow("Pool is empty and swaps are impossible.");
  });

  it("primary with equal liquidity", async () => {
    const { account, algo, coin, pool } = await makeFreshTestPool();
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

    await testSwap(swap, primaryLiq, secondaryLiq, amount, account);
  });

  it("primary with not equal liquidity", async () => {
    const { account, algo, pool } = await makeFreshTestPool();
    const [primaryLiq, secondaryLiq, amount] = [20_000, 25_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: algo,
      slippagePct: 10,
    });

    await testSwap(swap, primaryLiq, secondaryLiq, amount, account);
  });

  it("secondary with equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshTestPool();
    const [primaryLiq, secondaryLiq, amount] = [20_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10,
    });

    await testSwap(swap, primaryLiq, secondaryLiq, amount, account);
  });

  it("secondary with not equal liquidity", async () => {
    const { account, coin, pool } = await makeFreshTestPool();
    const [primaryLiq, secondaryLiq, amount] = [25_000, 20_000, 1_000];
    await addLiqudity(account, pool, primaryLiq, secondaryLiq);

    const swap = pool.prepareSwap({
      amount,
      asset: coin,
      slippagePct: 10,
    });

    await testSwap(swap, primaryLiq, secondaryLiq, amount, account);
  });

  it("with custom fee bps", async () => {
    const testPoolA = await makeFreshTestPool({ feeBps: 10 });
    const testPoolB = await makeFreshTestPool({ feeBps: 2000 });

    expect(testPoolA.pool.feeBps).toBe(10);
    expect(testPoolB.pool.feeBps).toBe(2000);

    await addLiqudity(testPoolA.account, testPoolA.pool, 20_000, 20_000);
    await addLiqudity(testPoolB.account, testPoolB.pool, 20_000, 20_000);

    const swapA = testPoolA.pool.prepareSwap({
      amount: 10_000,
      asset: testPoolA.algo,
      slippagePct: 10,
    });
    const swapB = testPoolB.pool.prepareSwap({
      amount: 10_000,
      asset: testPoolB.algo,
      slippagePct: 10,
    });

    expect(swapB.effect.price).toBe(swapA.effect.price);
    expect(swapB.effect.fee).toBeGreaterThan(swapA.effect.fee);
    expect(swapB.effect.amountIn).toBeLessThan(swapA.effect.amountIn);

    // Perform the swaps and check if the stats matches what really happened in the app.

    const swapATx = await swapA.prepareTx(testPoolA.account.addr);
    await signSendAndWait(swapATx, testPoolA.account);
    await testPoolA.pool.updateState();

    const swapBTx = await swapB.prepareTx(testPoolB.account.addr);
    await signSendAndWait(swapBTx, testPoolB.account);
    await testPoolB.pool.updateState();

    expect(testPoolA.pool.state.totalSecondary).toBe(
      20_000 - swapA.effect.amountIn,
    );
    expect(testPoolB.pool.state.totalSecondary).toBe(
      20_000 - swapB.effect.amountIn,
    );
  });

  it("with different slippage", async () => {
    const { account, algo, pool } = await makeFreshTestPool();
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
      slippagePct: 20,
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
    const swapTx = await swap.prepareTx(account.addr);
    await signSendAndWait(swapTx, account);

    // Swap A and B should fail because slippage is too low.
    const swapATx = await swapA.prepareTx(account.addr);
    expect(() => signSendAndWait(swapATx, account)).rejects.toMatchObject({
      status: 400,
    });
    const swapBTx = await swapB.prepareTx(account.addr);
    expect(() => signSendAndWait(swapBTx, account)).rejects.toMatchObject({
      status: 400,
    });

    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(20_000 - swap.effect.amountIn); // no change yet

    // Swap C and D should pass;
    const swapCTx = await swapC.prepareTx(account.addr);
    await signSendAndWait(swapCTx, account);
    await pool.updateState();
    const swappedCAmount =
      20_000 - swap.effect.amountIn - pool.state.totalSecondary;
    expect(swappedCAmount).toBeLessThan(swapC.effect.amountIn);
    expect(swappedCAmount).toBeGreaterThan(swapC.effect.minimumAmountIn);

    const swapDTx = await swapD.prepareTx(account.addr);
    await signSendAndWait(swapDTx, account);
    await pool.updateState();
    const swappedDAmount =
      20_000 -
      swap.effect.amountIn -
      swappedCAmount -
      pool.state.totalSecondary;
    expect(swappedDAmount).toBeLessThan(swapD.effect.amountIn);
    expect(swappedDAmount).toBeGreaterThan(swapD.effect.minimumAmountIn);
  });

  it("ASA to ASA", async () => {
    const account = await newAccount();
    const client = new Client(algod);

    const coinAIndex = await createAsset(account, "COIN_A", 3);
    const coinA = await client.fetchAsset(coinAIndex);

    const coinBIndex = await createAsset(account, "COIN_B", 2);
    const coinB = await client.fetchAsset(coinBIndex);

    const appId = await deployContract(account, coinA, coinB);
    const pool = await client.fetchPool(coinA, coinB, { appId });

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
      asset: coinA,
      slippagePct: 10,
    });
    await testSwap(swap, 20_000, 20_000, 1000, account);
  });
});
