import algosdk from "algosdk";

import { PoolType } from "./pool";
import { deployContract } from "./testUtils";

export function deployFactoryContract(
  account: algosdk.Account,
  contractType: PoolType,
  adminAndTreasuryAddress: string,
): Promise<number> {
  const command = [
    "deploy-factory",
    `--contract-type=${contractType.toLowerCase()}`,
    `--admin-and-treasury-address=${adminAndTreasuryAddress}`,
  ];

  return deployContract(account, command);
}
