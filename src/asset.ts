import algosdk from "algosdk";

export async function fetchAssetByIndex(
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
  asset.ratio = 10 ** asset.decimals;

  Asset.assetsCache[index] = asset;
  return asset;
}

/**
 * Describes the basic data and the utility functions for an Algorand Standard Asset.
 * 
 * The class includes basic details of the asset like name, unitName, number of 
 * decimals supported and ratio from base units to unit. 
 */
export class Asset {

  /**
   * A cache of the asset index to Asset to reduce the time for 
   * looking up basic details about the asset.
   */
  static assetsCache: Record<number, Asset> = {};

  /**
   * The name of the Asset if there is one. This may be empty. 
   */
  public name?= "";
  /**
   * The name of a unit of the asset if there is one. This may be empty.
   */
  public unitName?= "";

  /**
   * The number of decimal places that the Asset supports.
   */
  public decimals = 0;

  /**
   * The ratio between a base unit and the unit of the asset. 
   * This is used to convert between an integer and floating point 
   * representation of the asset without loss of precession. 
   */
  public ratio = 1;

  constructor(protected algod: algosdk.Algodv2, public index: number) { }

  async prepareOptInTx(address: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    return this.buildOptInTx(address, suggestedParams);
  }

  buildOptInTx(address: string, suggestedParams: algosdk.SuggestedParams) {
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
    return this.getHoldingFromAccountInformation(accountInfo);
  }

  getHoldingFromAccountInformation(accountInformation: any) {
    for (const asset of accountInformation.assets) {
      if (asset["asset-id"] === this.index) {
        return asset.amount;
      }
    }
    return null;
  }
}
