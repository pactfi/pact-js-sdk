import { getConstantProductMintedLiquidityTokens } from "./constantProductCalculator";
import { PactSdkError } from "./exceptions";
import { isqrt } from "./isqrt";
import { Pool, StableswapPoolParams } from "./pool";
import { SwapCalculator } from "./types";

const MAX_GET_PRICE_RETRIES = 5;

export class ConvergenceError extends PactSdkError {}

function dAbs(value: bigint) {
  return value >= 0 ? value : -value;
}

/**
 * To calculate the pool invariant, a Newton-Raphson method is used in both - the SDK and the smart contract.
 * Algorand has a limit of the number of operations available in a single app call. To increase the limit, an additional empty inner transaction have to be created. Each extra tx increases tx fee. This functions calculates the fee needed for a swap transaction.
 *
 * @param invariantIterations Number of iterations of Newton-Raphson interpolation.
 * @param extraMargin Number of extra inner transactions needed in case of slippage.
 *
 * @returns The required fee.
 */
export function getTxFee(
  invariantIterations: number,
  extraMargin: number,
): number {
  const innerTxCount = Math.ceil((invariantIterations * 369) / 700);
  // +1 - first obligatory inner tx
  // +1 - app call
  // +2 in total
  return (innerTxCount + 2 + extraMargin) * 1000;
}

/**
 * Returns a tuple of minted tokens and total Newton-Raphson iterations (needed for tx fee calculations).
 */
export function getStableswapMintedLiquidityTokens(
  addedPrimary: bigint,
  addedSecondary: bigint,
  totalPrimary: bigint,
  totalSecondary: bigint,
  totalLiquidity: bigint,
  amplifier: bigint,
  precision: bigint,
  feeBps: bigint,
): [bigint, number] {
  if (totalPrimary + totalSecondary === 0n) {
    const mintedTokens = getConstantProductMintedLiquidityTokens(
      addedPrimary,
      addedSecondary,
      totalPrimary,
      totalSecondary,
      totalLiquidity,
    );
    return [mintedTokens, 0];
  }

  const initialTotals: [bigint, bigint] = [totalPrimary, totalSecondary];
  const updatedTotals: [bigint, bigint] = [
    totalPrimary + addedPrimary,
    totalSecondary + addedSecondary,
  ];

  const [fees, initialD, invariantIterations] = getAddLiquidityFees(
    initialTotals,
    updatedTotals,
    feeBps,
    amplifier,
    precision,
  );
  const [nextD, nextIterations] = getInvariant(
    updatedTotals[0] - fees[0],
    updatedTotals[1] - fees[1],
    amplifier,
    precision,
  );

  return [
    (totalLiquidity * (nextD - initialD)) / initialD,
    invariantIterations + nextIterations,
  ];
}

export function getAddLiquidityBonusPct(
  addedPrimary: bigint,
  addedSecondary: bigint,
  totalPrimary: bigint,
  totalSecondary: bigint,
  feeBps: bigint,
  amplifier: bigint,
  precision: bigint,
) {
  if (totalPrimary + totalSecondary === 0n) {
    return 0;
  }

  const initialTotals: [bigint, bigint] = [totalPrimary, totalSecondary];
  const updatedTotals: [bigint, bigint] = [
    totalPrimary + addedPrimary,
    totalSecondary + addedSecondary,
  ];

  const [fees, initialD] = getAddLiquidityFees(
    initialTotals,
    updatedTotals,
    feeBps,
    amplifier,
    precision,
  );

  const finalBalances = [
    updatedTotals[0] - fees[0],
    updatedTotals[1] - fees[1],
  ];

  const [finalD] = getInvariant(
    finalBalances[0],
    finalBalances[1],
    amplifier,
    precision,
  );

  // Calculate the gain in absolute terms, considering that each token is worth 1.
  const totalAdded = Number(addedPrimary + addedSecondary);
  return (Number(finalD - initialD) / totalAdded - 1) * 100;
}

