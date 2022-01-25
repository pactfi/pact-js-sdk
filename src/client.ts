import algosdk from "algosdk";

import { Asset } from "./asset";
import { FetchPoolOptions, Pool } from "./pool";

type AllClientOptions = {
  algod: algosdk.Algodv2;
  pactApiUrl?: string;
};

export type ClientOptions = Partial<AllClientOptions>;

const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  pactApiUrl: "https://api.pact.fi",
};

export class Client {
  algod!: algosdk.Algodv2;
  pactApiUrl?: string;

  constructor(options: ClientOptions) {
    options = { ...DEFAULT_CLIENT_OPTIONS, ...options };
    Object.assign(this, options);
  }

  fetchAsset(assetIndex: number): Promise<Asset> {
    return Asset.fetchByIndex(this.algod, assetIndex);
  }

  async fetchPool(
    primaryAsset: Asset,
    secondaryAsset: Asset,
    options: FetchPoolOptions = {},
  ): Promise<Pool> {
    return Pool.fetchPool(this.algod, primaryAsset, secondaryAsset, {
      pactApiUrl: this.pactApiUrl,
      ...options,
    });
  }
}
