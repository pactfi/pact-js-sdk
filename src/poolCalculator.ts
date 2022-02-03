import Decimal from "decimal.js";

import { Asset } from "./asset";
import { Pool } from "./pool";

export class PoolCalculator {
  constructor(private pool: Pool) {}

  private get primaryAssetAmount() {
    return new Decimal(this.pool.state.A as number);
  }

  private get secondaryAssetAmount() {
    return new Decimal(this.pool.state.B as number);
  }

  get isEmpty() {
    return (
      this.primaryAssetAmount.isZero() || this.secondaryAssetAmount.isZero()
    );
  }

  get primaryAssetPrice() {
    if (this.isEmpty) {
      return new Decimal(0);
    }
    return this.getPrimaryAssetPrice(
      this.primaryAssetAmount,
      this.secondaryAssetAmount,
    );
  }

  get secondaryAssetPrice() {
    if (this.isEmpty) {
      return new Decimal(0);
    }
    return this.getSecondaryAssetPrice(
      this.primaryAssetAmount,
      this.secondaryAssetAmount,
    );
  }

  private getPrimaryAssetPrice(
    primaryLiqAmount: Decimal,
    secondaryLiqAmount: Decimal,
  ): Decimal {
    if (primaryLiqAmount.isZero() || secondaryLiqAmount.isZero()) {
      return new Decimal(0);
    }
    return secondaryLiqAmount
      .div(this.pool.secondaryAsset.ratio)
      .div(primaryLiqAmount.div(this.pool.primaryAsset.ratio));
  }

  private getSecondaryAssetPrice(
    primaryLiqAmount: Decimal,
    secondaryLiqAmount: Decimal,
  ): Decimal {
    if (primaryLiqAmount.isZero() || secondaryLiqAmount.isZero()) {
      return new Decimal(0);
    }
    return primaryLiqAmount
      .div(this.pool.primaryAsset.ratio)
      .div(secondaryLiqAmount.div(this.pool.secondaryAsset.ratio));
  }

  getMinimumAmountIn(
    asset: Asset,
    amount: number,
    slippagePct: number,
  ): Decimal {
    const amountIn = this.getAmountIn(asset, amount);
    return amountIn.sub(amountIn.mul(slippagePct / 100));
  }

  getGrossAmountIn(asset: Asset, amount: number): Decimal {
    const dAmount = new Decimal(amount as number);
    if (asset === this.pool.primaryAsset) {
      return this.swapPrimaryGrossAmount(dAmount);
    } else {
      return this.swapSecondaryGrossAmount(dAmount);
    }
  }

  getNetAmountIn(asset: Asset, amount: number): Decimal {
    const grossAmount = this.getGrossAmountIn(asset, amount);
    return this.subtractFee(grossAmount);
  }

  getAmountIn(asset: Asset, amount: number): Decimal {
    const dAmount = new Decimal(amount as number);
    let grossAmount: Decimal;
    if (asset === this.pool.primaryAsset) {
      grossAmount = this.swapPrimaryGrossAmount(dAmount);
    } else {
      grossAmount = this.swapSecondaryGrossAmount(dAmount);
    }
    return this.subtractFee(grossAmount);
  }

  getFee(asset: Asset, amount: number): Decimal {
    return this.getGrossAmountIn(asset, amount).sub(
      this.getNetAmountIn(asset, amount),
    );
  }

  getAssetPriceAfterLiqChange(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): Decimal {
    const newPrimaryLiq = this.primaryAssetAmount.add(primaryLiqChange);
    const newSecondaryLiq = this.secondaryAssetAmount.add(secondaryLiqChange);
    if (asset === this.pool.primaryAsset) {
      return this.getPrimaryAssetPrice(newPrimaryLiq, newSecondaryLiq);
    } else {
      return this.getSecondaryAssetPrice(newPrimaryLiq, newSecondaryLiq);
    }
  }

  getPriceChangePct(
    asset: Asset,
    primaryLiqChange: number,
    secondaryLiqChange: number,
  ): Decimal {
    const newPrice = this.getAssetPriceAfterLiqChange(
      asset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const oldPrice =
      asset === this.pool.primaryAsset
        ? this.primaryAssetPrice
        : this.secondaryAssetPrice;
    return newPrice.div(oldPrice).mul(100).sub(100);
  }

  private subtractFee(assetGrossAmount: Decimal) {
    return assetGrossAmount
      .mul(10000 - this.pool.feeBps)
      .div(10000)
      .trunc();
  }

  private swapPrimaryGrossAmount(assetAmount: Decimal) {
    const amount = new Decimal(assetAmount);
    return amount
      .mul(this.secondaryAssetAmount)
      .div(this.primaryAssetAmount.add(amount))
      .trunc();
  }

  private swapSecondaryGrossAmount(assetAmount: Decimal) {
    const amount = new Decimal(assetAmount);
    return amount
      .mul(this.primaryAssetAmount)
      .div(this.secondaryAssetAmount.add(amount))
      .trunc();
  }
}
