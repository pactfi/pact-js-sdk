import algosdk from "algosdk";

import { decodeUint64Array } from "../encoding";
import { Pool, fetchPoolById } from "../pool";
import { TransactionGroup } from "../transactionGroup";
import { getBoxMinBalance, parseState } from "../utils";

export type Signer = (group: TransactionGroup) => Promise<Uint8Array[]>;

export function getContractDeployCost(
  extraPages: number,
  numByteSlices: number,
  numUint: number,
  isAlgo: boolean,
) {
  let cost = 100_000 + 100_000 * extraPages;
  cost += numByteSlices * 50_000;
  cost += numUint * 28_500;
  cost += getBoxMinBalance(32, 8);

  // exchange opt-ins & min balance
  cost += isAlgo ? 300_000 : 400_000;

  return cost + 300000;
}

export type PoolBuildParams = {
  primaryAssetId: number;
  secondaryAssetId: number;
  feeBps: number;
};

export type PoolParams = PoolBuildParams & {
  version: number;
};

export type FactoryState = {
  poolVersion: number;
  allowedFeeBps: number[];
};

export class PoolParamsWrapper {
  static abi = new algosdk.ABIArrayStaticType(new algosdk.ABIUintType(64), 4);

  constructor(public params: PoolParams) {}

  asTuple(): [number, number, number, number] {
    return [
      this.params.primaryAssetId,
      this.params.secondaryAssetId,
      this.params.feeBps,
      this.params.version,
    ];
  }

  toBoxName(): Uint8Array {
    return PoolParamsWrapper.abi.encode(this.asTuple());
  }

  static fromBoxName(nameEncoded: Uint8Array): PoolParamsWrapper {
    const values = PoolParamsWrapper.abi.decode(nameEncoded);
    const params: PoolParams = {
      primaryAssetId: Number(values[0]),
      secondaryAssetId: Number(values[1]),
      feeBps: Number(values[2]),
      version: Number(values[3]),
    };
    return new PoolParamsWrapper(params);
  }
}

export function parseGlobalFactoryState(rawState: any[]): FactoryState {
  const state = parseState(rawState);
  return {
    poolVersion: state["POOL_CONTRACT_VERSION"],
    allowedFeeBps: decodeUint64Array(state["ALLOWED_FEE_BPS"]),
  };
}

export async function factoryListPools(
  algod: algosdk.Algodv2,
  factoryId: number,
): Promise<PoolParams[]> {
  const boxes = await algod.getApplicationBoxes(factoryId).do();
  return boxes["boxes"].map(
    (box) => PoolParamsWrapper.fromBoxName(box.name).params,
  );
}

export async function getPoolId(
  algod: algosdk.Algodv2,
  factoryId: number,
  poolParamsWrapper: PoolParamsWrapper,
): Promise<number> {
  const boxName = poolParamsWrapper.toBoxName();
  try {
    const box = await algod.getApplicationBoxByName(factoryId, boxName).do();
    return Number(new algosdk.ABIUintType(64).decode(box.value));
  } catch (e) {
    if (e instanceof Error && e.message.includes("box not found")) {
      return 0;
    }
    throw e;
  }
}

/**
 * Abstract class for pool factories.
 *
 * The pool factory allows decentralization of pools creation and discoverability. Each pool type has a separate factory contract that deploys the pool. Every pool created by the pool factory can be trusted as a valid Pact pool.
 *
 * The factory ensures pools uniqueness meaning you can't create two pools with the same parameters using a single factory contract.
 */
export abstract class PoolFactory {
  constructor(
    private algod: algosdk.Algodv2,
    public appId: number,
    public state: FactoryState,
  ) {}

  /**
   * Lists all pools created by this factory. It works by reading the boxes created by this factory. The boxes serve as a hash map of unlimited size. The box name stores pool parameters and the box content stores pool id.
   *
   * This method returns only pool parameters without the application id. You have to call `fetchPool` to fetch the actual pool e.g.
   *
   * const poolParams = await factory.listPools()
   * const pool = await factory.fetchPool(poolParams[0])
   *
   * @returns List of pool parameters.
   */
  listPools(): Promise<PoolParams[]> {
    return factoryListPools(this.algod, this.appId);
  }

  /**
   * Fetches the pool for the given params.
   *
   * @param poolParams Parameters of the pool with are looking for.
   * @returns A pool if pool with given parameters exists, None otherwise.
   */
  async fetchPool(poolParams: PoolParams): Promise<Pool | null> {
    const paramsWrapper = new PoolParamsWrapper(poolParams);
    const poolId = await getPoolId(this.algod, this.appId, paramsWrapper);
    if (poolId === 0) {
      return null;
    }
    return await fetchPoolById(this.algod, poolId);
  }

  /**
   * Deploys a new pool to the network.
   *
   * @param sender The address that is going to send the transactions.
   * @param poolParams Parameters of the pool that is going to be created.
   * @param signer A callback that allows signing the transaction.
   * @returns The created pool instance.
   */
  async build(
    sender: string,
    poolBuildParams: PoolBuildParams,
    signer: Signer,
  ): Promise<Pool> {
    if (!this.state.allowedFeeBps.includes(poolBuildParams.feeBps)) {
      throw new Error(
        `Only one of ${this.state.allowedFeeBps} is allowed for feeBps.`,
      );
    }

    const suggestedParams = await this.algod.getTransactionParams().do();
    const txGroup = this.buildTxGroup(sender, poolBuildParams, suggestedParams);
    const signedTxs = await signer(txGroup);
    await this.algod.sendRawTransaction(signedTxs).do();
    const txid = txGroup.transactions.at(-1)!.txID();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    const txinfo = await this.algod.pendingTransactionInformation(txid).do();
    const poolId = txinfo["inner-txns"][0]["application-index"];
    return await fetchPoolById(this.algod, poolId);
  }

  /**
   * Deploys a new pool to the network if the pool with the specified params does not exist yet. Otherwise, it returns the existing pool.
   *
   * @param sender The address that is going to send the transactions.
   * @param poolParams Parameters of the pool that is going to be created.
   * @param signer A callback that allows signing the transaction.
   * @returns The two items tuple. The first item is the created or existing pool. The second item is True if a new pool is created or False if an existing pool is returned.
   */
  async buildOrGet(
    sender: string,
    poolBuildParams: PoolBuildParams,
    signer: Signer,
  ): Promise<[Pool, boolean]> {
    try {
      const newPool = await this.build(sender, poolBuildParams, signer);
      return [newPool, true];
    } catch (err) {
      const params: PoolParams = {
        ...poolBuildParams,
        version: this.state.poolVersion,
      };
      const existingPool = await this.fetchPool(params);
      if (existingPool) {
        return [existingPool, false];
      }
      throw err;
    }
  }

  abstract buildTxGroup(
    sender: string,
    poolParams: PoolBuildParams,
    sp: algosdk.SuggestedParams,
  ): TransactionGroup;
}
