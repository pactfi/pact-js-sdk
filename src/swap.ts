import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

export type SwapEffect = {
  amountReceived: number;
  amountDeposited: number;
  minimumAmountReceived: number;
  primaryAssetPriceAfterSwap: number;
  secondaryAssetPriceAfterSwap: number;
  primaryAssetPriceImpactPct: number;
  secondaryAssetPriceImpactPct: number;
  fee: number;
  price: number;
};

export class Swap {
  effect: SwapEffect;

  assetReceived = this.pool.getOtherAsset(this.assetDeposited);

  constructor(
    public pool: Pool,
    public assetDeposited: Asset,
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

    let amountReceived: number;
    let amountDeposited: number;
    if (this.isReversed) {
      amountReceived = this.amount;
      amountDeposited = Number(
        calc.netAmountReceivedToAmountDeposited(
          this.assetDeposited,
          BigInt(this.amount),
        ),
      );
    } else {
      amountReceived = Number(
        calc.amountDepositedToNetAmountReceived(
          this.assetDeposited,
          BigInt(this.amount),
        ),
      );
      amountDeposited = this.amount;
    }

    let primaryLiqChange, secondaryLiqChange: number;
    if (this.assetDeposited.index === this.pool.primaryAsset.index) {
      primaryLiqChange = amountDeposited;
      secondaryLiqChange = -amountReceived;
    } else {
      primaryLiqChange = -amountReceived;
      secondaryLiqChange = amountDeposited;
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
      amountDeposited,
      amountReceived,
      minimumAmountReceived: Number(
        calc.getMinimumAmountReceived(
          this.assetDeposited,
          BigInt(amountDeposited),
          BigInt(this.slippagePct),
        ),
      ),
      price: calc.getSwapPrice(this.assetDeposited, BigInt(amountDeposited)),
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
      fee: Number(calc.getFee(this.assetDeposited, BigInt(amountDeposited))),
    };
  }
}
