import algosdk from "algosdk";

import { Asset, fetchAssetByIndex } from "./asset";
import {
  ApiListPoolsResponse,
  ListPoolsOptions,
  Pool,
  fetchPoolById,
  fetchPoolsByAssets,
  listPools,
} from "./pool";

type AllClientOptions = {
  pactApiUrl?: string;
};

export type ClientOptions = Partial<AllClientOptions>;

export class PactClient {
  pactApiUrl: string;

  constructor(public algod: algosdk.Algodv2, options: ClientOptions = {}) {
    this.pactApiUrl = options.pactApiUrl ?? "https://api.pact.fi";
  }

  fetchAsset(assetIndex: number): Promise<Asset> {
    return fetchAssetByIndex(this.algod, assetIndex);
  }

  listPools(options: ListPoolsOptions = {}): Promise<ApiListPoolsResponse> {
    if (!this.pactApiUrl) {
      throw Error("No pactApiUrl provided.");
    }
    return listPools(this.pactApiUrl, options);
  }

  async fetchPoolsByAssets(
    primaryAsset: Asset | number,
    secondaryAsset: Asset | number,
  ): Promise<Pool[]> {
    return fetchPoolsByAssets(
      this.algod,
      primaryAsset,
      secondaryAsset,
      this.pactApiUrl,
    );
  }

  async fetchPoolById(appId: number): Promise<Pool> {
    return fetchPoolById(this.algod, appId);
  }
}
