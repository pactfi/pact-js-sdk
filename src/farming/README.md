# Farming

Pact utilizes an innovative architecture for farming called "micro farming". The idea behind it is that the system is split into two contracts:

**Farm** - contract resposible for accruing and sending the rewards to users.

**Escrow** - contract resposible for staking user tokens. Each user deploys his own escrow. It acts as a user's private escrow address.

The main benefit of the micro farming architecture is that the user has very strong guarantees of his funds safety. The escrow contract is very simple and easy to understand/audit. Only the user has access to funds deposited in the escrow and he can withdraw them at any moment. This is achieved with the Algorand's rekey mechanism.

Any potential bugs or exploits in the farm do not threaten the safety of user funds. In worst case scenario the user can lose the accrued rewards.

# Code examples

## Starting point for all examples

```js
import algosdk from "algosdk";
import pactsdk from "@pactfi/pactsdk";

const algod = new algosdk.Algodv2("<token>", "<url>");
const pact = new pactsdk.PactClient(algod);
```

## How to fetch a farm / escrow?

```js
let farm = await pact.farming.fetchFarmById(farmId)
let escrow = await farm.fetchEscrowById(escrowId)

// If you don't know the escrow id you can...
escrow = await farm.fetchEscrowByAddress(userAddress)

// If you don't know the farm id you can...
escrow = await pact.farming.fetchEscrowById(escrowId)
farm = escrow.farm
```

## How to create a new escrow?

```js
await farm.refreshSuggestedParams()

const deployTxs = farm.buildDeployEscrowTxs(userAddress)
await signSendAndWait(pactsdk.TransactionGroup(deployTxs), userPrivateKey)

const txinfo = await algod.pendingTransactionInformation(deployTxs[1].txID()).do()
const escrowId = txinfo["application-index"]

const escrow = await farm.fetchEscrowById(escrowId)
await escrow.refreshSuggestedParams()
```

## How to find all escrows the user posses?

This fetches the account info and retrieves all apps matching the Escrow's approval program. It also fetches the accompanying farms.

```js
const escrows = await pact.farming.listEscrows(userAddress)
```

If you already have the farms fetched, you can provide them as an argument. This will save you the extra algod requests to fetch the farms.

```js
const escrows = await pact.farming.listEscrows(userAddress, {farms})
```

If you already have the account info and the farms fetched, you can list the escrows like below. This will not perform any algod requests and will return immediately.

```js
const accountInfo = await algod.accountInformation(userAddress).do()
...
const escrows = await pact.farming.listEscrowsFromAccountInfo(userAddress, accountInfo, {farms})
```

## How to check farm's state?

To check check farm's global state.

```js
await farm.updateState()
console.log(farm.state)
```

To check user's state.

```js
const userState = await escrow.fetchUserState()
console.log(userState)
```

## How to stake / unstake?

```js
const stakeTxs = escrow.buildStakeTxs(1_000_000)
await signSendAndWait(new pactsdk.TransactionGroup(stakeTxs), userPrivateKey)
```

```js
const unstakeTxs = escrow.buildUnstakeTxs(1_000_000)
await signSendAndWait(new pactsdk.TransactionGroup(unstakeTxs), userPrivateKey)
```

## How to check how many tokens are staked?

```js
const userState = await escrow.fetchUserState()
const stakedAmount = userState.staked
```

or

```js
const stakedAmount = await escrow.farm.stakedAsset.getHolding(escrow.address)

// or if you want to reuse accountInfo and save some requests to algod.
const accountInfo = algod.accountInformation(escrow.address)
...
const stakedAmount = escrow.farm.stakedAsset.getHoldingFromAccountInfo(accountInfo)
```

## How to claim rewards?

```js
// First update farm's local state.
const updateTxs = farm.buildUpdateWithOpcodeIncreaseTxs(escrow)

// Then claim the rewards.
const claimTx = escrow.buildClaimRewardsTx()

claimTxGroup = new pactsdk.TransactionGroup([...updateTxs, claimTx])
await signSendAndWait(claimTxGroup, userPrivateKey)
```

## How to estimate accrued rewards?

```js
const userState = await escrow.fetchUserState()
const estimatedRewards = farm.estimateAccruedRewards(new Date(), userState)
```

## How to simulate farming?

```js
const atTime = new Date(new Date().getTime() + 100_000) // + miliseconds
const simulatedRewards = farm.simulateNewStaker(atTime, 1_000_000)
```

## How to use staked asset in e.g. Algorand's governance?

The users can you use the rekey mechanism to briefly gain full control over the escrow address.
First, you must rekey the escrow to your account, then perform any transactions you want on the escrow address and then, rekey the escrow back to the contract.
The SDK comes with a handy context manager that builds the transactions in the correct order for you.

```js
function buildGovernanceCommitTx(address, amount) {
  // User custom code.
  ...
}

const txs = escrow.rekey(txs => {
  govTx = buildGovernanceCommitTx(escrow.address, 1000)
  txs.push(govTx)
})

await signSendAndWait(new pactsdk.TransactionGroup(txs), userPrivateKey)
```

## How to destroy the escrow / regain access to staked funds in case of emergency?

The following code will close out the contract, transfer all algos and staked tokens to the user address, and delete the application.

```js
const deleteTxs = escrow.buildDeleteAndClearTxs()
await signSendAndWait(new pactsdk.TransactionGroup(deleteTxs), userPrivateKey)
```
