import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

export type SwapStats = {
  amountIn: number;
  amountOut: number;
  minimumAmountIn: number;
  primaryAssetPriceAfterSwap: number;
  secondaryAssetPriceAfterSwap: number;
  primaryAssetPriceChangePct: number;
  secondaryAssetPriceChangePct: number;
  fee: number;
  price: number;
};

export class Swap {
  stats: SwapStats;

  constructor(
    private pool: Pool,
    public asset: Asset,
    public amount: number,
    public slippagePct: number,
  ) {
    const amountOut = amount;
    const amountIn = Math.floor(
      this.pool.calculator.getAmountIn(asset, amount).toNumber(),
    );

    let primaryLiqChange, secondaryLiqChange: number;
    if (asset === pool.primaryAsset) {
      primaryLiqChange = amountOut;
      secondaryLiqChange = -amountIn;
    } else {
      primaryLiqChange = -amountIn;
      secondaryLiqChange = amount;
    }

    const primaryAssetPriceAfterSwap = this.pool.calculator
      .getAssetPriceAfterLiqChange(
        this.pool.primaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      )
      .toNumber();
    const secondaryAssetPriceAfterSwap = this.pool.calculator
      .getAssetPriceAfterLiqChange(
        this.pool.secondaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      )
      .toNumber();

    this.stats = {
      amountOut,
      amountIn,
      minimumAmountIn: Math.floor(
        this.pool.calculator
          .getMinimumAmountIn(asset, amount, slippagePct)
          .toNumber(),
      ),
      price: this.pool.calculator
        .getGrossAmountIn(asset, amount)
        .div(amountOut)
        .toNumber(),
      primaryAssetPriceAfterSwap,
      secondaryAssetPriceAfterSwap,
      primaryAssetPriceChangePct: this.pool.calculator
        .getPriceChangePct(asset, primaryLiqChange, secondaryLiqChange)
        .toNumber(),
      secondaryAssetPriceChangePct: this.pool.calculator
        .getPriceChangePct(
          this.pool.getOtherAsset(asset),
          primaryLiqChange,
          secondaryLiqChange,
        )
        .toNumber(),
      fee: Math.round(this.pool.calculator.getFee(asset, amount).toNumber()),
    };
  }

  prepareTx(address: string): Promise<TransactionGroup> {
    return this.pool.prepareSwapTx(this, address);
  }
}
