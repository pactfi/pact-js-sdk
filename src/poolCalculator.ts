import D from "decimal.js";

import { Asset } from "./asset";
import { Pool } from "./pool";

/**
 * Pool calculator contains functions for calculation statistics and other numerical data about the pool.
 *
 * The pool calculator uses internal data from the pool to calculate values like the Prices, Net Amounts
 * and values for the swap.
 */
export class PoolCalculator {
  constructor(private pool: Pool) {}

  private get primaryAssetAmount() {
    return new D(this.pool.internalState.A as number);
  }

  private get secondaryAssetAmount() {
    return new D(this.pool.internalState.B as number);
  }

  /**
   * Checks if the pool is currently empty.
   *
   * A pool is empty if either the primary or secondary asset is zero.
   *
   * @returns true if the pool is empty, false otherwise.
   */
  get isEmpty() {
    return (
      this.primaryAssetAmount.isZero() || this.secondaryAssetAmount.isZero()
    );
  }

  /**
   * Returns the number of secondary assets for a single primary asset.
   *
   * If the pool is currently zero then it returns zero, other wise it returns
   * $$ price = (Liq_s/R_s) /  ( Liq_s/R_s) $$
   */
  get primaryAssetPrice() {
    if (this.isEmpty) {
      return new D(0);
    }
    return this.getPrimaryAssetPrice(
      this.primaryAssetAmount,
      this.secondaryAssetAmount,
    );
  }

  get secondaryAssetPrice() {
    if (this.isEmpty) {
      return new D(0);
    }
    return this.getSecondaryAssetPrice(
      this.primaryAssetAmount,
      this.secondaryAssetAmount,
    );
  }

  private getPrimaryAssetPrice(primaryLiqAmount: D, secondaryLiqAmount: D): D {
    if (primaryLiqAmount.isZero() || secondaryLiqAmount.isZero()) {
      return new D(0);
    }
    return secondaryLiqAmount
      .div(this.pool.secondaryAsset.ratio)
      .div(primaryLiqAmount.div(this.pool.primaryAsset.ratio));
  }

  private getSecondaryAssetPrice(
    primaryLiqAmount: D,
    secondaryLiqAmount: D,
  ): D {
    if (primaryLiqAmount.isZero() || secondaryLiqAmount.isZero()) {
      return new D(0);
    }
    return primaryLiqAmount
      .div(this.pool.primaryAsset.ratio)
      .div(secondaryLiqAmount.div(this.pool.secondaryAsset.ratio));
  }

  getMinimumAmountIn(asset: Asset, amount: number, slippagePct: number): D {
    const amountIn = this.getAmountIn(asset, amount);
    return amountIn.sub(amountIn.mul(slippagePct / 100));
  }

  getGrossAmountIn(asset: Asset, amount: number): D {
    const dAmount = new D(amount as number);
    if (asset.index === this.pool.primaryAsset.index) {
      return this.swapPrimaryGrossAmount(dAmount);
    } else {
      return this.swapSecondaryGrossAmount(dAmount);
    }
  }

  getNetAmountIn(asset: Asset, amount: number): D {
    const grossAmount = this.getGrossAmountIn(asset, amount);
    return this.subtractFee(grossAmount);
  }

  getAmountIn(asset: Asset, amount: number): D {
    const dAmount = new D(amount as number);
    let grossAmount: D;
    if (asset.index === this.pool.primaryAsset.index) {
      grossAmount = this.swapPrimaryGrossAmount(dAmount);
    } else {
      grossAmount = this.swapSecondaryGrossAmount(dAmount);
    }
    return this.subtractFee(grossAmount);
  }

  getFee(asset: Asset, amount: number): D {
    return this.getGrossAmountIn(asset, amount).sub(
      this.getNetAmountIn(asset, amount),
    );
  }

  getAssetPriceAfterLiqChange(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): D {
    const newPrimaryLiq = this.primaryAssetAmount.add(primaryLiqChange);
    const newSecondaryLiq = this.secondaryAssetAmount.add(secondaryLiqChange);
    if (asset.index === this.pool.primaryAsset.index) {
      return this.getPrimaryAssetPrice(newPrimaryLiq, newSecondaryLiq);
    } else {
      return this.getSecondaryAssetPrice(newPrimaryLiq, newSecondaryLiq);
    }
  }

  getPriceImpactPct(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): D {
    const newPrice = this.getAssetPriceAfterLiqChange(
      asset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const oldPrice =
      asset.index === this.pool.primaryAsset.index
        ? this.primaryAssetPrice
        : this.secondaryAssetPrice;
    return newPrice.mul(100).div(oldPrice).sub(100);
  }

  getSwapPrice(assetOut: Asset, amountOut: number): number {
    const assetIn = this.pool.getOtherAsset(assetOut);
    const amountIn = this.getGrossAmountIn(assetOut, amountOut);
    const diff_ratio = new D(assetOut.ratio / assetIn.ratio);
    return new D(amountIn).div(amountOut).mul(diff_ratio).toNumber();
  }

  private subtractFee(assetGrossAmount: D) {
    return assetGrossAmount
      .mul(10000 - this.pool.feeBps)
      .div(10000)
      .trunc();
  }

  private swapPrimaryGrossAmount(assetAmount: D) {
    const amount = new D(assetAmount);
    return amount
      .mul(this.secondaryAssetAmount)
      .div(this.primaryAssetAmount.add(amount))
      .trunc();
  }

  private swapSecondaryGrossAmount(assetAmount: D) {
    const amount = new D(assetAmount);
    return amount
      .mul(this.primaryAssetAmount)
      .div(this.secondaryAssetAmount.add(amount))
      .trunc();
  }
}
