import D from "decimal.js";

import { Asset } from "./asset";
import { ConstantProductCalculator } from "./constantProductCalculator";
import { Pool } from "./pool";
import { StableswapCalculator } from "./stableswapCalculator";
import { SwapCalculator } from "./types";

export class PoolCalculator {
  swapCalculator: SwapCalculator;

  constructor(private pool: Pool) {
    if (pool.poolType === "CONSTANT_PRODUCT") {
      this.swapCalculator = new ConstantProductCalculator(pool);
    } else if (pool.poolType === "STABLESWAP") {
      this.swapCalculator = new StableswapCalculator(pool);
    } else {
      throw Error(`Unknown pool type: ${pool.poolType}`);
    }
  }

  get primaryAssetAmount() {
    return BigInt(this.pool.internalState.A);
  }

  get secondaryAssetAmount() {
    return BigInt(this.pool.internalState.B);
  }

  get primaryAssetAmountDecimal() {
    return this.pool.internalState.A / this.pool.primaryAsset.ratio;
  }

  get secondaryAssetAmountDecimal() {
    return this.pool.internalState.B / this.pool.secondaryAsset.ratio;
  }

  get isEmpty() {
    return this.primaryAssetAmount === 0n || this.secondaryAssetAmount === 0n;
  }

  get primaryAssetPrice() {
    return this.swapCalculator.getPrice(
      this.primaryAssetAmountDecimal,
      this.secondaryAssetAmountDecimal,
    );
  }

  get secondaryAssetPrice() {
    return this.swapCalculator.getPrice(
      this.secondaryAssetAmountDecimal,
      this.primaryAssetAmountDecimal,
    );
  }

  amountOutToNetAmountIn(asset: Asset, amountOut: bigint): bigint {
    const grossAmountIn = this.amountOutToGrossAmountIn(asset, amountOut);
    const fee = this.getFeeFromGrossAmount(grossAmountIn);
    const netAmountIn = grossAmountIn - fee;
    return netAmountIn;
  }

  netAmountInToAmountOut(asset: Asset, netAmountIn: bigint): bigint {
    const fee = this.getFeeFromNetAmount(netAmountIn);
    netAmountIn = netAmountIn + fee;
    return this.grossAmountInToAmountOut(asset, netAmountIn);
  }

  getFeeFromGrossAmount(grossAmount: bigint): bigint {
    const feeBps = BigInt(this.pool.feeBps);
    return grossAmount - (grossAmount * (10000n - feeBps)) / 10000n;
  }

  getFeeFromNetAmount(netAmount: bigint): bigint {
    // Using D because of "ceil()"
    const dNetAmount = new D(netAmount.toString());
    return BigInt(
      dNetAmount
        .div((10000 - this.pool.feeBps) / 10000)
        .sub(dNetAmount)
        .ceil()
        .toNumber(),
    );
  }

  private grossAmountInToAmountOut(
    asset: Asset,
    intGrossAmountIn: bigint,
  ): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapAmountOut(A, B, intGrossAmountIn);
  }

  private amountOutToGrossAmountIn(asset: Asset, amountOut: bigint): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapGrossAmountIn(A, B, amountOut);
  }

  private getLiquidities(asset: Asset): [bigint, bigint] {
    let [A, B] = [this.primaryAssetAmount, this.secondaryAssetAmount];
    if (asset.index !== this.pool.primaryAsset.index) {
      [A, B] = [B, A];
    }
    return [A, B];
  }

  getMinimumAmountIn(
    asset: Asset,
    amountOut: bigint,
    slippagePct: bigint,
  ): bigint {
    const amountIn = this.amountOutToNetAmountIn(asset, amountOut);
    return amountIn - (amountIn * slippagePct) / 100n;
  }

  getFee(asset: Asset, amountOut: bigint): bigint {
    return (
      this.amountOutToGrossAmountIn(asset, amountOut) -
      this.amountOutToNetAmountIn(asset, amountOut)
    );
  }

  getAssetPriceAfterLiqChange(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): number {
    const newPrimaryLiq =
      (this.pool.internalState.A + primaryLiqChange) /
      this.pool.primaryAsset.ratio;

    const newSecondaryLiq =
      (this.pool.internalState.B + secondaryLiqChange) /
      this.pool.secondaryAsset.ratio;

    if (asset.index === this.pool.primaryAsset.index) {
      return this.swapCalculator.getPrice(newPrimaryLiq, newSecondaryLiq);
    }
    return this.swapCalculator.getPrice(newSecondaryLiq, newPrimaryLiq);
  }

  getPriceImpactPct(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): number {
    const newPrice = this.getAssetPriceAfterLiqChange(
      asset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const oldPrice =
      asset.index === this.pool.primaryAsset.index
        ? this.primaryAssetPrice
        : this.secondaryAssetPrice;
    return (newPrice * 100) / oldPrice - 100;
  }

  getSwapPrice(assetOut: Asset, amountOut: bigint): number {
    const assetIn = this.pool.getOtherAsset(assetOut);
    const amountIn = this.amountOutToGrossAmountIn(assetOut, amountOut);
    const diff_ratio = assetOut.ratio / assetIn.ratio;
    return (Number(amountIn) / Number(amountOut)) * diff_ratio;
  }
}
