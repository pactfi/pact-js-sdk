import algosdk, { Transaction } from "algosdk";

import { PactSdkError } from "./exceptions";

/**
 * A convenience class to make managing Algorand transactions groups easier.
 */
export class TransactionGroup {
  /**
   * A list of transactions in a group.
   */
  transactions: algosdk.Transaction[];

  groupIdBuffer: Buffer;

  /**
   * Creates the TransactionGroup from an array of transactions by assigning a group id to each transaction.
   *
   * @param transactions A list of transactions to put in a group.
   *
   * @throws PactSdkError if the list is empty (length 0).
   * @throws PactSdkError if the group id was not assigned to the transactions due to a failure in the Algorand SDK.
   */
  constructor(transactions: Transaction[]) {
    if (transactions.length === 0) {
      throw new PactSdkError(
        "Cannot create TransactionGroup: empty transactions list.",
      );
    }
    this.transactions = algosdk.assignGroupID(transactions);

    const firstTx = this.transactions[0];
    if (!firstTx.group) {
      throw new PactSdkError("Cannot retrieve group id from transaction.");
    }
    this.groupIdBuffer = firstTx.group;
  }

  /**
   * Signs all the transactions in the group with the secret key.
   *
   * @param secretKey Sign the transactions with this secret key.
   *
   * @returns An array of encoded signed transactions as per the Transaction.signTxn from the Algorand sdk.
   */
  signTxn(secretKey: Uint8Array): Uint8Array[] {
    return this.transactions.map((tx) => tx.signTxn(secretKey));
  }

  /**
   * @returns The group id as a base64 encoded string.
   */
  get groupId() {
    return Buffer.from(this.groupIdBuffer).toString("base64");
  }
}
