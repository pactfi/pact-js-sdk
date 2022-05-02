import algosdk from "algosdk";
import D from "decimal.js";

import { Asset, fetchAssetByIndex } from "./asset";
import { crossFetch } from "./crossFetch";
import { encode, encodeArray } from "./encoding";
import { PoolCalculator } from "./poolCalculator";
import { AppInternalState, PoolState, parseGlobalPoolState } from "./poolState";
import { Swap } from "./swap";
import { TransactionGroup } from "./transactionGroup";

export type AddLiquidityOptions = {
  address: string;
  primaryAssetAmount: number;
  secondaryAssetAmount: number;
  note?: Uint8Array;
};

export type RemoveLiquidityOptions = {
  address: string;
  amount: number;
};

export type SwapOptions = {
  asset: Asset;
  amount: number;
  slippagePct: number;
  reverse?: boolean;
};

export type SwapTxOptions = {
  swap: Swap;
  address: string;
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
  apr_7d: string;
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

export type PoolType = "CONSTANT_PRODUCT" | "STABLESWAP";

type OperationType = "SWAP" | "ADDLIQ" | "REMLIQ";

type MakeNoopTxOptions = {
  address: string;
  suggestedParams: algosdk.SuggestedParams;
  fee: number;
  args: (OperationType | number)[];
  extraAsset?: Asset;
  note?: Uint8Array;
};

type MakeDepositTxOptions = {
  address: string;
  asset: Asset;
  amount: number;
  suggestedParams: algosdk.SuggestedParams;
};

type SuggestedParamsOption = {
  suggestedParams: algosdk.SuggestedParams;
};

export function listPools(pactApiUrl: string, options: ListPoolsOptions) {
  const params = new URLSearchParams(options);
  return crossFetch<ApiListPoolsResponse>(
    `${pactApiUrl}/api/pools?${params.toString()}`,
  );
}

export async function fetchAppState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<AppInternalState> {
  const appData = await algod.getApplicationByID(appId).do();
  return parseGlobalPoolState(appData.params["global-state"]);
}

export async function fetchPoolById(algod: algosdk.Algodv2, appId: number) {
  const appState = await fetchAppState(algod, appId);

  const [primaryAsset, secondaryAsset, liquidityAsset] = await Promise.all([
    fetchAssetByIndex(algod, appState.ASSET_A),
    fetchAssetByIndex(algod, appState.ASSET_B),
    fetchAssetByIndex(algod, appState.LTID),
  ]);

  return new Pool(
    algod,
    appId,
    primaryAsset,
    secondaryAsset,
    liquidityAsset,
    appState,
  );
}

export async function fetchPoolsByAssets(
  algod: algosdk.Algodv2,
  assetA: Asset | number,
  assetB: Asset | number,
  pactApiUrl: string,
): Promise<Pool[]> {
  const assets = [assetA, assetB].map((a) =>
    a instanceof Asset ? a.index : a,
  );

  // Make sure that the user didn't mess up assets order.
  // Primary asset always has lower index.
  const [primaryAsset, secondaryAsset] = assets.sort((a, b) => a - b);

  if (!pactApiUrl) {
    return Promise.reject("Must provide pactApiUrl.");
  }

  const appIds = await getAppIdsFromAssets(
    pactApiUrl,
    primaryAsset,
    secondaryAsset,
  );

  return Promise.all(appIds.map((appId) => fetchPoolById(algod, appId)));
}

export async function getAppIdsFromAssets(
  pactApiUrl: string,
  primaryAssetIndex: number,
  secondaryAssetIndex: number,
): Promise<number[]> {
  const data = await listPools(pactApiUrl, {
    primary_asset__algoid: primaryAssetIndex.toString(),
    secondary_asset__algoid: secondaryAssetIndex.toString(),
  });
  return data.results.map((pool) => parseInt(pool.appid));
}

export type ConstantProductPoolParams = {
  feeBps: number;
};

export type StableswapPoolParams = {
  feeBps: number;
  pactFeeBps: number;
  initialA: number;
  initialATime: number;
  futureA: number;
  futureATime: number;
};

export class Pool {
  calculator: PoolCalculator;

  state: PoolState;

  poolType: PoolType;

  params: ConstantProductPoolParams | StableswapPoolParams;

  feeBps: number;

  constructor(
    protected algod: algosdk.Algodv2,
    public appId: number,
    public primaryAsset: Asset,
    public secondaryAsset: Asset,
    public liquidityAsset: Asset,
    public internalState: AppInternalState,
  ) {
    if (internalState.INITIAL_A !== undefined) {
      this.poolType = "STABLESWAP";
      this.params = {
        feeBps: internalState.FEE_BPS,
        pactFeeBps: internalState.PACT_FEE_BPS,
        initialA: internalState.INITIAL_A,
        initialATime: internalState.INITIAL_A_TIME,
        futureA: internalState.FUTURE_A,
        futureATime: internalState.FUTURE_A_TIME,
      };
    } else {
      this.poolType = "CONSTANT_PRODUCT";
      this.params = {
        feeBps: internalState.FEE_BPS,
      };
    }
    this.feeBps = internalState.FEE_BPS + (internalState.PACT_FEE_BPS ?? 0);
    this.calculator = new PoolCalculator(this);
    this.state = this.parseInternalState(this.internalState);
  }

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

  async prepareAddLiquidityTxGroup(options: AddLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildAddLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildAddLiquidityTxs(options: AddLiquidityOptions & SuggestedParamsOption) {
    let txs: algosdk.Transaction[] = [];
    let { primaryAssetAmount, secondaryAssetAmount } = options;

    if (this.calculator.isEmpty) {
      // Adding initial liquidity has a limitation that the product of 2 assets must be lower then 2**64. Let's check if we can fit below the limit.
      const maxProduct = new D(2).pow(new D(64));
      const product = new D(primaryAssetAmount).mul(secondaryAssetAmount);
      if (product.gte(maxProduct)) {
        // Need to split the liquidity into two chunks.
        const divisor = new D(product).div(maxProduct).sqrt().add(1);
        const primarySmallAmount = new D(primaryAssetAmount)
          .div(divisor)
          .trunc()
          .toNumber();
        const secondarySmallAmount = new D(secondaryAssetAmount)
          .div(divisor)
          .trunc()
          .toNumber();

        primaryAssetAmount -= primarySmallAmount;
        secondaryAssetAmount -= secondarySmallAmount;

        txs = this.buildAddLiquidityTxs({
          ...options,
          primaryAssetAmount: primarySmallAmount,
          secondaryAssetAmount: secondarySmallAmount,
          note: encode("Initial add liquidity"),
        });
      }
    }

    const tx1 = this.makeDepositTx({
      address: options.address,
      asset: this.primaryAsset,
      amount: primaryAssetAmount,
      suggestedParams: options.suggestedParams,
    });
    const tx2 = this.makeDepositTx({
      address: options.address,
      asset: this.secondaryAsset,
      amount: secondaryAssetAmount,
      suggestedParams: options.suggestedParams,
    });
    const tx3 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams: options.suggestedParams,
      fee: this.poolType === "CONSTANT_PRODUCT" ? 3000 : 10_000,
      args: ["ADDLIQ", 0],
      extraAsset: this.liquidityAsset,
      note: options.note,
    });

    return [...txs, tx1, tx2, tx3];
  }

  async prepareRemoveLiquidityTxGroup(options: RemoveLiquidityOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildRemoveLiquidityTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildRemoveLiquidityTxs(
    options: RemoveLiquidityOptions & SuggestedParamsOption,
  ) {
    const txn1 = this.makeDepositTx({
      address: options.address,
      amount: options.amount,
      asset: this.liquidityAsset,
      suggestedParams: options.suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address: options.address,
      suggestedParams: options.suggestedParams,
      fee: this.poolType === "CONSTANT_PRODUCT" ? 3000 : 10_000,
      args: ["REMLIQ", 0, 0], // min expected primary, min expected secondary
    });

    return [txn1, txn2];
  }

  prepareSwap(options: SwapOptions): Swap {
    if (!this.isAssetInThePool(options.asset)) {
      throw `Asset ${options.asset.index} not in the pool`;
    }
    return new Swap(
      this,
      options.asset,
      options.amount,
      options.slippagePct,
      !!options.reverse,
    );
  }

  isAssetInThePool(asset: Asset) {
    return [this.primaryAsset.index, this.secondaryAsset.index].includes(
      asset.index,
    );
  }

  async prepareSwapTxGroup(options: SwapTxOptions) {
    const suggestedParams = await this.algod.getTransactionParams().do();
    const txs = this.buildSwapTxs({ ...options, suggestedParams });
    return new TransactionGroup(txs);
  }

  buildSwapTxs({
    address,
    swap,
    suggestedParams,
  }: SwapTxOptions & SuggestedParamsOption) {
    const txn1 = this.makeDepositTx({
      address,
      amount: swap.effect.amountOut,
      asset: swap.assetOut,
      suggestedParams,
    });
    const txn2 = this.makeApplicationNoopTx({
      address,
      suggestedParams,
      fee: this.poolType === "CONSTANT_PRODUCT" ? 2000 : 8000,
      args: ["SWAP", swap.effect.minimumAmountIn],
    });

    return [txn1, txn2];
  }

  private makeDepositTx(options: MakeDepositTxOptions) {
    if (!options.asset.index) {
      // ALGO
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: options.address,
        to: this.getEscrowAddress(),
        amount: BigInt(options.amount),
        suggestedParams: options.suggestedParams,
      });
    }
    return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: options.address,
      to: this.getEscrowAddress(),
      amount: BigInt(options.amount),
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
      note: options.note,
    });
  }

  private parseInternalState(state: AppInternalState): PoolState {
    return {
      totalLiquidity: state.L,
      totalPrimary: state.A,
      totalSecondary: state.B,
      primaryAssetPrice: this.calculator.primaryAssetPrice,
      secondaryAssetPrice: this.calculator.secondaryAssetPrice,
    };
  }
}
