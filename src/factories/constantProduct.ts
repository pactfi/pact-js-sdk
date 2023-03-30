import algosdk from "algosdk";

import { TransactionGroup } from "../transactionGroup";
import { spFee } from "../utils";
import {
  PoolBuildParams,
  PoolFactory,
  PoolParams,
  PoolParamsWrapper,
  getContractDeployCost,
} from "./baseFactory";

export type Signer = (group: TransactionGroup) => Promise<Uint8Array[]>;

// build(asset,asset,uint64)uint64
const BUILD_SIG = new Uint8Array([238, 90, 13, 21]);

export function buildContantProductTxGroup(
  factoryId: number,
  sender: string,
  poolParams: PoolParams,
  suggestedParams: algosdk.SuggestedParams,
): TransactionGroup {
  const paramsWrapper = new PoolParamsWrapper(poolParams);

  const deploymentCost = getContractDeployCost(
    1,
    2,
    0,
    poolParams.primaryAssetId === 0,
  );

  const fundTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender,
    to: algosdk.getApplicationAddress(factoryId),
    amount: deploymentCost,
    suggestedParams,
  });

  const appArgs = [
    BUILD_SIG,
    new algosdk.ABIUintType(8).encode(0),
    new algosdk.ABIUintType(8).encode(1),
    new algosdk.ABIUintType(64).encode(poolParams.feeBps),
  ];

  const boxName = paramsWrapper.toBoxName();

  const buildTx = algosdk.makeApplicationNoOpTxnFromObject({
    from: sender,
    appIndex: factoryId,
    appArgs,
    suggestedParams: spFee(suggestedParams, 10000),
    boxes: [{ appIndex: 0, name: boxName }],
    foreignAssets: [poolParams.primaryAssetId, poolParams.secondaryAssetId],
  });

  return new TransactionGroup([fundTx, buildTx]);
}

export class ConstantProductFactory extends PoolFactory {
  buildTxGroup(
    sender: string,
    poolParams: PoolBuildParams,
    sp: algosdk.SuggestedParams,
  ): TransactionGroup {
    const params = { ...poolParams, version: this.state.poolVersion };
    return buildContantProductTxGroup(this.appId, sender, params, sp);
  }
}
