import algosdk from "algosdk";

import { LiquidityAddition } from "./addLiquidity";
import { Pool, PoolType } from "./pool";
import { addLiquidity, makeFreshPoolTestbed } from "./testPoolUtils";
import { signAndSend } from "./testUtils";

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

  expect(liquidityAddition.effect.bonusPct.toFixed(1)).toBe(
    realBonusPct.toFixed(1),
  );
}

function swapTestCase(poolType: PoolType) {
  it("Empty pool add equal liquidity", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
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
    const { account, pool } = await makeFreshPoolTestbed({
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
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });

    await addLiquidity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [10_000, 10_000];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Not an empty pool add not equal liquidity", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: poolType,
    });

    await addLiquidity(account, pool, 50_000, 60_000);

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

describe("nft constant product add/remove liquidity", () => {
  swapTestCase("NFT_CONSTANT_PRODUCT");

  it("Remove full liquidity", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: "NFT_CONSTANT_PRODUCT",
    });

    // Add liquidity and optin to
    const optinTx = await pool.liquidityAsset.prepareOptInTx(account.addr);
    await signAndSend(optinTx, account);

    const [primaryAssetAmount, secondaryAssetAmount] = [100000, 100000];
    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });
    await testAddLiquidity(liquidityAddition, account);

    const oldState = pool.state;
    // Remove liquidity
    const removeLiquidityGroup = await pool.prepareRemoveLiquidityTxGroup({
      address: account.addr,
      amount: liquidityAddition.effect.mintedLiquidityTokens,
    });
    await signAndSend(removeLiquidityGroup, account);

    await pool.updateState();
    const newState = pool.state;

    expect(oldState.totalPrimary).toBe(100000);
    expect(oldState.totalSecondary).toBe(100000);
    expect(newState.totalPrimary).toBe(0);
    expect(newState.totalSecondary).toBe(0);
  });
});

describe("stableswap add liquidity", () => {
  swapTestCase("STABLESWAP");

  it("Add only primary asset", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
    });

    await addLiquidity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [30_000, 0];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
  });

  it("Add only secondary asset", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
    });

    await addLiquidity(account, pool, 50_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [0, 10_000];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
    await assertStableswapBonus(pool, account, liquidityAddition);

    expect(liquidityAddition.effect.bonusPct).toBeLessThan(0);
  });

  it("Add with a positive bonus", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
    });

    await addLiquidity(account, pool, 10_000, 60_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [50_000, 0];

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount,
      secondaryAssetAmount,
    });

    await testAddLiquidity(liquidityAddition, account);
    await assertStableswapBonus(pool, account, liquidityAddition);

    expect(liquidityAddition.effect.bonusPct).toBeGreaterThan(0);
  });

  it("pool liquidity too low to cover fee", async () => {
    const { account, pool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
      feeBps: 1000,
    });

    await addLiquidity(account, pool, 1000, 100_000);

    const [primaryAssetAmount, secondaryAssetAmount] = [0, 1_000_000_000];

    expect(() =>
      pool.prepareAddLiquidity({
        primaryAssetAmount,
        secondaryAssetAmount,
      }),
    ).toThrow("Pool liquidity too low to cover add liquidity fee.");
  });
});
