import { LendingSwap } from "./folksLendingPool";
import {
  LendingPoolAdapterTestBed,
  makeFreshLendingPoolTestbed,
} from "./testLendingPoolUtils";
import { signAndSend } from "./testUtils";

async function assertSwap(
  testbed: LendingPoolAdapterTestBed,
  swap: LendingSwap,
) {
  const oldState = testbed.lendingPoolAdapter.pactPool.state;
  const oldPrimaryHolding = await testbed.algo.getHolding(testbed.account.addr);
  const oldSecondaryHolding = await testbed.originalAsset.getHolding(
    testbed.account.addr,
  );

  const txGroup = await testbed.lendingPoolAdapter.prepareSwapTxGroup({
    swap,
    address: testbed.account.addr,
  });
  await signAndSend(txGroup, testbed.account);

  await testbed.lendingPoolAdapter.pactPool.updateState();

  const newState = testbed.lendingPoolAdapter.pactPool.state;
  const newPrimaryHolding = await testbed.algo.getHolding(testbed.account.addr);
  const newSecondaryHolding = await testbed.originalAsset.getHolding(
    testbed.account.addr,
  );

  if (swap.assetDeposited.index === testbed.algo.index) {
    expect(Math.abs(newState.totalPrimary - oldState.totalPrimary)).toBe(
      swap.fSwap.effect.amountDeposited,
    );
    expect(Math.abs(oldState.totalSecondary - newState.totalSecondary)).toBe(
      swap.fSwap.effect.minimumAmountReceived,
    );

    expect(Math.abs(oldPrimaryHolding! - newPrimaryHolding!)).toBe(
      swap.amountDeposited + swap.txFee,
    );
    expect(Math.abs(newSecondaryHolding! - oldSecondaryHolding!)).toBe(
      swap.minimumAmountReceived,
    );
  } else {
    expect(Math.abs(oldState.totalSecondary - newState.totalSecondary)).toBe(
      swap.fSwap.effect.amountDeposited,
    );
    expect(Math.abs(newState.totalPrimary - oldState.totalPrimary)).toBe(
      swap.fSwap.effect.minimumAmountReceived,
    );

    expect(Math.abs(newSecondaryHolding! - oldSecondaryHolding!)).toBe(
      swap.amountDeposited,
    );
    expect(Math.abs(oldPrimaryHolding! - newPrimaryHolding!)).toBe(
      Math.abs(swap.minimumAmountReceived - swap.txFee),
    );
  }
}

describe("FolksLendingPool", () => {
  it("add and remove liquidity", async () => {
    const testbed = await makeFreshLendingPoolTestbed();

    // Add liquidity
    const lendingLiquidityAddition =
      await testbed.lendingPoolAdapter.prepareAddLiquidity({
        primaryAssetAmount: 100_000,
        secondaryAssetAmount: 50_000,
        slippagePct: 0,
      });
    let txGroup = await testbed.lendingPoolAdapter.prepareAddLiquidityTxGroup({
      address: testbed.account.addr,
      liquidityAddition: lendingLiquidityAddition,
    });

    await signAndSend(txGroup, testbed.account);

    await testbed.lendingPoolAdapter.pactPool.updateState();
    // Check tokens deposited in Folks contracts.
    expect(
      await testbed.lendingPoolAdapter.primaryLendingPool.originalAsset.getHolding(
        testbed.lendingPoolAdapter.primaryLendingPool.escrowAddress,
      ),
    ).toBe(100_000 + 300_000); // (+ min balance ALGO)
    expect(
      await testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset.getHolding(
        testbed.lendingPoolAdapter.secondaryLendingPool.escrowAddress,
      ),
    ).toBe(50_000);

    const poolLiqudityAddition = lendingLiquidityAddition.liquidityAddition;
    expect(poolLiqudityAddition.primaryAssetAmount).toBe(96674);
    expect(poolLiqudityAddition.secondaryAssetAmount).toBe(49860);

    // Check Pact pool state.
    expect(testbed.lendingPoolAdapter.pactPool.state.totalPrimary).toBe(
      poolLiqudityAddition.primaryAssetAmount,
    );
    expect(testbed.lendingPoolAdapter.pactPool.state.totalSecondary).toBe(
      poolLiqudityAddition.secondaryAssetAmount,
    );

    // Check LP the user received.
    expect(
      await testbed.lendingPoolAdapter.pactPool.liquidityAsset.getHolding(
        testbed.account.addr,
      ),
    ).toBe(poolLiqudityAddition.effect.mintedLiquidityTokens - 1000); // - blocked LP for first liquidity

    // Remove
    txGroup = await testbed.lendingPoolAdapter.prepareRemoveLiquidityTxGroup({
      address: testbed.account.addr,
      amount: 20_000,
    });
    await signAndSend(txGroup, testbed.account);

    await testbed.lendingPoolAdapter.pactPool.updateState();
    expect(testbed.lendingPoolAdapter.pactPool.state.totalLiquidity).toBe(
      poolLiqudityAddition.effect.mintedLiquidityTokens - 20_000,
    );
  });

  it("swap primary exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000,
      asset: testbed.lendingPoolAdapter.primaryLendingPool.originalAsset,
      slippagePct: 0,
    });

    expect(swap.amountDeposited).toBe(10_000);
    expect(swap.fSwap.effect.amountDeposited).toBe(9667);
    expect(swap.amountReceived).toBe(4530);
    expect(swap.fSwap.effect.amountReceived).toBe(4518);

    await assertSwap(testbed, swap);
  });

  it("swap secondary exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000,
      asset: testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset,
      slippagePct: 0,
    });

    expect(swap.amountDeposited).toBe(10_000);
    expect(swap.fSwap.effect.amountDeposited).toBe(9972);
    expect(swap.amountReceived).toBe(16615);
    expect(swap.fSwap.effect.amountReceived).toBe(16063);

    await assertSwap(testbed, swap);
  });

  it("swap primary for exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000,
      asset: testbed.lendingPoolAdapter.primaryLendingPool.originalAsset,
      slippagePct: 0,
      swapForExact: true,
    });

    expect(swap.amountDeposited).toBe(25098);
    expect(swap.fSwap.effect.amountDeposited).toBe(24263);
    expect(swap.amountReceived).toBe(10_000);
    expect(swap.fSwap.effect.amountReceived).toBe(9972);

    await assertSwap(testbed, swap);
  });

  it("swap secondary for exact", async () => {
    const testbed = await makeFreshLendingPoolTestbed();
    await testbed.addLiquidity(100_000, 50_000);

    const swap = await testbed.lendingPoolAdapter.prepareSwap({
      amount: 10_000,
      asset: testbed.lendingPoolAdapter.secondaryLendingPool.originalAsset,
      slippagePct: 0,
      swapForExact: true,
    });

    expect(swap.amountDeposited).toBe(5575);
    expect(swap.fSwap.effect.amountDeposited).toBe(5559);
    expect(swap.amountReceived).toBe(10_000);
    expect(swap.fSwap.effect.amountReceived).toBe(9667);

    await assertSwap(testbed, swap);
  });
});
