import algosdk from "algosdk";

import { Asset } from "./asset";
import { crossFetch } from "./crossFetch";
import { decode, encodeArray } from "./encoding";
import { PoolCalculator } from "./poolCalculator";
import { TransactionGroup } from "./transactionGroup";
import { OperationType } from "./types";

type AppState = {
  L: number | bigint;
  A: number | bigint;
  B: number | bigint;
  LTID: number;
};

export type PoolPositions = {
  totalLiquidity: number | bigint;
  totalPrimary: number | bigint;
  totalSecondary: number | bigint;
  rate: string;
  rateReversed: string;
};

export type AddLiquidityOptions = {
  address: string;
  primaryAssetAmount: number | bigint;
  secondaryAssetAmount: number | bigint;
};

export type RemoveLiquidityOptions = {
  address: string;
  amount: number | bigint;
};

export type SwapOptions = {
  address: string;
  asset: Asset;
  amount: number | bigint;
  slippagePct: number;
};

type MakeNoopTxOptions = {
  address: string;
  suggestedParams: any;
  fee: number | bigint;
  args: (OperationType | number)[];
  extraAsset?: Asset;
};

type MakeDepositTxOptions = {
  address: string;
  asset: Asset;
  amount: number | bigint;
  suggestedParams: any;
};

export type FetchPoolOptions = {
  pactApiUrl?: string;
  appId?: number;
  feeBps?: number;
};

export class Pool {
  static poolsCache: any;

  feeBps = 30;

  calculator = new PoolCalculator(this);

  positions: PoolPositions;

  constructor(
    private algod: algosdk.Algodv2,
    public appId: number,
    public primaryAsset: Asset,
    public secondaryAsset: Asset,
    public liquidityAsset: Asset,
    public state: AppState,
  ) {
    this.positions = this.stateToPositions(state);
  }

  static async fetchPool(
    algod: algosdk.Algodv2,
    asset_a: Asset,
    asset_b: Asset,
    options: FetchPoolOptions = {},
  ): Promise<Pool> {
    options = { ...options };

    // Make sure that the user didn't mess up assets order.
    // Primary asset always has lower index.
    const [primaryAsset, secondaryAsset] = [asset_a, asset_b].sort(
      (a, b) => a.index - b.index,
    );

    if (!options.appId) {
      if (!options.pactApiUrl) {
        return Promise.reject("Must provide pactifyApiUrl or appId.");
      }
      options.appId = await Pool.getAppIdFromAssets(
        options.pactApiUrl,
        primaryAsset,
        secondaryAsset,
      );
      if (!options.appId) {
        return Promise.reject(
          `Cannot find pool for assets ${primaryAsset.index} and ${secondaryAsset.index}.`,
        );
      }
    }

    const appState = await fetchAppState(algod, options.appId);
    const liquidityAsset = await Asset.fetchByIndex(algod, appState.LTID);

    return new Pool(
      algod,
      options.appId,
      primaryAsset,
      secondaryAsset,
      liquidityAsset,
      appState,
    );
  }

  static async getAppIdFromAssets(
    pactifyApi: string,
    primaryAsset: Asset,
    secondaryAsset: Asset,
  ): Promise<number> {
    if (!Pool.poolsCache) {
      Pool.poolsCache = await crossFetch(`${pactifyApi}/api/pools`);
    }
    for (const poolData of Pool.poolsCache) {
      if (
        parseInt(poolData.primary_asset.algoid) === primaryAsset.index &&
        parseInt(poolData.secondary_asset.algoid) === secondaryAsset.index
      ) {
        return parseInt(poolData.appid);
      }
    }

    return 0;
  }

  getEscrowAddress() {
    return algosdk.getApplicationAddress(this.appId);
  }

  async updatePositions(): Promise<PoolPositions> {
    this.state = await fetchAppState(this.algod, this.appId);
    this.positions = this.stateToPositions(this.state);
    return this.positions;
  }

  async prepareAddLiquidityTx(options: AddLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();

    const txn1 = this.makeDepositTx({
      address: options.address,
      asset: this.primaryAsset,
      amount: options.primaryAssetAmount,
      suggestedParams,
    });
    const txn2 = this.makeDepositTx({
      address: options.address,
      asset: this.secondaryAsset,
      amount: options.secondaryAssetAmount,
      suggestedParams,
    });
    const txn3 = this.makeNoopTx({
      address: options.address,
      suggestedParams,
      fee: 3000,
      args: ["ADDLIQ", 0],
      extraAsset: this.liquidityAsset,
    });

    return new TransactionGroup([txn1, txn2, txn3]);
  }

  async prepareRemoveLiquidityTx(options: RemoveLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();

    const txn1 = this.makeDepositTx({
      address: options.address,
      amount: options.amount,
      asset: this.liquidityAsset,
      suggestedParams,
    });
    const txn2 = this.makeNoopTx({
      address: options.address,
      suggestedParams,
      fee: 3000,
      args: ["REMLIQ", 0, 0], // min expected primary, min expected secondary
    });

    return new TransactionGroup([txn1, txn2]);
  }

  async prepareSwapTx(options: SwapOptions): Promise<TransactionGroup> {
    const suggestedParams = await this.algod.getTransactionParams().do();

    const minimumExpected = this.calculator.getMinimumExpected(
      options.asset,
      options.amount,
      options.slippagePct,
    );

    const txn1 = this.makeDepositTx({
      address: options.address,
      amount: options.amount,
      asset: options.asset,
      suggestedParams,
    });
    const txn2 = this.makeNoopTx({
      address: options.address,
      suggestedParams,
      fee: 2000,
      args: ["SWAP", minimumExpected],
    });

    return new TransactionGroup([txn1, txn2]);
  }

  private makeDepositTx(options: MakeDepositTxOptions) {
    if (!options.asset.index) {
      // ALGO
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: options.address,
        to: this.getEscrowAddress(),
        amount: options.amount,
        suggestedParams: options.suggestedParams,
      });
    } else {
      return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: options.address,
        to: this.getEscrowAddress(),
        amount: options.amount,
        assetIndex: options.asset.index,
        suggestedParams: options.suggestedParams,
      });
    }
  }

  private makeNoopTx(options: MakeNoopTxOptions) {
    const appArgs = encodeArray(options.args);

    const foreignAssets = [this.primaryAsset.index, this.secondaryAsset.index];
    if (options.extraAsset) {
      foreignAssets.push(options.extraAsset.index);
    }

    return algosdk.makeApplicationNoOpTxnFromObject({
      from: options.address,
      appIndex: this.appId,
      foreignAssets,
      appArgs,
      suggestedParams: {
        ...options.suggestedParams,
        fee: options.fee,
        flatFee: true,
      },
    });
  }

  private stateToPositions(state: AppState): PoolPositions {
    return {
      totalLiquidity: state.L,
      totalPrimary: state.A,
      totalSecondary: state.B,
      rate: this.calculator.rate.toString(),
      rateReversed: this.calculator.rateReversed.toString(),
    };
  }
}

export async function fetchAppState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<AppState> {
  const appData = await algod.getApplicationByID(appId).do();
  return parseGlobalState(appData.params["global-state"]);
}

function parseGlobalState(kv: any) {
  // Transform algorand key-value schema.
  const res: any = {};
  for (const elem of kv) {
    const key = decode(Buffer.from(elem["key"], "base64"));
    let val: string | number | bigint;
    if (elem["value"]["type"] == 1) {
      val = elem["value"]["bytes"];
    } else {
      val = elem["value"]["uint"];
    }
    res[key] = val;
  }
  return res;
}
