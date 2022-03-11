import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

export type SwapEffect = {
  amountIn: number;
  amountOut: number;
  minimumAmountIn: number;
  primaryAssetPriceAfterSwap: number;
  secondaryAssetPriceAfterSwap: number;
  primaryAssetPriceImpactPct: number;
  secondaryAssetPriceImpactPct: number;
  fee: number;
  price: number;
};

export class Swap {
  effect: SwapEffect;

  assetIn = this.pool.getOtherAsset(this.assetOut);

  constructor(
    public pool: Pool,
    public assetOut: Asset,
    public amountOut: number,
    public slippagePct: number,
  ) {
    this.validateSwap();
    this.effect = this.buildEffect();
  }

  prepareTxGroup(address: string): Promise<TransactionGroup> {
    return this.pool.prepareSwapTxGroup({ swap: this, address });
  }

  private validateSwap() {
    if (this.slippagePct < 0 || this.slippagePct > 100) {
      throw Error("Splippage must be between 0 and 100");
    }
    if (this.pool.calculator.isEmpty) {
      throw Error("Pool is empty and swaps are impossible.");
    }
  }

  private buildEffect(): SwapEffect {
    const amountIn = Math.floor(
      this.pool.calculator
        .getAmountIn(this.assetOut, this.amountOut)
        .toNumber(),
    );

    let primaryLiqChange, secondaryLiqChange: number;
    if (this.assetOut.index === this.pool.primaryAsset.index) {
      primaryLiqChange = this.amountOut;
      secondaryLiqChange = -amountIn;
    } else {
      primaryLiqChange = -amountIn;
      secondaryLiqChange = this.amountOut;
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

    return {
      amountOut: this.amountOut,
      amountIn,
      minimumAmountIn: Math.floor(
        this.pool.calculator
          .getMinimumAmountIn(this.assetOut, this.amountOut, this.slippagePct)
          .toNumber(),
      ),
      price: this.pool.calculator.getSwapPrice(this.assetOut, this.amountOut),
      primaryAssetPriceAfterSwap,
      secondaryAssetPriceAfterSwap,
      primaryAssetPriceImpactPct: this.pool.calculator
        .getPriceImpactPct(
          this.pool.primaryAsset,
          primaryLiqChange,
          secondaryLiqChange,
        )
        .toNumber(),
      secondaryAssetPriceImpactPct: this.pool.calculator
        .getPriceImpactPct(
          this.pool.secondaryAsset,
          primaryLiqChange,
          secondaryLiqChange,
        )
        .toNumber(),
      fee: Math.ceil(
        this.pool.calculator.getFee(this.assetOut, this.amountOut).toNumber(),
      ),
    };
  }
}
