import { Asset } from "./asset";
import { Client } from "./client";
import {
  EXCHANGE_APP_ID,
  EXCHANGE_LIQUIDITY_ID,
  ROOT_ACCOUNT,
  getClientParams,
  signSendAndWait,
} from "./testUtils";

const POOL_DATA = [
  {
    appid: EXCHANGE_APP_ID.toString(),
    primary_asset: { algoid: "0" },
    secondary_asset: { algoid: "1" },
  },
];

jest.mock("./crossFetch", () => {
  return {
    crossFetch: () => Promise.resolve(POOL_DATA),
  };
});

describe("Pool", () => {
  it("fetching pool from api", async () => {
    const client = new Client(getClientParams());

    const algo = await client.fetchAsset(0);
    const coin = await client.fetchAsset(1);

    const pool = await client.fetchPool(algo, coin);

    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coin.index);
    expect(pool.liquidityAsset.index).toBe(EXCHANGE_LIQUIDITY_ID);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(EXCHANGE_APP_ID);
  });

  it("fetching not existing pool from api", async () => {
    const client = new Client(getClientParams());

    const algo = await client.fetchAsset(0);
    const coin = new Asset(client.algod, 2);

    await expect(() => client.fetchPool(algo, coin)).rejects.toBe(
      "Cannot find pool for assets 0 and 2.",
    );
  });

  it("fetching pool by providing appid", async () => {
    const client = new Client(getClientParams());

    const algo = await client.fetchAsset(0);
    const coin = await client.fetchAsset(1);

    const pool = await client.fetchPool(algo, coin, { appId: EXCHANGE_APP_ID });

    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coin.index);
    expect(pool.liquidityAsset.index).toBe(EXCHANGE_LIQUIDITY_ID);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(EXCHANGE_APP_ID);
  });

  it("fetching pool with reversed assets", async () => {
    const client = new Client(getClientParams());

    const algo = await client.fetchAsset(0);
    const coin = await client.fetchAsset(1);

    // We reverse the assets order here.
    const pool = await client.fetchPool(coin, algo, { appId: EXCHANGE_APP_ID });

    expect(pool.primaryAsset.index).toBe(algo.index);
    expect(pool.secondaryAsset.index).toBe(coin.index);
    expect(pool.liquidityAsset.index).toBe(EXCHANGE_LIQUIDITY_ID);
    expect(pool.liquidityAsset.name).toBe("ALGO/COIN PACT LP Token");
    expect(pool.appId).toBe(EXCHANGE_APP_ID);
  });

  it("e2e scenario", async () => {
    const client = new Client(getClientParams());

    const algo = await client.fetchAsset(0);
    const coin = await client.fetchAsset(1);

    const pool = await client.fetchPool(algo, coin, { appId: EXCHANGE_APP_ID });

    expect(pool.positions).toEqual({
      totalLiquidity: 0,
      totalPrimary: 0,
      totalSecondary: 0,
      rate: "0",
      rateReversed: "0",
    });

    // Opt in for liquidity asset.
    const liqOptInTx = await pool.liquidityAsset.prepareOptInTx(
      ROOT_ACCOUNT.addr,
    );
    await signSendAndWait(client, liqOptInTx, ROOT_ACCOUNT);

    // Add liquidity.
    const addLiqTx = await pool.prepareAddLiquidityTx({
      address: ROOT_ACCOUNT.addr,
      primaryAssetAmount: 1_000_000,
      secondaryAssetAmount: 1_000_000,
    });
    await signSendAndWait(client, addLiqTx, ROOT_ACCOUNT);
    await pool.updatePositions();
    expect(pool.positions).toEqual({
      totalLiquidity: 1_000_000,
      totalPrimary: 1_000_000,
      totalSecondary: 1_000_000,
      rate: "1",
      rateReversed: "1",
    });

    // Remove liquidity.
    const removeLiqTx = await pool.prepareRemoveLiquidityTx({
      address: ROOT_ACCOUNT.addr,
      amount: 100_000,
    });
    await signSendAndWait(client, removeLiqTx, ROOT_ACCOUNT);
    await pool.updatePositions();
    expect(pool.positions).toEqual({
      totalLiquidity: 900_000,
      totalPrimary: 900_000,
      totalSecondary: 900_000,
      rate: "1",
      rateReversed: "1",
    });

    // Swap algo.
    const swapAlgoTx = await pool.prepareSwapTx({
      address: ROOT_ACCOUNT.addr,
      asset: algo,
      amount: 200_000,
      slippagePct: 2,
    });
    await signSendAndWait(client, swapAlgoTx, ROOT_ACCOUNT);
    await pool.updatePositions();
    expect(pool.positions.totalLiquidity).toBe(900_000);
    expect(pool.positions.totalPrimary > 1_000_000).toBe(true);
    expect(pool.positions.totalSecondary < 1_000_000).toBe(true);
    expect(parseFloat(pool.positions.rate) > 1).toBe(true);
    expect(parseFloat(pool.positions.rateReversed) < 1).toBe(true);

    // Swap secondary.
    const swapSecTx = await pool.prepareSwapTx({
      address: ROOT_ACCOUNT.addr,
      asset: coin,
      amount: 500_000,
      slippagePct: 2,
    });
    await signSendAndWait(client, swapSecTx, ROOT_ACCOUNT);
    await pool.updatePositions();
    expect(pool.positions.totalLiquidity).toBe(900_000);
    expect(pool.positions.totalPrimary < 1_000_000).toBe(true);
    expect(pool.positions.totalSecondary > 1_000_000).toBe(true);
    expect(parseFloat(pool.positions.rate) < 1).toBe(true);
    expect(parseFloat(pool.positions.rateReversed) > 1).toBe(true);
  });
});
