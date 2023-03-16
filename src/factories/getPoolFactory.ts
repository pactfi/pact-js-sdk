import algosdk from "algosdk";

import { Config } from "../config";
import { PoolType } from "../pool";
import { parseGlobalFactoryState } from "./baseFactory";
import { ConstantProductFactory } from "./constantProduct";

export async function getPoolFactory(
  algod: algosdk.Algodv2,
  poolType: PoolType,
  config: Config,
) {
  let appId: number;
  let factoryClass: typeof ConstantProductFactory;
  if (poolType === "CONSTANT_PRODUCT") {
    appId = config.factoryConstantProductId;
    factoryClass = ConstantProductFactory;
  } else if (poolType === "NFT_CONSTANT_PRODUCT") {
    appId = config.factoryNftConstantProductId;
    factoryClass = ConstantProductFactory;
  } else {
    throw new Error(`Factory for ${poolType} is not implemented.`);
  }

  if (!appId) {
    throw new Error(`Missing factory id for ${poolType} factory.`);
  }

  const appInfo = await algod.getApplicationByID(appId).do();
  const factoryState = parseGlobalFactoryState(
    appInfo["params"]["global-state"],
  );

  return new factoryClass(algod, appId, factoryState);
}
