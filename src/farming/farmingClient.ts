import algosdk from "algosdk";

import { Escrow, fetchEscrowById, listEscrowsFromAccountInfo } from "./escrow";
import { Farm, fetchFarmById } from "./farm";

export class PactFarmingClient {
  /**An entry point for interacting with the farming SDK. */

  constructor(public algod: algosdk.Algodv2) {}

  fetchFarmById(appId: number): Promise<Farm> {
    return fetchFarmById(this.algod, appId);
  }

  fetchEscrowById(appId: number): Promise<Escrow> {
    return fetchEscrowById(this.algod, appId);
  }

  async listEscrows(
    userAddress: string,
    options: { farms?: Farm[] } = {},
  ): Promise<Escrow[]> {
    const accountInfo = await this.algod.accountInformation(userAddress).do();
    return this.listEscrowsFromAccountInfo(accountInfo, options);
  }

  listEscrowsFromAccountInfo(
    accountInfo: any,
    options: { farms?: Farm[] } = {},
  ): Promise<Escrow[]> {
    return listEscrowsFromAccountInfo(this.algod, accountInfo, options);
  }
}
