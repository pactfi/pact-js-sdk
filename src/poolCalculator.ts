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

  get rate() {
    if (this.isEmpty) {
      return new Decimal(0);
    }
    return this.primaryAssetAmount
      .div(this.pool.primaryAsset.ratio)
      .div(this.secondaryAssetAmount.div(this.pool.secondaryAsset.ratio));
  }

  get rateReversed() {
    if (this.isEmpty) {
      return new Decimal(0);
    }
    return this.secondaryAssetAmount
      .div(this.pool.secondaryAsset.ratio)
      .div(this.primaryAssetAmount.div(this.pool.primaryAsset.ratio));
  }

  getMinimumExpected(
    asset: Asset,
    amount: number | bigint,
    slippage: number,
  ): number {
    let swap: Decimal;
    const dAmount = new Decimal(amount as number);
    if (asset === this.pool.primaryAsset) {
      swap = this.swapPrimary(dAmount);
    } else {
      swap = this.swapSecondary(dAmount);
    }
    return Math.floor(swap.sub(swap.mul(slippage / 100)).toNumber());
  }

  private swapPrimary(assetAmount: Decimal) {
    return this.subtractFee(this.swapPrimaryGrossAmount(assetAmount));
  }

  private swapSecondary(assetAmount: Decimal) {
    return this.subtractFee(this.swapSecondaryGrossAmount(assetAmount));
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
