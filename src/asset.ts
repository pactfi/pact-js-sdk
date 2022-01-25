import algosdk from "algosdk";
import Decimal from "decimal.js";

export class Asset {
  static assetsCache: Record<number, Asset> = {};

  public name = "";
  public unitName = "";
  public decimals = 0;
  public ratio!: Decimal;

  constructor(private algod: algosdk.Algodv2, public index: number) {}

  static async fetchByIndex(
    algod: algosdk.Algodv2,
    index: number,
  ): Promise<Asset> {
    if (Asset.assetsCache[index]) {
      return Asset.assetsCache[index];
    }

    let params: any;
    if (index > 0) {
      const assetInfo = await algod.getAssetByID(index).do();
      params = assetInfo.params;
    } else {
      params = {
        name: "Algo",
        "unit-name": "ALGO",
        decimals: 6,
      };
    }

    const asset = new Asset(algod, index);
    asset.name = params.name;
    asset.unitName = params["unit-name"];
    asset.decimals = params.decimals;
    asset.ratio = new Decimal(10 ** asset.decimals);

    Asset.assetsCache[index] = asset;
    return asset;
  }

  async prepareOptInTx(address: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();

    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: address,
      to: address,
      amount: 0,
      assetIndex: this.index,
      suggestedParams,
    });
  }

  async isOptedIn(address: string): Promise<boolean> {
    const holding = await this.getHolding(address);
    return holding !== null;
  }

  async getHolding(address: string): Promise<number | null> {
    const accountInfo = await this.algod.accountInformation(address).do();
    for (const asset of accountInfo["assets"]) {
      if (asset["asset-id"] === this.index) {
        return asset["amount"];
      }
    }
    return null;
  }
}
