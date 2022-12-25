/**
This module contains utilities for interacting with the escrow contract.
Each user deploys his own application which holds staked assets for only this user and for only one farm.
The contract is very minimal and has strong guarantees for user funds safety.
 */

import { Buffer } from "buffer";

import algosdk from "algosdk";

import { encodeArray } from "../encoding";
import { PactSdkError } from "../exceptions";
import { getGasStation } from "../gasStation";
import { parseState, spFee } from "../utils";
import { Farm, fetchFarmById } from "./farm";

const COMPILED_APPROVAL_PROGRAM_B64 =
  "CCADAAEGJgMLTWFzdGVyQXBwSUQBAQEAMgkxABJEMRlAANExGEAAOjYaAIAEOIgacRJEKDYaARfAMmexJLIQNhoCF8AyshiABLc1X9GyGiKyAbMyCjYaAxfAMCKIALNCAK42GgCABHiCLPASQABDNhoAgAQh8d3/EkAAKTYaAIAEm+QoGxJAAAEAsSOyEDYaARfAHLIHIrIBNhoCVwIAsgWzQgBrMgkiNhoBF4gAY0IAXjIJNhoBF8AwNhoCF4gAUbEkshAoZLIYgATDFArnshopshoqshopshoqshoyCbIcMgiyMjYaARfAMLIwIrIBs0IAHDEZgQUSQAABADIJKGRhFESxI7IQIrIBMgmyILMjQzUCNQE1ADQBQAATsSOyEDQAsgc0ArIIIrIBs0IAFbGBBLIQNACyFDQCshI0AbIRIrIBs4k=";
const COMPILED_CLEAR_PROGRAM_B64 = "CIEBQw==";

// create(application,application,asset)void
const CREATE_SIG = new Uint8Array([56, 136, 26, 113]);

// unstake(asset,uint64,application)void
const UNSTAKE_SIG = new Uint8Array([120, 130, 44, 240]);

// withdraw(uint64)void
// const WITHDRAW_ALGOS_SIG = new Uint8Array([33, 241, 221, 255]);

// send_message(account,string)void
// const SEND_MESSAGE_SIG = new Uint8Array([155, 228, 40, 27]);

export type EscrowInternalState = {
  masterApp: number;
};

