import algosdk from "algosdk";

import { Escrow, fetchEscrowById } from "./escrow";
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
}