export function getAddLiquidityFees(
  initialTotals: [bigint, bigint],
  updatedTotals: [bigint, bigint],
  feeBps: bigint,
  amplifier: bigint,
  precision: bigint,
): [[bigint, bigint], bigint, number] {
  const n = 2n;

  const [initialD, initialIterations] = getInvariant(
    initialTotals[0],
    initialTotals[1],
    amplifier,
    precision,
  );

  // Calculate the invariant as if all tokens were added to the pool.
  const [nextD, nextIterations] = getInvariant(
    updatedTotals[0],
    updatedTotals[1],
    amplifier,
    precision,
  );

  const perfectBalances = initialTotals.map(
    (total) => (nextD * total) / initialD,
  );
  const deltas = [
    dAbs(updatedTotals[0] - perfectBalances[0]),
    dAbs(updatedTotals[1] - perfectBalances[1]),
  ];

  const fees = deltas.map(
    (delta) => (delta * feeBps * n) / (10_000n * (4n * (n - 1n))),
  ) as [bigint, bigint];

  return [fees, initialD, initialIterations + nextIterations];
}

/**
 * Uses a Newton-Raphson method to calculate the pool invariant.
 *
 * @returns A tuple of invariant and number of iterations required to calculate the invariant.
 */
export function getInvariant(
  liqA: bigint,
  liqB: bigint,
  amp: bigint,
  precision: bigint,
): [bigint, number] {
  const tokens_total = liqA + liqB;
  const S = tokens_total;
  if (S === 0n) {
    return [S, 0];
  }

  let D = S;
  const Ann = amp * 4n;

  let i = 0;
  let Dprev = D;
  while (i < 64) {
    i += 1;

    let D_P = D * D * D;
    D_P /= liqA * liqB * 4n;

    Dprev = D;
    const numerator = D * ((Ann * S) / precision + D_P * 2n);
    const divisor = ((Ann - precision) * D) / precision + 3n * D_P;
    D = numerator / divisor;
    if (D > Dprev) {
      if (D - Dprev <= 1n) {
        break;
      }
    } else if (Dprev - D <= 1n) {
      break;
    }
  }
  if (i === 64) {
    throw new ConvergenceError(`Didn't converge Dprev=${Dprev}, D=${D}`);
  }
  return [D, i];
}

export function getNewLiq(
  liqOther: bigint,
  amplifier: bigint,
  inv: bigint,
  precision: bigint,
): bigint {
  const S = liqOther;
  const D = inv;
  const A = amplifier;
  const P = liqOther;
  const Ann = A * 4n;

  const b = S + (D * precision) / Ann;
  const c = (precision * (D * D * D)) / (4n * P * Ann);

  const a_q = 1n;
  const b_q = b - D;
  const c_q = -c;

  const delta = b_q * b_q - 4n * a_q * c_q;
  return (-b_q + isqrt(delta)) / (2n * a_q);
}

export function getAmplifier(
  initialA: number,
  initialATime: number,
  futureA: number,
  futureATime: number,
): bigint {
  // Linear interpolation based on current timestamp.
  const now = Date.now() / 1000; // Convert miliseconds to seconds.
  const dt = futureATime - initialATime;
  const dv = futureA - initialA;
  if (!dt || !dv) {
    return BigInt(futureA);
  }

  const dvPerSecond = dv / dt;

  const [minA, maxA] =
    futureA > initialA ? [initialA, futureA] : [futureA, initialA];

  let currentA = initialA + (now - initialATime) * dvPerSecond;
  currentA = Math.max(minA, Math.min(maxA, Math.round(currentA)));

  return BigInt(currentA);
}

/**
 * An implementation of a math behind stableswap pools.
 */
export class StableswapCalculator implements SwapCalculator {
  /** Keeps the amount of iteration used to calculate invariant in the last call to getSwapGrossAmountReceived or getSwapAmountDeposited. Needed to calculate transaction fee. */
  swapInvariantIterations = 0;

  /** The same as swapInvariantIterations but for adding liquidity. */
  mintTokensInvariantIterations = 0;

  constructor(public pool: Pool) {}

  get stableswapParams() {
    return this.pool.params as StableswapPoolParams;
  }

  getAmplifier(): bigint {
    const params = this.stableswapParams;
    return getAmplifier(
      params.initialA,
      params.initialATime,
      params.futureA,
      params.futureATime,
    );
  }

  /**
   * May return NaN for highly unbalanced pools.
   */
  getPrice(decimalLiqA: number, decimalLiqB: number): number {
    if (!decimalLiqA || !decimalLiqB) {
      return 0;
    }

    const ratio = this.pool.primaryAsset.ratio;
    if (ratio !== this.pool.secondaryAsset.ratio) {
      console.warn(
        "Number of decimals differs between primary and secondary asset. Stableswap does not support this scenario correctly.",
      );
    }

    return this._getPrice(decimalLiqA, decimalLiqB, MAX_GET_PRICE_RETRIES);
  }

