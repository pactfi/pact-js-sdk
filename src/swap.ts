import { Asset } from "./asset";
import { Pool } from "./pool";
import { TransactionGroup } from "./transactionGroup";

/**
 * Swap Effect are the basic details of the effect on the pool of performing the swap.
 *
 * The swap effect contains the assets in and out for the swap including the minimum amount
 * to deposit based on the slippage allowed, the fee incurred and the implied price from the in and
 * out assets.
 *
 * It also includes the effect on the liquidity pool with the new primary and secondary asset amounts, and the
 * percentage change this represents.
 *
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
 * Swap class represents a swap trade if an amount of asset on a particular pool.
 *
 * The swap class contains methods to ensure the swap is valid and prepare the transaction. It also contains
 * a method to report the effect of the swap on the current pool values.
 */
export class Swap {
  /** The effect of the swap computed at the time of construction. */
  effect: SwapEffect;

  /** The asset received from the contract. */
  assetReceived = this.pool.getOtherAsset(this.assetDeposited);

  /**
   * Creates a Swap Trade for a given amount of received asset based in the given liquidity pool.
   *
   * Note that as part of construction this function validates the inputs and will throw and error if
   * the parameters are invalid. See validateSwap for details of the validation done.
   * The constructor will also record the effect of the swap based on the current pool values.
   *
   * @param pool the pool the swap is going to be performed in.
   * @param assetDeposited the asset that will be swapped (deposited in the contract).
   * @param amount Either the amount to swap (deposit) or the amount to receive depending on the `isReversed` parameter.
   * @param slippagePct the maximum amount of slippage allowed in performing the swap.
   * @param isReversed If `true` then `amount` is what you want to receive from the swap. Otherwise, it's an amount that you want to swap (deposit). Note that the contracts do not support the "reversed" swap. It works by calculating the amount to deposit on the client side and doing a normal swap on the exchange.
   */
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

  /**
   * Creates the transactions needed to perform the swap trade and returns them as a transaction group ready to be signed and committed.
   *
   * @param address the account that will be performing the swap
   * @returns A TransactionGroup that can perform the swap. There will be two transactions in the group.
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
