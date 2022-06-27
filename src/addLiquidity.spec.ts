import algosdk from "algosdk";

import { LiquidityAddition } from "./addLiquidity";
import { Pool, PoolType } from "./pool";
import { addLiqudity, makeFreshTestBed, signAndSend } from "./testUtils";

async function testAddLiquidity(
  liquidityAddition: LiquidityAddition,
  account: algosdk.Account,
) {
  // Perform adding liquidity.
  const oldState = liquidityAddition.pool.state;
  const swapTxGroup = await liquidityAddition.prepareTxGroup(account.addr);
  await signAndSend(swapTxGroup, account);
  await liquidityAddition.pool.updateState();

  // Compare the simulated effect with what really happened on the blockchain.
  const newState = liquidityAddition.pool.state;
  const mintedTokens = newState.totalLiquidity - oldState.totalLiquidity;
  expect(liquidityAddition.effect.mintedLiquidityTokens).toBe(mintedTokens);
}

async function assertStableswapBonus(
  pool: Pool,
  account: algosdk.Account,
  liquidityAddition: LiquidityAddition,
) {
  // Removes liquidity, calculates a real bonus and compares it with a simulation.
  const oldState = pool.state;

  const removeLiquidityGroup = await pool.prepareRemoveLiquidityTxGroup({
    address: account.addr,
    amount: liquidityAddition.effect.mintedLiquidityTokens,
  });
  await signAndSend(removeLiquidityGroup, account);

  await pool.updateState();
  const newState = pool.state;

  const received =
    oldState.totalPrimary -
    newState.totalPrimary +
    (oldState.totalSecondary - newState.totalSecondary);

  const totalAdded =
    liquidityAddition.primaryAssetAmount +
    liquidityAddition.secondaryAssetAmount;
  const realBonusPct = ((received - totalAdded) / totalAdded) * 100;

  expect(liquidityAddition.effect.bonusPct.toFixed(2)).toBe(
    realBonusPct.toFixed(2),
  );
}

function swapTestCase(poolType: PoolType) {
  it("Empty pool add equal liquidity", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryAssetAmount, secondaryAssetAmount] = [10_000, 10_000];

    const optInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
    await signAndSend(optInTx, account);

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Empty pool add not equal liquidity", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: poolType,
    });
    const [primaryAssetAmount, secondaryAssetAmount] = [30_000, 10_000];

    const optInTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
    await signAndSend(optInTx, account);

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Not an empty pool add equal liquidity", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: poolType,
    });

    await addLiqudity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [10_000, 10_000];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Not an empty pool add not equal liquidity", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: poolType,
    });

    await addLiqudity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [30_000, 10_000];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });
}

describe("constant product add liquidity", () => {
  swapTestCase("CONSTANT_PRODUCT");
});

describe("stableswap add liquidity", () => {
  swapTestCase("STABLESWAP");

  it("Add only primary asset", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: "STABLESWAP",
    });

    await addLiqudity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [30_000, 0];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Add only secondary asset", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: "STABLESWAP",
    });

    await addLiqudity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [0, 30_000];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
    await assertStableswapBonus(pool, account, liquidityAddition);

    expect(liquidityAddition.effect.bonusPct).toBeLessThan(0);
  });

  it("Add with a positive bonus", async () => {
    const { account, pool } = await makeFreshTestBed({
      poolType: "STABLESWAP",
    });

    await addLiqudity(account, pool, 10_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [50_000, 0];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
    await assertStableswapBonus(pool, account, liquidityAddition);

    expect(liquidityAddition.effect.bonusPct).toBeGreaterThan(0);
  });
});
