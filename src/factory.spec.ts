import { PactClient } from "./client";
import { PoolBuildParams, PoolParams } from "./factories";
import { deployFactoryContract } from "./testFactoryUtils";
import { algod, createAsset, newAccount } from "./testUtils";

describe("factory", () => {
  it("deploy constant product pool", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, { factoryConstantProductId: factoryId });

    const algo = await pact.fetchAsset(0);
    const coin = await pact.fetchAsset(await createAsset(admin));

    const factory = await pact.getConstantProductPoolFactory();

    // Validate fee bps.
    await expect(
      factory.build(
        admin.addr,
        {
          primaryAssetId: algo.index,
          secondaryAssetId: coin.index,
          feeBps: 200,
        },
        (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
      ),
    ).rejects.toThrow("Only one of 100,30,5,2 is allowed for feeBps.");

    // Build the pool.
    const pool = await factory.build(
      admin.addr,
      {
        primaryAssetId: algo.index,
        secondaryAssetId: coin.index,
        feeBps: 100,
      },
      (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
    );

    expect(pool.poolType).toBe("CONSTANT_PRODUCT");
    expect(pool.version).toBe(201);
    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coin.index);
    expect(pool.feeBps).toBe(100);
    expect(pool.params.pactFeeBps).toBe(10);

    // Validate that the pool is functional. Let's add some liquidity.

    const optInTx = await pool.liquidityAsset.prepareOptInTx(admin.addr);
    await algod.sendRawTransaction(optInTx.signTxn(admin.sk)).do();

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 1000,
      secondaryAssetAmount: 2000,
      slippagePct: 0,
    });
    const txGroup = await pool.prepareAddLiquidityTxGroup({
      address: admin.addr,
      liquidityAddition,
    });

    await algod.sendRawTransaction(txGroup.signTxn(admin.sk)).do();

    await pool.updateState();
    expect(pool.state.totalPrimary).toBe(1000);
    expect(pool.state.totalSecondary).toBe(2000);
  });

  it("deploy NFT constant product pool", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "NFT_CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, {
      factoryNftConstantProductId: factoryId,
    });

    const algo = await pact.fetchAsset(0);
    const coin = await pact.fetchAsset(
      await createAsset(admin, {
        name: "COIN",
        decimals: 0,
        totalIssuance: 1000,
      }),
    );

    const factory = await pact.getNftConstantProductPoolFactory();

    // Validate fee bps.
    await expect(
      factory.build(
        admin.addr,
        {
          primaryAssetId: algo.index,
          secondaryAssetId: coin.index,
          feeBps: 100,
        },
        (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
      ),
    ).rejects.toThrow("Only one of 350 is allowed for feeBps.");

    // Build the pool.
    const pool = await factory.build(
      admin.addr,
      {
        primaryAssetId: algo.index,
        secondaryAssetId: coin.index,
        feeBps: 350,
      },
      (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
    );

    expect(pool.poolType).toBe("NFT_CONSTANT_PRODUCT");
    expect(pool.version).toBe(201);
    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coin.index);
    expect(pool.feeBps).toBe(350);
    expect(pool.params.pactFeeBps).toBe(170);

    // Validate that the pool is functional. Let's add some liquidity.

    const optInTx = await pool.liquidityAsset.prepareOptInTx(admin.addr);
    await algod.sendRawTransaction(optInTx.signTxn(admin.sk)).do();

    const liquidityAddition = pool.prepareAddLiquidity({
      primaryAssetAmount: 10_000,
      secondaryAssetAmount: 500,
      slippagePct: 0,
    });
    const txGroup = await pool.prepareAddLiquidityTxGroup({
      address: admin.addr,
      liquidityAddition,
    });

    await algod.sendRawTransaction(txGroup.signTxn(admin.sk)).do();

    await pool.updateState();
    expect(pool.state.totalPrimary).toBe(10_000);
    expect(pool.state.totalSecondary).toBe(500);
  });

  it("deploy pool as normal user", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, { factoryConstantProductId: factoryId });

    const user = await newAccount();
    const algo = await pact.fetchAsset(0);
    const coin = await pact.fetchAsset(await createAsset(admin));

    const factory = await pact.getConstantProductPoolFactory();
    const poolBuildParams: PoolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coin.index,
      feeBps: 100,
    };
    const pool = await factory.build(user.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(user.sk)),
    );

    expect(pool.poolType).toBe("CONSTANT_PRODUCT");
    expect(pool.version).toBe(201);
  });

  it("deploy contant product pool with different params and list the pools", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, { factoryConstantProductId: factoryId });

    const algo = await pact.fetchAsset(0);
    const coinA = await pact.fetchAsset(await createAsset(admin));
    const coinB = await pact.fetchAsset(await createAsset(admin));

    const factory = await pact.getConstantProductPoolFactory();

    // ALGO/COIN_A 0.02%
    let poolBuildParams: PoolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coinA.index,
      feeBps: 2,
    };
    let pool = await factory.build(admin.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coinA.index);
    expect(pool.feeBps).toBe(2);
    expect(pool.params.pactFeeBps).toBe(1);

    // ALGO/COIN_A 0.05%
    poolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coinA.index,
      feeBps: 5,
    };
    pool = await factory.build(admin.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coinA.index);
    expect(pool.feeBps).toBe(5);
    expect(pool.params.pactFeeBps).toBe(2);

    // ALGO/COIN_A 0.3%
    poolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coinA.index,
      feeBps: 30,
    };
    pool = await factory.build(admin.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coinA.index);
    expect(pool.feeBps).toBe(30);
    expect(pool.params.pactFeeBps).toBe(5);

    // COIN_A/COIN_B 0.05%
    poolBuildParams = {
      primaryAssetId: coinA.index,
      secondaryAssetId: coinB.index,
      feeBps: 5,
    };
    pool = await factory.build(admin.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(pool.primaryAsset.index).toBe(coinA.index);
    expect(pool.secondaryAsset.index).toBe(coinB.index);
    expect(pool.feeBps).toBe(5);
    expect(pool.params.pactFeeBps).toBe(2);

    // Cannot create a second pool with the same params.
    poolBuildParams = {
      primaryAssetId: coinA.index,
      secondaryAssetId: coinB.index,
      feeBps: 5,
    };
    await expect(
      async () =>
        await factory.build(admin.addr, poolBuildParams, (txGroup) =>
          Promise.resolve(txGroup.signTxn(admin.sk)),
        ),
    ).rejects.toThrow("logic eval error");

    // Forbidden fee.
    poolBuildParams = {
      primaryAssetId: coinA.index,
      secondaryAssetId: coinB.index,
      feeBps: 200,
    };
    await expect(
      async () =>
        await factory.build(admin.addr, poolBuildParams, (txGroup) =>
          Promise.resolve(txGroup.signTxn(admin.sk)),
        ),
    ).rejects.toThrow("Only one of 100,30,5,2 is allowed for feeBps.");

    // List the pools.
    const pools = await factory.listPools();

    // The order of pools is undefined. Let's sort so that we can make an assertion.
    pools.sort((a, b) => {
      const idDiff = a.primaryAssetId - b.primaryAssetId;
      if (idDiff === 0) {
        return a.feeBps - b.feeBps;
      }
      return idDiff;
    });
    expect(pools).toEqual([
      {
        primaryAssetId: 0,
        secondaryAssetId: coinA.index,
        feeBps: 2,
        version: 201,
      },
      {
        primaryAssetId: 0,
        secondaryAssetId: coinA.index,
        feeBps: 5,
        version: 201,
      },
      {
        primaryAssetId: 0,
        secondaryAssetId: coinA.index,
        feeBps: 30,
        version: 201,
      },
      {
        primaryAssetId: coinA.index,
        secondaryAssetId: coinB.index,
        feeBps: 5,
        version: 201,
      },
    ]);
  });

  it("fetch pool", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, { factoryConstantProductId: factoryId });

    const algo = await pact.fetchAsset(0);
    const coin = await pact.fetchAsset(await createAsset(admin));

    const factory = await pact.getConstantProductPoolFactory();

    const poolBuildParams: PoolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coin.index,
      feeBps: 100,
    };
    const pool = await factory.build(admin.addr, poolBuildParams, (txGroup) =>
      Promise.resolve(txGroup.signTxn(admin.sk)),
    );

    let poolParams: PoolParams = {
      ...poolBuildParams,
      version: factory.state.poolVersion,
    };
    expect((await factory.fetchPool(poolParams))!.appId).toBe(pool.appId);

    poolParams = { ...poolParams, feeBps: 30 };
    expect(await factory.fetchPool(poolParams)).toBe(null);
  });

  it("build or get", async () => {
    const admin = await newAccount();
    const factoryId = await deployFactoryContract(
      admin,
      "CONSTANT_PRODUCT",
      admin.addr,
    );
    const pact = new PactClient(algod, { factoryConstantProductId: factoryId });

    const algo = await pact.fetchAsset(0);
    const coin = await pact.fetchAsset(await createAsset(admin));

    const factory = await pact.getConstantProductPoolFactory();

    const poolBuildParams: PoolBuildParams = {
      primaryAssetId: algo.index,
      secondaryAssetId: coin.index,
      feeBps: 100,
    };

    // Create the pool.
    const [pool, created] = await factory.buildOrGet(
      admin.addr,
      poolBuildParams,
      (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(created).toBe(true);
    expect(pool.poolType).toBe("CONSTANT_PRODUCT");

    // Try to create a second pool.
    const [anotherPool, anotherCreated] = await factory.buildOrGet(
      admin.addr,
      poolBuildParams,
      (txGroup) => Promise.resolve(txGroup.signTxn(admin.sk)),
    );
    expect(anotherCreated).toBe(false);
    expect(anotherPool.appId).toBe(pool.appId);
  });
});
