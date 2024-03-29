import { PactClient } from "./client";
import { addLiquidity, makeFreshPoolTestbed } from "./testPoolUtils";
import { algod, createAsset, signAndSend } from "./testUtils";

describe("zap", () => {
  it("Calculates all zap params", async () => {
    const { pool, account } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      feeBps: 30,
      pactFeeBps: 10,
    });

    await addLiquidity(account, pool, 100_000, 100_000);
    await pool.updateState();

    // Perform a zap using primary asset.
    const zapPrimaryAdd = pool.prepareZap({
      amount: 10_000,
      asset: pool.primaryAsset,
      slippagePct: 2,
    });
    expect(zapPrimaryAdd.params).toEqual({
      swapDeposited: 4888n,
      primaryAddLiq: 5112n,
      secondaryAddLiq: 4645n,
    });
    expect(
      zapPrimaryAdd.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(4871);

    // Perform a zap using secondary asset.
    const zapSecondaryAdd = pool.prepareZap({
      amount: 10_000,
      asset: pool.secondaryAsset,
      slippagePct: 2,
    });
    expect(zapSecondaryAdd.params).toEqual({
      swapDeposited: 4888n,
      primaryAddLiq: 4645n,
      secondaryAddLiq: 5112n,
    });
    expect(
      zapSecondaryAdd.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(4871);

    // Perform a zap on unbalanced pool.
    const { pool: unbalancedPool, account: acc2 } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
      feeBps: 30,
      pactFeeBps: 10,
    });

    await addLiquidity(acc2, unbalancedPool, 100_000, 10_000);
    await unbalancedPool.updateState();

    const unbalancedZap = unbalancedPool.prepareZap({
      amount: 20_000,
      asset: unbalancedPool.secondaryAsset,
      slippagePct: 2,
    });

    expect(unbalancedZap.params).toEqual({
      swapDeposited: 7336n,
      primaryAddLiq: 42188n,
      secondaryAddLiq: 12664n,
    });
    expect(
      unbalancedZap.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(23093);

    const unbalancedZapSecondary = unbalancedPool.prepareZap({
      amount: 1_000_000,
      asset: unbalancedPool.primaryAsset,
      slippagePct: 2,
    });
    expect(unbalancedZapSecondary.params).toEqual({
      swapDeposited: 232549n,
      primaryAddLiq: 767451n,
      secondaryAddLiq: 6970n,
    });
    expect(
      unbalancedZapSecondary.liquidityAddition.effect.mintedLiquidityTokens,
    ).toEqual(72909);
  });

  it("Validates pools and assets", async () => {
    // Zap should not be possible on Stableswaps.
    const { pool: stablePool } = await makeFreshPoolTestbed({
      poolType: "STABLESWAP",
    });
    expect(() =>
      stablePool.prepareZap({
        amount: 10_000,
        asset: stablePool.primaryAsset,
        slippagePct: 1,
      }),
    ).toThrow("Zap can only be made on constant product pools.");

    // Zap should throw an error when wrong asset is passed.
    const { pool, account, algo } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });
    const pact = new PactClient(algod);
    const coinXIndex = await createAsset(account, {
      name: "COIN_X",
      decimals: 6,
    });
    const coinX = await pact.fetchAsset(coinXIndex);

    expect(() =>
      pool.prepareZap({
        amount: 1_000,
        asset: coinX,
        slippagePct: 10,
      }),
    ).toThrow("Provided asset was not found in the pool.");

    // Zap should not be possible on empty pools.
    expect(() =>
      pool.prepareZap({
        amount: 1_000,
        asset: algo,
        slippagePct: 10,
      }),
    ).toThrowError("Cannot create a Zap on empty pool.");
  });

  it("Prepares tx group that can be signed and sent", async () => {
    const { pool, account } = await makeFreshPoolTestbed({
      poolType: "CONSTANT_PRODUCT",
    });

    await addLiquidity(account, pool, 100_000, 100_000);
    await pool.updateState();
    const zapAmount = 10_000;

    const zap = pool.prepareZap({
      amount: zapAmount,
      asset: pool.primaryAsset,
      slippagePct: 2,
    });
    expect(zap.params.swapDeposited + zap.params.primaryAddLiq).toBe(
      BigInt(zapAmount),
    );
    const suggestedParams = await algod.getTransactionParams().do();

    // Txs can be made by using single function from Zap object or by building them from provided swap and liquidity addition.
    const zapTxGroup = await zap.prepareTxGroup(account.addr);
    const selfBuildZapTxs = [
      ...pool.buildSwapTxs({
        swap: zap.swap,
        address: account.addr,
        suggestedParams,
      }),
      ...pool.buildAddLiquidityTxs({
        liquidityAddition: zap.liquidityAddition,
        address: account.addr,
        suggestedParams,
      }),
    ];

    expect(zapTxGroup.transactions.length).toBe(5);
    expect(
      zapTxGroup.transactions.map((t) => ({ ...t, group: undefined })),
    ).toEqual(selfBuildZapTxs);

    await signAndSend(zapTxGroup, account);
    await pool.updateState();

    expect(pool.state).toEqual({
      primaryAssetPrice: 0.9090983472426772,
      secondaryAssetPrice: 1.099990999909999,
      totalLiquidity: 104871,
      totalPrimary: 109998,
      totalSecondary: 99999,
    });
  });
});
