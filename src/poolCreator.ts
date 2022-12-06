import algosdk from "algosdk";

import {
  CompileContractParams,
  CompiledAppFundTxn,
  CompiledContract,
  CompiledNoopTxn,
  TxnBlob,
  compileContract,
  deployContract,
  listPools,
  prepareContractTxns,
  sendContractTxns,
} from "./api";
import { encode, encodeArray } from "./encoding";
import { PactApiError, PactSdkError } from "./exceptions";
import { TransactionGroup } from "./transactionGroup";

export type NewPoolParams = Omit<CompileContractParams, "sender">;

/**
 * PoolCreator class, used to create, deploy and fund a new pool in Pact.
 *
 * In order to properly create a new pool, functions must be run in this exact order:
 * - [[preparePoolCreationTx]],
 * - [[deployPool]],
 * - [[buildFundingTxs]] or [[prepareFundingTxGroup]]
 * - [[sendFundingTxs]].
 *
 * This class records the order of executed functions and will throw an error if any of them is triggered in the wrong order.
 */
export class PoolCreator {
  /**
   * Pact API URL to use.
   */
  pactApiUrl: string;

  /**
   * Params required in new pool creation.
   */
  poolParams: NewPoolParams;

  /**
   * An Id of created pool. Will be assigned automatically on [[deployPool]] function.
   */
  poolId: number | null = null;

  /**
   * @param params Params required in new pool creation.
   * @param pactApiUrl Pact API URL to use. If not provided, "https://api.pact.fi" will be used.
   */
  constructor(params: NewPoolParams, pactApiUrl?: string) {
    this.pactApiUrl = pactApiUrl ?? "https://api.pact.fi";

    const [primary_asset_id, secondary_asset_id] = [
      params.primary_asset_id,
      params.secondary_asset_id,
    ]
      .map(Number)
      .sort((a, b) => a - b);
    const sortedParams = {
      ...params,
      primary_asset_id: primary_asset_id.toString(),
      secondary_asset_id: secondary_asset_id.toString(),
    };

    this.poolParams = sortedParams;
  }

  /**
   * Creates a transaction needed to perform pool creation ready to be signed and committed.
   *
   * IMPORTANT!: Signed transaction must be send by [[deployPool]] function in order to save the pool in Pact's database.
   *
   * @param address Sender account address.
   *
   * @throws PactSdkError if any pool param is missing or wrong.
   * @throws PactApiError if something wrong occurs during sending data to Pact API.
   *
   * @returns A transaction that when executed will create a new pool.
   */
  async preparePoolCreationTx(address: string) {
    await this.validate(this.poolParams);

    try {
      const poolData = await compileContract(this.pactApiUrl, {
        ...this.poolParams,
        sender: address,
      });
      const tx = this.makeAppCreateTx(address, poolData);
      tx.fee = poolData.fee;
      return tx;
    } catch (e: any) {
      throw this.handleError(e);
    }
  }

  /**
   * Deploys a pool created from the transaction in [[preparePoolCreationTx]] to the Pact database.
   * If successful, PoolCreator will store the new pool id in a [[poolId]].
   *
   * @param txBlob Signed transaction blob.
   *
   * @throws PactApiError if something wrong occurs during sending data to Pact API.
   *
   * @returns An Id of the newly deployed pool.
   */
  async deployPool(txBlob: string) {
    try {
      const poolData = await deployContract(this.pactApiUrl, { blob: txBlob });
      this.poolId = poolData.appid;
      return this.poolId;
    } catch (e: any) {
      throw this.handleError(e);
    }
  }

  /**
   * Creates the transactions needed for pool to work properly and returns them as a transaction group ready to be signed and committed.
   *
   * @param address Sender account address.
   *
   * @throws PactSdkError if poolId was not generated yet.
   * @throws PactApiError if something wrong occurs during sending data to Pact API.
   *
   * @returns A transaction group that when executed will fund the pool, create liquidity tokens and opt-in assets.
   */
  async prepareFundingTxGroup(address: string) {
    try {
      const txs = await this.buildFundingTxs(address);
      return new TransactionGroup(txs);
    } catch (e: any) {
      throw this.handleError(e);
    }
  }

  /**
   * Builds three transactions:
   * - Fund pool with ALGO required to perform basic smart-contract operations.
   * - Noop transaction that creates liquidity tokens.
   * - Noop transaction that performs an opt-in to pool's primary and secondary assets.
   *
   * IMPORTANT!: Signed transactions must be send by [[sendFundingTxs]] function in order to save all required data in Pact's database.
   *
   * @param address Sender account address.
   *
   * @throws PactSdkError if poolId was not generated yet.
   * @throws PactApiError if something wrong occurs during sending data to Pact API.
   *
   * @returns Array of described transactions.
   */
  async buildFundingTxs(address: string) {
    if (!this.poolId) {
      throw new PactSdkError("Pool Id was not generated yet.");
    }
    try {
      const txsData = await prepareContractTxns(this.pactApiUrl, {
        ...this.poolParams,
        appid: this.poolId,
        sender: address,
      });

      const tx1 = this.makeNewAppFundTx(address, this.poolId, txsData[0]);
      const tx2 = this.makeNewAppNoopTx(address, txsData[1]);
      const tx3 = this.makeNewAppNoopTx(address, txsData[2]);

      const txs = [tx1, tx2, tx3];
      for (let i = 0; i < 3; i++) {
        txs[i].fee = txsData[i].fee;
      }

      return txs;
    } catch (e: any) {
      throw this.handleError(e);
    }
  }

