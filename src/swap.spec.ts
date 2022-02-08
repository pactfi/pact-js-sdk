import algosdk from "algosdk";
import D, { Decimal } from "decimal.js";

import { PactClient } from "./client";
import { PoolState } from "./pool";
import { Swap } from "./swap";
import {
  addLiqudity,
  algod,
  createAsset,
  deployContract,
  makeFreshTestBed,
  newAccount,
  signAndSend,
} from "./testUtils";

async function testSwap(
  swap: Swap,
  primaryLiq: number,
  secondaryLiq: number,
  amountOut: number,
  account: algosdk.Account,
) {
  assertSwapEffect(swap, primaryLiq, secondaryLiq, amountOut);

  // Perform the swap.
  const oldState = swap.pool.state;
  const swapTx = await swap.prepareTx(account.addr);
  await signAndSend(swapTx, account);
  await swap.pool.updateState();

  // Compare the simulated effect with what really happened on the blockchain.
  assertPoolState(swap, oldState, swap.pool.state);
}

function assertSwapEffect(
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
    price: grossAmountIn
      .div(swap.assetIn.ratio)
      .div(dAmountOut.div(swap.assetOut.ratio))
      .toNumber(),
  });

  const diffRatio = 10 ** (swap.assetIn.decimals - swap.assetOut.decimals);
  expect(
    swap.effect.amountOut * swap.effect.price * diffRatio - swap.effect.fee,
  ).toBe(swap.effect.amountIn);
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
    const { algo, pool } = await makeFreshTestBed();

    expect(() =>
      pool.prepareSwap({
        amount: 1000,
        asset: algo,
        slippagePct: 10,
      }),
    ).toThrow("Pool is empty and swaps are impossible.");
  });

  it("asset not in the pool", async () => {
    const { pact, pool, account } = await makeFreshTestBed();
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
    const { account, algo, coin, pool } = await makeFreshTestBed();
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
    const { account, algo, pool } = await makeFreshTestBed();
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
    const { account, coin, pool } = await makeFreshTestBed();
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
    const { account, coin, pool } = await makeFreshTestBed();
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
    const TestBedA = await makeFreshTestBed({ feeBps: 10 });
    const TestBedB = await makeFreshTestBed({ feeBps: 2000 });

    expect(TestBedA.pool.feeBps).toBe(10);
    expect(TestBedB.pool.feeBps).toBe(2000);

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

    const swapATx = await swapA.prepareTx(TestBedA.account.addr);
    await signAndSend(swapATx, TestBedA.account);
    await TestBedA.pool.updateState();

    const swapBTx = await swapB.prepareTx(TestBedB.account.addr);
    await signAndSend(swapBTx, TestBedB.account);
    await TestBedB.pool.updateState();

    expect(TestBedA.pool.state.totalSecondary).toBe(
      20_000 - swapA.effect.amountIn,
    );
    expect(TestBedB.pool.state.totalSecondary).toBe(
      20_000 - swapB.effect.amountIn,
    );
  });

  it("with different slippage", async () => {
    const { account, algo, pool } = await makeFreshTestBed();
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
    await signAndSend(swapTx, account);

    // Swap A and B should fail because slippage is too low.
    const swapATx = await swapA.prepareTx(account.addr);
    expect(() => signAndSend(swapATx, account)).rejects.toMatchObject({
      status: 400,
    });
    const swapBTx = await swapB.prepareTx(account.addr);
    expect(() => signAndSend(swapBTx, account)).rejects.toMatchObject({
      status: 400,
    });

    await pool.updateState();
    expect(pool.state.totalSecondary).toBe(20_000 - swap.effect.amountIn); // no change yet

    // Swap C and D should pass;
    const swapCTx = await swapC.prepareTx(account.addr);
    await signAndSend(swapCTx, account);
    await pool.updateState();
    const swappedCAmount =
      20_000 - swap.effect.amountIn - pool.state.totalSecondary;
    expect(swappedCAmount).toBeLessThan(swapC.effect.amountIn);
    expect(swappedCAmount).toBeGreaterThan(swapC.effect.minimumAmountIn);

    const swapDTx = await swapD.prepareTx(account.addr);
    await signAndSend(swapDTx, account);
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
    const pact = new PactClient(algod);

    const coinAIndex = await createAsset(account, "COIN_A", 3);
    const coinA = await pact.fetchAsset(coinAIndex);

    const coinBIndex = await createAsset(account, "COIN_B", 2);
    const coinB = await pact.fetchAsset(coinBIndex);

    const appId = await deployContract(account, coinA, coinB);
    const pool = await pact.fetchPool(coinA, coinB, { appId });

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
