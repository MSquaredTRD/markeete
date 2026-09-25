# Audit by Fable 4.8 — scope and known corrections

Published by Markeete on 25 September 2026

## Document

- Original PDF: [`DeliveryEscrow_Security_Audit_0x642da385.pdf`](./audits/DeliveryEscrow_Security_Audit_0x642da385.pdf)
- Target contract: `0x642da3859deD225Cf42efd21346e317e8e26F58e`
- Network: Base Mainnet, chain ID `8453`
- PDF SHA-256: `8d1605350f1c9f1f561bc5f1cceaf5ba71ca779db9372f10d02dd6c86deccc8e`
- PDF date: 25 September 2026

The PDF is published unchanged. The website title **Audit by Fable 4.8** is the project publisher's attribution. The embedded PDF metadata identifies the author as `Claude`.

## What this report is

This is an AI-generated, best-effort security review of the deployed contract's ABI, constructor arguments, compiler settings and EVM bytecode. The report states that it did not retrieve or review the Solidity source, run dynamic tests, fuzz the contract or use automated static-analysis tooling.

It is useful as an additional review artifact. It is not an independent professional audit, certification, warranty or guarantee that the contract is free from vulnerabilities.

## Known factual corrections

1. **The seller selects the forward courier.** Sections 5 and 8 of the PDF say that the buyer approves the forward courier. In the deployed contract, `approveCourier(orderId, courier)` requires `msg.sender == order.seller`. The buyer selects only a voluntary-return courier through `approveReturnCourier`.
2. **A seller cannot update a product during a live order.** Finding L-03 says that the seller can change the product metadata after an order exists. `createOrder` immediately changes the product from `Active` to `Reserved`, while `updateProduct` requires the product to remain `Active`. The order does not store a metadata-hash copy, but the described live-order mutation path is not available.
3. **Activity figures are only a historical snapshot.** Statements such as “0 transactions”, “0 balance” and the contract age described the report's collection time and are no longer current.
4. **The report did not evaluate the available source-level test suite.** The current project suite passes 68 tests: 5 deployment tests, 62 unit/fuzz tests and 1 invariant suite. The invariant run executes 65,536 calls across 512 runs and checks solvency, liability reconciliation, product/order state consistency and terminal-order principal clearance. These results reduce uncertainty but do not prove the absence of bugs.

## Open findings and project position

### M-01 — purchase terms are not bound in `createOrder`

This is a valid limitation. `createOrder` does not take an expected price, metadata hash or product version. A seller can change an active listing before the buyer's transaction is included. The Markeete interface normally requests an exact USDC allowance for the displayed amount, which can cause a higher-price transaction to revert, but a pre-existing larger allowance weakens that mitigation. The immutable deployed contract cannot add expected-term arguments.

### M-02 — no economic value caps

This is an intentional design decision, not a hidden administrator setting. The contract has no per-order or global value cap. Removing the global cap prevents a funded attacker from filling it and blocking new orders, but it also means the contract itself does not limit aggregate exposure. Users must choose their own transaction sizes.

### M-03 — deadline and liveness dependence

This is an intentional protocol characteristic. The contract cannot observe physical delivery and has no administrator or arbitrator who can rewrite an outcome. Stored role confirmations and deterministic deadlines decide settlement. Deadlines require a user or bot to submit the applicable finalize, expiry or default transaction.

### L-01 — immutable guardian and treasury address

The same immutable address is used for both roles. It can pause new activity and withdraw accrued protocol fees, but it cannot withdraw escrow principal or block settlement and claims for existing orders. Loss or compromise of that wallet can affect availability and fees.

### L-02 — flat claim fee

This is accurate. A claim deducts the smaller of the credited balance and the 0.20 USDC action fee. Credits accumulate, so participants can batch multiple released balances before claiming.

### L-03 — metadata is not copied into the order

The structural observation is accurate, but the live-order mutation scenario in the PDF is not. Product event history and transaction ordering preserve the on-chain metadata history, while the current product is locked in `Reserved` status during an active order.

## Current status

- BaseScan source: verified exact match.
- Contract: immutable and non-upgradeable.
- Critical or High findings in the limited AI review: none reported.
- Independent third-party professional audit: not completed.
- Remaining physical-delivery, counterparty, wallet, USDC and legal risks: unchanged.

Read the [full risk disclosure](./risk-disclosure.md) before using real funds.