export function buildDeployEscrowTxs(
  sender: string,
  farmAppId: number,
  stakedAssetId: number,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction[] {
  const approvalProgram = new Uint8Array(
    Buffer.from(COMPILED_APPROVAL_PROGRAM_B64, "base64"),
  );
  const clearProgram = new Uint8Array(
    Buffer.from(COMPILED_CLEAR_PROGRAM_B64, "base64"),
  );

  const gasStation = getGasStation();

  const fundTx = gasStation.buildFundTx(sender, 200_000, suggestedParams);

  const createAppTx = algosdk.makeApplicationCreateTxnFromObject({
    from: sender,
    approvalProgram,
    clearProgram,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    numGlobalInts: 1,
    numGlobalByteSlices: 0,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    suggestedParams: spFee(suggestedParams, 4000),
    foreignApps: [farmAppId, gasStation.appId],
    foreignAssets: [stakedAssetId],
    appArgs: [CREATE_SIG, ...encodeArray([1, 2, 0])],
  });

  const appOptInTx = algosdk.makeApplicationOptInTxnFromObject({
    from: sender,
    suggestedParams,
    appIndex: farmAppId,
  });

  return [fundTx, createAppTx, appOptInTx];
}

export async function fetchEscrowById(
  algod: algosdk.Algodv2,
  appId: number,
  options: { farm?: Farm } = {},
): Promise<Escrow> {
  const [state, creator] = await fetchEscrowGlobalState(algod, appId);
  let farm = options.farm;
  if (!farm) {
    farm = await fetchFarmById(algod, state.masterApp);
  }

  if (farm.appId !== state.masterApp) {
    throw new PactSdkError(
      `Escrow "${appId}" doesn\'t match farm "${farm.appId}".`,
    );
  }

  return new Escrow(algod, appId, farm, creator, state);
}

export async function listEscrowsFromAccountInfo(
  algod: algosdk.Algodv2,
  accountInfo: any,
  options: { farms?: Farm[] } = {},
): Promise<Escrow[]> {
  const farmsById: Record<number, Farm> = {};

  for (const farm of options.farms ?? []) {
    farmsById[farm.appId] = farm;
  }
  const escrows: Escrow[] = [];

  for (const appInfo of accountInfo["created-apps"]) {
    if (
      appInfo["params"]["approval-program"] !== COMPILED_APPROVAL_PROGRAM_B64
    ) {
      continue;
    }
    const state = parseGlobalEscrowState(appInfo["params"]["global-state"]);
    const creator = appInfo["params"]["creator"];

    let farm: Farm;
    if (!options.farms) {
      farm = await fetchFarmById(algod, state.masterApp);
    } else {
      farm = farmsById[state.masterApp];
    }

    if (!farm) {
      continue;
    }

    escrows.push(new Escrow(algod, appInfo["id"], farm, creator, state));
  }

  return escrows;
}

export async function fetchEscrowGlobalState(
  algod: algosdk.Algodv2,
  appId: number,
): Promise<[EscrowInternalState, string]> {
  const appInfo = await algod.getApplicationByID(appId).do();
  const internalState = parseGlobalEscrowState(
    appInfo["params"]["global-state"],
  );
  const creator = appInfo["params"]["creator"];
  return [internalState, creator];
}

export function parseGlobalEscrowState(rawState: any): EscrowInternalState {
  const state = parseState(rawState);
  return { masterApp: state["MasterAppID"] };
}

export class Escrow {
  private _suggestedParams: algosdk.SuggestedParams | null = null;
  address: string;

  constructor(
    public algod: algosdk.Algodv2,
    public appId: number,
    public farm: Farm,
    public userAddress: string,
    public state: EscrowInternalState,
  ) {
    this.address = algosdk.getApplicationAddress(this.appId);
  }

  setSuggestedParams(suggestedParams: algosdk.SuggestedParams) {
    this._suggestedParams = suggestedParams;
  }

  get suggestedParams(): algosdk.SuggestedParams {
    if (!this._suggestedParams) {
      throw new PactSdkError(
        "SuggestedParams not set. Use Escrow.setSuggestedParams().",
      );
    }
    return this._suggestedParams;
  }

  async refreshSuggestedParams() {
    this.setSuggestedParams(await this.algod.getTransactionParams().do());
  }

  fetchUserState() {
    return this.farm.fetchUserState(this.userAddress);
  }

  getUserStateFromAccountInfo(accountInfo: any) {
    return this.farm.getUserStateFromAccountInfo(accountInfo);
  }

  buildStakeTxs(amount: number): algosdk.Transaction[] {
    const transferTx = this.farm.stakedAsset.buildTransferTx(
      this.userAddress,
      this.address,
      amount,
      this.suggestedParams,
    );
    const updateTxs = this.farm.buildUpdateWithOpcodeIncreaseTxs(this);

    return [transferTx, ...updateTxs];
  }

  buildUnstakeTxs(amount: number): algosdk.Transaction[] {
    const increaseOpcodeQuotaTx = this.farm.buildUpdateIncreaseOpcodeQuotaTx(
      this.userAddress,
    );
    const unstakeTx = algosdk.makeApplicationNoOpTxnFromObject({
      from: this.userAddress,
      appIndex: this.appId,
      foreignApps: [this.farm.appId],
      foreignAssets: [this.farm.stakedAsset.index],
      appArgs: [
        UNSTAKE_SIG,
        new algosdk.ABIUintType(8).encode(0),
        new algosdk.ABIUintType(64).encode(amount),
        new algosdk.ABIUintType(8).encode(1),
      ],
      suggestedParams: spFee(this.suggestedParams, 3000),
    });

    return [increaseOpcodeQuotaTx, unstakeTx];
  }

  buildClaimRewardsTx(): algosdk.Transaction {
    return this.farm.buildClaimRewardsTx(this);
  }

  buildDeleteTx(): algosdk.Transaction {
    return algosdk.makeApplicationDeleteTxnFromObject({
      from: this.userAddress,
      appIndex: this.appId,
      foreignApps: [this.farm.appId],
      suggestedParams: spFee(this.suggestedParams, 2000),
    });
  }

  async buildClearTxs(): Promise<algosdk.Transaction[]> {
    const isOptedIn = await this.farm.stakedAsset.isOptedIn(this.address);

    const txs: algosdk.Transaction[] = [];

    // Claim staked tokens if needed.
    if (isOptedIn) {
      txs.push(
        this.farm.stakedAsset.buildOptOutTx(
          this.address,
          this.userAddress,
          this.suggestedParams,
        ),
      );
    }
    txs.push(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: this.address,
        to: this.userAddress,
        amount: 0,
        suggestedParams: this.suggestedParams,
        closeRemainderTo: this.userAddress,
      }),
    );

    return txs;
  }

  async buildDeleteAndClearTxs(): Promise<algosdk.Transaction[]> {
    const farmOptOut = algosdk.makeApplicationCloseOutTxnFromObject({
      from: this.userAddress,
      suggestedParams: this.suggestedParams,
      appIndex: this.farm.appId,
    });
    const deleteTx = this.buildDeleteTx();
    const clearTxs = await this.buildClearTxs();

    return [farmOptOut, deleteTx, ...clearTxs];
  }
}
