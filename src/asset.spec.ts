import { Client } from "./client";
import { algod, createAsset, newAccount, signSendAndWait } from "./testUtils";

describe("Asset", () => {
  it("fetch ALGO", async () => {
    const client = new Client(algod);
    const asset = await client.fetchAsset(0);

    expect(asset.decimals).toBe(6);
    expect(asset.index).toBe(0);
    expect(asset.name).toBe("Algo");
    expect(asset.unitName).toBe("ALGO");
    expect(asset.ratio).toBe(10 ** 6);
  });

  it("fetch ASA", async () => {
    const client = new Client(algod);
    const account = await newAccount();
    const assetIndex = await createAsset(account, "JAMNIK", 10);
    const asset = await client.fetchAsset(assetIndex);

    expect(asset.decimals).toBe(10);
    expect(asset.index).toBe(assetIndex);
    expect(asset.name).toBe("JAMNIK");
    expect(asset.unitName).toBe("JAMNIK");
    expect(asset.ratio).toBe(10 ** 10);
  });

  it("fetch not existing asset", async () => {
    const client = new Client(algod);

    await expect(client.fetchAsset(99999999)).rejects.toMatchObject({
      status: 404,
      response: { body: { message: "asset does not exist" } },
    });
  });

  it("opt in for an asset", async () => {
    const client = new Client(algod);
    const creator = await newAccount();
    const assetIndex = await createAsset(creator, "test", 10);
    const asset = await client.fetchAsset(assetIndex);

    const user = await newAccount();
    expect(await asset.isOptedIn(user.addr)).toBe(false);

    const optInTx = await asset.prepareOptInTx(user.addr);
    await signSendAndWait(optInTx, user);

    expect(await asset.isOptedIn(user.addr)).toBe(true);
  });
});
