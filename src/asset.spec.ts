import { PactClient } from "./client";
import { algod, createAsset, newAccount, signAndSend } from "./testUtils";

describe("Asset", () => {
  it("fetch ALGO", async () => {
    const pact = new PactClient(algod);
    const asset = await pact.fetchAsset(0);

    expect(asset.decimals).toBe(6);
    expect(asset.index).toBe(0);
    expect(asset.name).toBe("Algo");
    expect(asset.unitName).toBe("ALGO");
    expect(asset.ratio).toBe(10 ** 6);
  });

  it("fetch ASA", async () => {
    const pact = new PactClient(algod);
    const account = await newAccount();
    const assetIndex = await createAsset(account, "JAMNIK", 10);
    const asset = await pact.fetchAsset(assetIndex);

    expect(asset.decimals).toBe(10);
    expect(asset.index).toBe(assetIndex);
    expect(asset.name).toBe("JAMNIK");
    expect(asset.unitName).toBe("JAMNIK");
    expect(asset.ratio).toBe(10 ** 10);
  });

  it("fetch ASA with no name", async () => {
    const pact = new PactClient(algod);
    const account = await newAccount();
    const assetIndex = await createAsset(account, undefined, 10);
    const asset = await pact.fetchAsset(assetIndex);

    expect(asset.decimals).toBe(10);
    expect(asset.index).toBe(assetIndex);
    expect(asset.name).toBeUndefined;
    expect(asset.unitName).toBeUndefined;
    expect(asset.ratio).toBe(10 ** 10);
  });

  it("fetch not existing asset", async () => {
    const pact = new PactClient(algod);

    await expect(pact.fetchAsset(99999999)).rejects.toMatchObject({
      status: 404,
      response: { body: { message: "asset does not exist" } },
    });
  });

  it("opt in for an asset", async () => {
    const pact = new PactClient(algod);
    const creator = await newAccount();
    const assetIndex = await createAsset(creator, "test", 10);
    const asset = await pact.fetchAsset(assetIndex);

    const user = await newAccount();
    expect(await asset.isOptedIn(user.addr)).toBe(false);

    const optInTx = await asset.prepareOptInTx(user.addr);
    await signAndSend(optInTx, user);

    expect(await asset.isOptedIn(user.addr)).toBe(true);
  });
});