  /**
   * Sends signed transactions created in [[buildFundingTxs]] to the Pact's database.
   * If successful, the new pool will become visible in the Pact UI.
   * It is strongly advised to immediately add the first liquidity to the pool after this step, as it will determine the future ratio of assets.
   *
   * @param blobs Signed transaction blobs. The number of blobs must be equal to 3.
   *
   * @throws PactSdkError if the number of provided blobs is not correct, or if poolId was not generated yet.
   * @throws PactApiError if something wrong occurs during sending data to Pact API.
   *
   * @returns A new Pool object.
   */
  async sendFundingTxs(blobs: TxnBlob[]) {
    if (blobs.length !== 3) {
      throw new PactSdkError(
        `3 transaction blobs were expected, but received ${blobs.length}.`,
      );
    }
    if (!this.poolId) {
      throw new PactSdkError("Pool Id was not generated yet.");
    }
    try {
      return await sendContractTxns(this.pactApiUrl, blobs);
    } catch (e: any) {
      throw this.handleError(e);
    }
  }

  private handleError(e: any) {
    if (e.response && Array.isArray(e.response.data)) {
      return new PactApiError(e.response.data.join(", "));
    }
    return new PactApiError(e.toString());
  }

  private async validate(params: NewPoolParams) {
    if (!this.pactApiUrl) {
      throw new PactSdkError("No pactApiUrl provided.");
    }
    if (
      !params.fee_bps ||
      !Number.isInteger(params.fee_bps) ||
      params.fee_bps < 1 ||
      params.fee_bps > 10_000
    ) {
      throw new PactSdkError("Wrong fee_bps provided.");
    }
    if (
      !params.primary_asset_id ||
      !params.secondary_asset_id ||
      params.primary_asset_id === params.secondary_asset_id
    ) {
      throw new PactSdkError("Wrong asset ids provided.");
    }

    const pools = await listPools(this.pactApiUrl, {
      primary_asset__algoid: params.primary_asset_id,
      secondary_asset__algoid: params.secondary_asset_id,
    });
    const isRepeated = pools.results
      .filter((p) => p.version > 1)
      .some((p) => p.fee_bps === params.fee_bps);
    if (isRepeated) {
      throw new PactSdkError(
        "A pool with given assets and fee already exists.",
      );
    }
  }

  private makeAppCreateTx(accountAddress: string, poolData: CompiledContract) {
    const tx = {
      appApprovalProgram: new Uint8Array(poolData.apap),
      appArgs: [],
      appClearProgram: new Uint8Array(poolData.apsu),
      appForeignAssets: poolData.apas,
      appGlobalByteSlices: poolData.apgs.nbs || 0,
      appGlobalInts: poolData.apgs.nui || 0,
      appIndex: 0,
      appOnComplete: poolData.apan,
      fee: poolData.fee,
      firstRound: poolData.fv,
      flatFee: false,
      from: accountAddress,
      genesisHash: new Uint8Array(poolData.gh),
      genesisID: poolData.gen,
      lastRound: poolData.lv,
      name: "Transaction",
      type: poolData.type,
      extraPages: poolData.apep || 1,
    } as any;
    return new algosdk.Transaction(tx);
  }

  private makeNewAppFundTx(
    accountAddress: string,
    newAppID: number,
    txnData: CompiledAppFundTxn,
  ) {
    const escrowAddress = algosdk.getApplicationAddress(newAppID);
    const tx = {
      amount: txnData.amt,
      appArgs: [],
      fee: txnData.fee,
      flatFee: false,
      firstRound: txnData.fv,
      lastRound: txnData.lv,
      from: accountAddress,
      to: escrowAddress,
      genesisHash: new Uint8Array(txnData.gh),
      genesisID: txnData.gen,
      name: "Transaction",
      type: txnData.type,
    } as any;
    return new algosdk.Transaction(tx);
  }

  private makeNewAppNoopTx(
    accountAddress: string,
    txnData: CompiledNoopTxn,
    encodedAppArgs?: Uint8Array[],
  ) {
    const appArgs = encodeArray(txnData.apaa);
    const tx = {
      appArgs: encodedAppArgs ?? appArgs,
      appForeignAssets: txnData.apas,
      appIndex: txnData.apid,
      appOnComplete: txnData.apan,
      fee: txnData.fee,
      flatFee: true,
      firstRound: txnData.fv,
      lastRound: txnData.lv,
      from: accountAddress,
      genesisHash: new Uint8Array(txnData.gh),
      genesisID: txnData.gen,
      name: "Transaction",
      type: txnData.type,
    } as any;
    if (txnData.apat) {
      tx.appAccounts = txnData.apat.map((x) =>
        algosdk.encodeAddress(encode(x)),
      );
    }
    return new algosdk.Transaction(tx);
  }
}
