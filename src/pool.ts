import algosdk from "algosdk";

import { Asset, fetchAssetByIndex } from "./asset";
import { b64ToUtf8 } from "./compat";
import { crossFetch } from "./crossFetch";
import { encodeArray } from "./encoding";
import { PoolCalculator } from "./poolCalculator";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";
import { OperationType } from "./types";

type AppInternalState = {
  L: number;
  A: number;
  B: number;
  LTID: number;
};

export type PoolState = {
  totalLiquidity: number;
  totalPrimary: number;
  totalSecondary: number;
  primaryAssetPrice: number;
  secondaryAssetPrice: number;
};

export type AddLiquidityOptions = {
  address: string;
  primaryAssetAmount: number;
  secondaryAssetAmount: number;
};

export type RemoveLiquidityOptions = {
  address: string;
  amount: number;
};

export type SwapOptions = {
  asset: Asset;
  amount: number;
  slippagePct: number;
};

export type FetchPoolOptions = {
  pactApiUrl?: string;
  appId?: number;
  feeBps?: number;
};

export type ListPoolsOptions = {
  page?: string;
  is_verified?: string;
  creator?: string;
  primary_asset__algoid?: string;
  secondary_asset__algoid?: string;
  primary_asset__unit_name?: string;
  secondary_asset__unit_name?: string;
  primary_asset__name?: string;
  secondary_asset__name?: string;
};

export type ApiListPoolsResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ApiPool[];
};

export type ApiPool = {
  address: string;
  appid: string;
  confirmed_round: number;
  creator: string;
  fee_amount_7d: string;
  fee_amount_24h: string;
  fee_usd_7d: string;
  fee_usd_24h: string;
  tvl_usd: string;
  volume_7d: string;
  volume_24h: string;
  id: number;
  is_verified: boolean;
  pool_asset: ApiAsset;
  primary_asset: ApiAsset;
  secondary_asset: ApiAsset;
};

export type ApiAsset = {
  algoid: string;
  decimals: number;
  id: number;
  is_liquidity_token: boolean;
  is_verified: boolean;
  name: string;
  total_amount: string;
  tvl_usd: string;
  unit_name: string;
  volume_7d: string;
  volume_24h: string;
};

type MakeNoopTxOptions = {
  address: string;
  suggestedParams: any;
  fee: number;
  args: (OperationType | number)[];
  extraAsset?: Asset;
};

type MakeDepositTxOptions = {
  address: string;
  asset: Asset;
  amount: number;
  suggestedParams: any;
};

export function listPools(pactApiUrl: string, options: ListPoolsOptions) {
  const params = new URLSearchParams(options);
  return crossFetch(`${pactApiUrl}/api/pools?${params.toString()}`);
}

export async function fetchAppState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<AppInternalState> {
  const appData = await algod.getApplicationByID(appId).do();
  return parseGlobalState(appData.params["global-state"]);
}

function parseGlobalState(kv: any) {
  // Transform algorand key-value schema.
  const res: any = {};
  for (const elem of kv) {
    const key = b64ToUtf8(elem["key"]);
    let val: string | number;
    if (elem["value"]["type"] == 1) {
      val = elem["value"]["bytes"];
    } else {
      val = elem["value"]["uint"];
    }
    res[key] = val;
  }
  return res;
}

export async function fetchPool(
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
    options.appId = await getAppIdFromAssets(
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
  const liquidityAsset = await fetchAssetByIndex(algod, appState.LTID);

  const pool = new Pool(
    algod,
    options.appId,
    primaryAsset,
    secondaryAsset,
    liquidityAsset,
    appState,
  );

  pool.feeBps = options.feeBps ?? 30;

  return pool;
}

export async function getAppIdFromAssets(
  pactApiUrl: string,
  primaryAsset: Asset,
  secondaryAsset: Asset,
): Promise<number> {
  const data = await listPools(pactApiUrl, {
    primary_asset__algoid: primaryAsset.index.toString(),
    secondary_asset__algoid: secondaryAsset.index.toString(),
  });
  if (data.results.length) {
    return data.results[0].appid;
  }
  return 0;
}

export class Pool {
  feeBps = 30;

  calculator = new PoolCalculator(this);

  state = this.parseInternalState(this.internalState);

  constructor(
    private algod: algosdk.Algodv2,
    public appId: number,
    public primaryAsset: Asset,
    public secondaryAsset: Asset,
    public liquidityAsset: Asset,
    public internalState: AppInternalState,
  ) {}

  getEscrowAddress() {
    return algosdk.getApplicationAddress(this.appId);
  }

  getOtherAsset(asset: Asset): Asset {
    if (asset.index === this.primaryAsset.index) {
      return this.secondaryAsset;
    }
    if (asset.index === this.secondaryAsset.index) {
      return this.primaryAsset;
    }
    throw Error(`Asset with index ${asset.index} is not a pool asset.`);
  }

  async updateState(): Promise<PoolState> {
    this.internalState = await fetchAppState(this.algod, this.appId);
    this.state = this.parseInternalState(this.internalState);
    return this.state;
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
    const txn3 = this.makeApplicationNoopTx({
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
    const txn2 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams,
      fee: 3000,
      args: ["REMLIQ", 0, 0], // min expected primary, min expected secondary
    });

    return new TransactionGroup([txn1, txn2]);
  }

  prepareSwap(options: SwapOptions): Swap {
    if (!this.isAssetInThePool(options.asset)) {
      throw `Asset ${options.asset.index} not in the pool`;
    }
    return new Swap(this, options.asset, options.amount, options.slippagePct);
  }

  isAssetInThePool(asset: Asset) {
    return [this.primaryAsset.index, this.secondaryAsset.index].includes(
      asset.index,
    );
  }

  async prepareSwapTx(swap: Swap, address: string) {
    const suggestedParams = await this.algod.getTransactionParams().do();

    const txn1 = this.makeDepositTx({
      address,
      amount: swap.amountOut,
      asset: swap.assetOut,
      suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address,
      suggestedParams,
      fee: 2000,
      args: ["SWAP", swap.effect.minimumAmountIn],
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
    }
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: options.address,
      to: this.getEscrowAddress(),
      amount: options.amount,
      assetIndex: options.asset.index,
      suggestedParams: options.suggestedParams,
    });
  }

  private makeApplicationNoopTx(options: MakeNoopTxOptions) {
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

  private parseInternalState(state: AppInternalState): PoolState {
    return {
      totalLiquidity: state.L,
      totalPrimary: state.A,
      totalSecondary: state.B,
      primaryAssetPrice: this.calculator.primaryAssetPrice.toNumber(),
      secondaryAssetPrice: this.calculator.secondaryAssetPrice.toNumber(),
    };
  }
}
