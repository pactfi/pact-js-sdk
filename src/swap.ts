import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

/**
 * Swap Effect are the basic details of the effect on the pool of performing the swap.
 */
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

/**
 * Swap class represents a swap trade on a particular pool.
 *
 * Typically, users don't have to manually instantiate this class. Use [[Pool.prepareSwap]] instead.
 */
export class Swap {
  /**
   * The pool the swap is going to be performed in.
   */
  pool: Pool;

  /** The effect of the swap computed at the time of construction. */
  effect: SwapEffect;

  /**
   * The asset that will be swapped (deposited in the contract).
   */
  assetDeposited: Asset;

  /** The asset that will be received. */
  assetReceived: Asset;

  /**
   * Either the amount to swap (deposit) or the amount to receive depending on the `swapForExact` parameter.
   */
  amount: number;

  /**
   * The maximum amount of slippage allowed in performing the swap.
   */
  slippagePct: number;

  /**
   * If `true` then `amount` is what you want to receive from the swap. Otherwise, it's an amount that you want to swap (deposit). Note that the contracts do not support the "swap exact for" swap. It works by calculating the amount to deposit on the client side and doing a normal swap on the exchange.
   */
  swapExactFor = false;

  /**
   * @param pool The pool the swap is going to be performed in.
   * @param assetDeposited The asset that will be swapped (deposited in the contract).
   * @param amount Either the amount to swap (deposit) or the amount to receive depending on the `swapExactFor` parameter.
   * @param slippagePct The maximum amount of slippage allowed in performing the swap.
   * @param swapExactFor If `true` then `amount` is what you want to receive from the swap. Otherwise, it's an amount that you want to swap (deposit).
   */
  constructor(
    pool: Pool,
    assetDeposited: Asset,
    amount: number,
    slippagePct: number,
    swapExactFor = false,
  ) {
    this.pool = pool;
    this.assetDeposited = assetDeposited;
    this.assetReceived = this.pool.getOtherAsset(this.assetDeposited);
    this.amount = amount;
    this.slippagePct = slippagePct;
    this.swapExactFor = swapExactFor;

    this.validateSwap();
    this.effect = this.buildEffect();
  }

  /**
   * Creates the transactions needed to perform the swap trade and returns them as a transaction group ready to be signed and committed.
   *
   * @param address The account that will be performing the swap.
   *
   * @returns A transaction group that when executed will perform the swap.
   */
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
    if (this.swapExactFor) {
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
          BigInt(Math.round(this.slippagePct * 100)),
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
