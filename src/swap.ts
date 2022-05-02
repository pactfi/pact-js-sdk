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
    public amount: number,
    public slippagePct: number,
    public isReversed = false,
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
    const calc = this.pool.calculator;

    let amountIn: number;
    let amountOut: number;
    if (this.isReversed) {
      amountIn = this.amount;
      amountOut = Number(
        calc.netAmountInToAmountOut(this.assetOut, BigInt(this.amount)),
      );
    } else {
      amountIn = Number(
        calc.amountOutToNetAmountIn(this.assetOut, BigInt(this.amount)),
      );
      amountOut = this.amount;
    }

    let primaryLiqChange, secondaryLiqChange: number;
    if (this.assetOut.index === this.pool.primaryAsset.index) {
      primaryLiqChange = amountOut;
      secondaryLiqChange = -amountIn;
    } else {
      primaryLiqChange = -amountIn;
      secondaryLiqChange = amountOut;
    }

    const primaryAssetPriceAfterSwap = calc.getAssetPriceAfterLiqChange(
      this.pool.primaryAsset,
      primaryLiqChange,
      secondaryLiqChange,
    );
    const secondaryAssetPriceAfterSwap = calc.getAssetPriceAfterLiqChange(
      this.pool.secondaryAsset,
      primaryLiqChange,
      secondaryLiqChange,
    );

    return {
      amountOut,
      amountIn,
      minimumAmountIn: Number(
        calc.getMinimumAmountIn(
          this.assetOut,
          BigInt(amountOut),
          BigInt(this.slippagePct),
        ),
      ),
      price: calc.getSwapPrice(this.assetOut, BigInt(amountOut)),
      primaryAssetPriceAfterSwap,
      secondaryAssetPriceAfterSwap,
      primaryAssetPriceImpactPct: calc.getPriceImpactPct(
        this.pool.primaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      ),
      secondaryAssetPriceImpactPct: calc.getPriceImpactPct(
        this.pool.secondaryAsset,
        primaryLiqChange,
        secondaryLiqChange,
      ),
      fee: Number(calc.getFee(this.assetOut, BigInt(amountOut))),
    };
  }
}