  /**
   * Price is calculated by simulating a swap for 10**6 of micro values.
   * This price is highly inaccurate for low liquidity pools.
   * In case of ConvergenceError we try to simulate a swap using a different swap amount.
   * Returns NaN if all retries will fail.
   */
  private _getPrice(
    decimalLiqA: number,
    decimalLiqB: number,
    retries: number,
  ): number {
    if (retries <= 0) {
      return NaN;
    }

    const ratio = this.pool.primaryAsset.ratio;
    const nLiqA = decimalLiqA * ratio;
    const nLiqB = decimalLiqB * ratio;
    const liqA = BigInt(Math.round(nLiqA));
    const liqB = BigInt(Math.round(nLiqB));
    const nAmountDeposited = 10 ** (6 + MAX_GET_PRICE_RETRIES - retries);
    const amountDeposited = BigInt(
      // The division helps minimize price impact of simulated swap.
      Math.round(Math.min(nAmountDeposited, nLiqA / 100, nLiqB / 100)),
    );

    try {
      const amountReceived = this.getSwapGrossAmountReceived(
        liqB,
        liqA,
        amountDeposited,
        false,
      );
      if (amountReceived === 0n) {
        return this._getPrice(decimalLiqA, decimalLiqB, retries - 1);
      }
      return Number(amountDeposited) / Number(amountReceived);
    } catch (error: any) {
      if (error instanceof ConvergenceError) {
        return this._getPrice(decimalLiqA, decimalLiqB, retries - 1);
      }
      throw error;
    }
  }

  getSwapGrossAmountReceived(
    liqA: bigint,
    liqB: bigint,
    amountDeposited: bigint,
    saveIterations = true,
  ): bigint {
    const precision = BigInt(this.stableswapParams.precision);
    const amplifier = this.getAmplifier();

    const [invariant, invariantIterations] = getInvariant(
      liqA,
      liqB,
      amplifier,
      precision,
    );
    if (saveIterations) {
      this.swapInvariantIterations = invariantIterations;
    }
    const newLiqB = getNewLiq(
      liqA + amountDeposited,
      amplifier,
      invariant,
      precision,
    );
    return liqB - newLiqB;
  }

  getSwapAmountDeposited(
    liqA: bigint,
    liqB: bigint,
    grossAmountReceived: bigint,
    saveIterations = true,
  ): bigint {
    const precision = BigInt(this.stableswapParams.precision);
    const amplifier = this.getAmplifier();
    const [invariant, invariantIterations] = getInvariant(
      liqA,
      liqB,
      amplifier,
      precision,
    );
    if (saveIterations) {
      this.swapInvariantIterations = invariantIterations;
    }
    const newLiqA = getNewLiq(
      liqB - grossAmountReceived,
      amplifier,
      invariant,
      precision,
    );
    return newLiqA - liqA;
  }

  getMintedLiquidityTokens(addedLiqA: bigint, addedLiqB: bigint): bigint {
    const precision = BigInt(this.stableswapParams.precision);
    const amplifier = this.getAmplifier();

    const [mintedTokens, iterations] = getStableswapMintedLiquidityTokens(
      addedLiqA,
      addedLiqB,
      BigInt(this.pool.state.totalPrimary),
      BigInt(this.pool.state.totalSecondary),
      BigInt(this.pool.state.totalLiquidity),
      amplifier,
      precision,
      BigInt(this.pool.feeBps),
    );

    this.mintTokensInvariantIterations = iterations;

    if (mintedTokens > 0n) {
      return mintedTokens;
    }

    if (mintedTokens === 0n) {
      throw new PactSdkError(
        "Amount of minted liquidity tokens must be greater then 0.",
      );
    }

    /**
     * Add liquidity fee is always taken from both assets, even if the user provided only one asset as the liquidity. In this case, the fee is taken from current pool's liquidity.
     * If the current liquidity is not high enough to cover the fee, the contract will fail.
     * In the SDK calculations this results in mintedTokens < 0.
     */
    throw new PactSdkError(
      "Pool liquidity too low to cover add liquidity fee.",
    );
  }
}
