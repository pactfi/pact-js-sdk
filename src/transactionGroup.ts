import algosdk, { Transaction } from "algosdk";

/**
 * Class to help manage a set of transactions as a transaction group.
 *
 * The class assigns the group id on construction and has convenience function to access the group id and sign the transactions.
 * It is used internally to make managing the transaction group easier.
 */
export class TransactionGroup {
  transactions: algosdk.Transaction[];
  groupIdBuffer: Buffer;

  /**
   * Creates the TransactionGroup from an array of transactions by assigning a group id to each transaction.
   *
   * @param transactions An array of transactions to create and manage as a group.
   *
   * @throws if the list is empty (length 0) then throws a general Error.
   * @throws if the group id was not assigned to the transactions in the group.
   *          This would only be due to a failure in the algorand sdk client.
   */
  constructor(transactions: Transaction[]) {
    if (transactions.length === 0) {
      throw Error("Cannot create TransactionGroup: empty transactions list.");
    }
    this.transactions = algosdk.assignGroupID(transactions);

    const firstTx = this.transactions[0];
    if (!firstTx.group) {
      throw Error("Cannot retrieve group id from transaction.");
    }
    this.groupIdBuffer = firstTx.group;
  }

  /**
   * Signs all the transactions in the group with the secrete key so they can be committed.
   *
   * @param secretKey Sign all of the transactions in the group with the given secret key.
   *
   * @returns an array of encoded signed transactions as per the Transaction.signTxn from the Algorand sdk.
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
