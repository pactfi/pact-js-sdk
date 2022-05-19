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

  amountDepositedToNetAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
  ): bigint {
    const grossAmountReceived = this.amountDepositedToGrossAmountReceived(
      asset,
      amountDeposited,
    );
    const fee = this.getFeeFromGrossAmount(grossAmountReceived);
    const netAmountReceived = grossAmountReceived - fee;
    return netAmountReceived;
  }

  netAmountReceivedToAmountDeposited(
    asset: Asset,
    netAmountReceived: bigint,
  ): bigint {
    const fee = this.getFeeFromNetAmount(netAmountReceived);
    netAmountReceived += fee;
    return this.grossAmountReceivedToAmountDeposited(asset, netAmountReceived);
  }

  getFeeFromGrossAmount(grossAmount: bigint): bigint {
    const feeBps = BigInt(this.pool.feeBps);
    return grossAmount - (grossAmount * (10_000n - feeBps)) / 10_000n;
  }

  getFeeFromNetAmount(netAmount: bigint): bigint {
    // Using D because of "ceil()"
    const dNetAmount = new D(netAmount.toString());
    return BigInt(
      dNetAmount
        .div((10_000 - this.pool.feeBps) / 10_000)
        .sub(dNetAmount)
        .ceil()
        .toNumber(),
    );
  }

  private grossAmountReceivedToAmountDeposited(
    asset: Asset,
    intGrossAmountReceived: bigint,
  ): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapAmountDeposited(
      A,
      B,
      intGrossAmountReceived,
    );
  }

  private amountDepositedToGrossAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
  ): bigint {
    const [A, B] = this.getLiquidities(asset);
    return this.swapCalculator.getSwapGrossAmountReceived(
      A,
      B,
      amountDeposited,
    );
  }

  private getLiquidities(asset: Asset): [bigint, bigint] {
    let [A, B] = [this.primaryAssetAmount, this.secondaryAssetAmount];
    if (asset.index !== this.pool.primaryAsset.index) {
      [A, B] = [B, A];
    }
    return [A, B];
  }

  getMinimumAmountReceived(
    asset: Asset,
    amountDeposited: bigint,
    slippagePct: bigint,
  ): bigint {
    const amountReceived = this.amountDepositedToNetAmountReceived(
      asset,
      amountDeposited,
    );
    return amountReceived - (amountReceived * slippagePct) / 100n;
  }

  getFee(asset: Asset, amountDeposited: bigint): bigint {
    return (
      this.amountDepositedToGrossAmountReceived(asset, amountDeposited) -
      this.amountDepositedToNetAmountReceived(asset, amountDeposited)
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

  getSwapPrice(assetDeposited: Asset, amountDeposited: bigint): number {
    const assetReceived = this.pool.getOtherAsset(assetDeposited);
    const amountReceived = this.amountDepositedToGrossAmountReceived(
      assetDeposited,
      amountDeposited,
    );
    const diff_ratio = assetDeposited.ratio / assetReceived.ratio;
    return (Number(amountReceived) / Number(amountDeposited)) * diff_ratio;
  }
}
