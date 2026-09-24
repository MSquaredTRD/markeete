# Markeete On-Chain Reputation: Design Proposal

Status: design only; not deployed and not used by the current escrow.

## The proposed ERC-20 rating token is not suitable

If a reviewer sends 1–10 non-transferable tokens to a participant, the balance is the sum of all scores, not a rating. A wallet with one score of 10 has balance 10. A wallet with one hundred scores of 1 has balance 100 and would appear ten times better even though its average is much worse.

An ERC-20 balance also loses the order ID, reviewer, role, number of reviews and score distribution. Making the token transferable only by the deployer adds centralized power to rewrite reputation and does not solve the mathematics.

## Recommended architecture

Deploy a separate immutable `MarkeeteReputation` registry. Its constructor permanently stores the official escrow address. It has no owner, no administrator who can edit scores, no transferable token and no upgrade key.

The registry reads `getOrder(orderId)` from the escrow each time a rating is submitted. A review is accepted only when:

1. the order is terminal: `Completed`, `Cancelled`, `Refunded` or `CourierDefaulted`;
2. `msg.sender` is a non-zero buyer, seller, selected courier or selected return courier in that order;
3. the subject is another non-zero participant in the same order;
4. reviewer and subject are different addresses;
5. the score is an integer from 1 through 10;
6. that reviewer has not already rated that subject for that order.

Courier applicants who merely submitted an offer are not eligible. Only the courier address actually stored in the order is eligible. Smart-contract wallets remain supported; the registry must not use `tx.origin`.

## One immutable review per relationship per order

The review key is:

```solidity
bytes32 key = keccak256(
    abi.encode(ESCROW, orderId, msg.sender, subject)
);
```

Once written, that key cannot be changed or deleted. If the same people complete another order, they can review each other again using the new order ID. Later good performance improves the average naturally without rewriting history.

Example:

- Order 10: Alice rates Bob `3`.
- Order 18: Carol rates Bob `9`.
- Bob has `sum = 12`, `count = 2`, raw average `6.00`.
- A third rating of `10` changes the average to `7.33`.

This is the answer to “how can a user improve?”: complete more real deals and receive better ratings. Old ratings remain part of history.

## Data to store

```solidity
enum Role { None, Buyer, Seller, Courier }

struct Aggregate {
    uint64 count;
    uint64 sum;
}

mapping(address user => mapping(Role role => Aggregate)) public aggregate;
mapping(bytes32 reviewKey => uint8 score) public scoreByReview;
mapping(address subject => mapping(address reviewer => bool)) public knownCounterparty;
mapping(address user => mapping(Role role => uint64)) public uniqueCounterparties;
```

Each accepted review emits the full indexable record:

```solidity
event RatingSubmitted(
    uint256 indexed orderId,
    address indexed reviewer,
    address indexed subject,
    uint8 subjectRole,
    uint8 score
);
```

Do not store free-form comments on-chain. Comments create privacy, moderation, illegal-content and permanent-storage problems. An optional `bytes32 evidenceHash` may commit to off-chain evidence without publishing it.

## Separate scores by role

A wallet may be an excellent buyer and a poor courier. Maintain separate buyer, seller and courier aggregates. A return courier contributes to the courier aggregate.

Role assignment is determined by the subject's address in the referenced order. The frontend should show:

- raw average, for example `8.4 / 10`;
- review count, for example `17 reviews`;
- unique counterparties;
- completed/refunded/defaulted order counts read from indexed events;
- role being evaluated.

Never show only one unexplained number.

## Conservative score for low sample sizes

A new wallet with one rating of 10 should not appear more trustworthy than a wallet with hundreds of ratings averaging 9.2. The interface may display a Bayesian score with a neutral prior of 5.5 over ten virtual reviews:

```text
weightedScoreX100 = (sum * 100 + 5,500) / (count + 10)
```

For one rating of 10, the raw score is 10.00 but the conservative score is 5.90. For 100 ratings averaging 9.0, the conservative score is approximately 8.68. Both raw and conservative values should be labeled.

This display calculation can be done in the frontend. The immutable registry stores only facts: sum, count and individual review keys.

## Sybil and wash-trading limits

On-chain eligibility proves that wallets shared an escrow order; it does not prove that different humans controlled them. A person can create several wallets and trade with themselves. Protocol fees, gas and locked capital make this costly but not impossible.

Mitigations:

- show unique counterparties and review count;
- show transaction volume separately, not as a multiplier that wealthy wash traders can exploit;
- label new or concentrated reputations;
- detect reciprocal clusters off-chain using public events;
- never let reputation automatically seize funds in the first release;
- if later used for eligibility, use conservative thresholds and allow the escrow to function without the reputation service.

## Why not mint a soulbound token?

A non-transferable ERC-1155 could represent each score bucket, but it adds token semantics and wallet clutter without improving trust. The registry already provides permanent, public, composable records. If visual badges are desired later, they should be derived from the registry, not treated as the source of truth.

## Deployment sequence

1. Implement the registry against a minimal read-only escrow interface.
2. Unit-test every participant pairing, terminal state and duplicate-review path.
3. Add fuzz and invariant tests for `sum`, `count` and one-review-per-key.
4. Deploy to Base Sepolia.
5. Complete several real test orders and submit all allowed reviews.
6. Publish source and verify bytecode.
7. Add read-only reputation display to the website.
8. Only after observation, consider using reputation for warnings or courier filtering.

Do not deploy an owner-controlled rating token as the production reputation system.
