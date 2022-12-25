import algosdk from "algosdk";

import { encodeArray } from "./encoding";
import { PactSdkError } from "./exceptions";
import { spFee } from "./utils";

// increase_opcode_quota(uint64,uint64)void
const INCREASE_OPCODE_QUOTA_SIG = new Uint8Array([255, 222, 99, 120]);

export class GasStation {
  appAddress: string;

  constructor(public appId: number) {
    this.appAddress = algosdk.getApplicationAddress(appId);
  }

  buildFundTx(
    sender: string,
    amount: number,
    suggestedParams: algosdk.SuggestedParams,
  ): algosdk.Transaction {
    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: sender,
      to: this.appAddress,
      amount,
      suggestedParams,
    });
  }

  buildIncreaseOpcodeQuotaTx(
    sender: string,
    count: number,
    suggestedParams: algosdk.SuggestedParams,
    extra_fee = 0,
  ): algosdk.Transaction {
    return algosdk.makeApplicationNoOpTxnFromObject({
      from: sender,
      appIndex: this.appId,
      appArgs: [INCREASE_OPCODE_QUOTA_SIG, ...encodeArray([count, 0])],
      suggestedParams: spFee(suggestedParams, (count + 1) * 1000 + extra_fee),
    });
  }
}

let _gas_station: GasStation | null = null;

export function setGasStation(appId: number) {
  _gas_station = new GasStation(appId);
}

export function getGasStation(): GasStation {
  if (!_gas_station) {
    throw new PactSdkError("Gas station not set. Use set_gas_station.");
  }
  return _gas_station;
}
