import { Client } from "./client";
import {
  ROOT_ACCOUNT,
  USER_ACCOUNT,
  createAsset,
  getClientParams,
  signSendAndWait,
} from "./testUtils";

describe("Asset", () => {
  it("fetch ALGO", async () => {
    const client = new Client(getClientParams());
    const asset = await client.fetchAsset(0);

    expect(asset.decimals).toBe(6);
    expect(asset.index).toBe(0);
    expect(asset.name).toBe("Algo");
    expect(asset.unitName).toBe("ALGO");
    expect(asset.ratio.toNumber()).toBe(10 ** 6);
  });

  it("fetch ASA", async () => {
    const client = new Client(getClientParams());
    const asset = await client.fetchAsset(1);

    expect(asset.decimals).toBe(6);
    expect(asset.index).toBe(1);
    expect(asset.name).toBe("COIN");
    expect(asset.unitName).toBe("COIN");
    expect(asset.ratio.toNumber()).toBe(10 ** 6);
  });

  it("fetch not existing asset", async () => {
    const client = new Client(getClientParams());

    await expect(client.fetchAsset(123)).rejects.toMatchObject({
      status: 404,
      response: { body: { message: "asset does not exist" } },
    });
  });

  it("opt in for an asset", async () => {
    const client = new Client(getClientParams());
    const assetIndex = await createAsset(client, "test", 10, ROOT_ACCOUNT);
    const asset = await client.fetchAsset(assetIndex);

    expect(await asset.isOptedIn(USER_ACCOUNT.addr)).toBe(false);

    const optInTx = await asset.prepareOptInTx(USER_ACCOUNT.addr);
    await signSendAndWait(client, optInTx, USER_ACCOUNT);

    expect(await asset.isOptedIn(USER_ACCOUNT.addr)).toBe(true);
  });
});
