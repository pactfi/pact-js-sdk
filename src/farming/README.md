# Farming

Pact utilizes an innovative architecture for farming called "micro farming". The idea behind it is that the system is split into two contracts:

**Farm** - contract resposible for accruing and sending the rewards to users.

**Escrow** - contract resposible for staking user tokens. Each user deploys his own escrow. It acts as a user's private escrow address.

The main benefit of the micro farming architecture is that the user has very strong guarantees of his funds safety. The escrow contract is very simple and easy to understand/audit. Only the user has access to funds deposited in the escrow and he can withdraw them at any moment.

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

const deployTxs = farm.prepareDeployEscrowTxs(userAddress)
await signSendAndWait(pactsdk.TransactionGroup(deployTxs), userPrivateKey)

const txinfo = await algod.pendingTransactionInformation(deployTxs[1].txID()).do()
const escrowId = txinfo["application-index"]

const escrow = await farm.fetchEscrowById(escrowId)
await escrow.refreshSuggestedParams()
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

The following will send an empty transaction with a note to a given address on behalf of the escrow address. You can use this method for commitment and voting in the governance.

```js
const sendMessageTx = escrow.buildSendMessageTx(
    govAddress, "some message required by the Foundation"
)
await signSendAndWait(sendMessageTx, sender, userPrivateKey)
```

Similarly, you can use the following method to claim the algo rewards from the governance.

```js
const withdrawAlgosTx = escrow.buildWithdrawAlgos()
await signSendAndWait(withdrawAlgosTx, sender, userPrivateKey)
```

## How to destroy the escrow / regain access to staked funds in case of emergency?

The following code will close out the contract, transfer all algos and staked tokens to the user address, and delete the application.

```js
// Exit the farm.
// This will claim all staked tokens and algos locked in the escrow back to the user account and delete the escrow.
// It requires all the rewards to bo claimed, fails otherwise.
const exitTx = escrow.buildExitTx()
const deleteTx = escrow.buildDeleteTx()
const exitAndDeleteGroup = new pactsdk.TransactionGroup([exitTx, deleteTx])
await signSendAndWait(exitAndDeleteGroup, userPrivateKey)

// Force exit the farm.
// Claim all the rewards before exiting from the farm or you will lose your rewards.
// This will claim all staked tokens and algos locked in the escrow back to the user account and delete the escrow.
const exitTx = escrow.buildForceExitTx()
const deleteTx = escrow.buildDeleteTx()
const exitAndDeleteGroup = pactsdk.TransactionGroup([exitTx, deleteTx])
await signSendAndWait(exitAndDeleteGroup, userPrivateKey)
```
