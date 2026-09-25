# Markeete Risk Disclosure

Last updated: 25 September 2026

## Short version

Markeete is experimental software with no independent professional audit. An [AI-generated ABI and bytecode review](./audits/DeliveryEscrow_Security_Audit_0x642da385.pdf) is published with separate [scope notes and known corrections](./audit-notes.md); it is not a security certification. Markeete is a user interface for an immutable smart contract on Base. It is not a bank, custodian, insurer, carrier, inspection service, identity provider, marketplace arbiter or dispute-resolution service. Use only funds you can afford to lose.

## No custody and no recovery

The interface does not hold private keys and cannot sign for a user. The escrow contract holds native USDC under fixed rules. No operator can reverse a valid blockchain transaction, recover a seed phrase, restore access to a lost wallet or override the contract because a user made a mistake.

## Physical-world facts are not observable on-chain

The blockchain cannot independently know whether a package exists, whether an item matches its description, whether a courier collected it, whether a recipient was present, or whether a signature was honest. The contract acts only on transactions from the wallet addresses assigned to the buyer, seller and courier roles, plus deterministic timeouts.

Participant confirmations are claims made by wallets, not independent proof. A compromised wallet produces transactions that look valid to the contract.

## Counterparty and product risk

Markeete does not perform identity checks, background checks, sanctions screening, product authentication, quality inspection or courier licensing. Ratings, transaction history, bonds and deposits can reduce some incentives but cannot guarantee honest behavior. Multiple wallets may be controlled by one person.

Do not transact in illegal, stolen, counterfeit, dangerous, restricted or sanctioned goods. Each user is responsible for local laws, age requirements, taxes, customs, export controls, import controls, permits and shipping rules.

## Smart-contract risk

The deployed contract is immutable and has not received an independent professional audit. Testing cannot prove the absence of defects. Solidity, compiler, Base, RPC, wallet, browser, dependency or integration failures may cause loss, delay or inability to transact.

The contract has no configured product-price or aggregate-liability cap. The guardian can pause new listings, purchases and reactivations. The guardian cannot rewrite existing deals or withdraw participant principal. The treasury can withdraw only accrued protocol fees according to contract accounting.

## USDC risk

Only native USDC on Base at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` is supported. USDC is issued by a third party. The issuer or relevant infrastructure may freeze addresses, pause transfers, blacklist funds or otherwise make tokens unusable. Markeete cannot prevent or reverse those actions.

Tokens with the same name or symbol at another address are not accepted by the published contract. Users must verify the chain and token address in their wallet.

## Wallet, interface and phishing risk

An attacker may publish a copy of the interface with another contract or token address. Verify Base Mainnet, chain ID `8453`, and escrow `0x642da3859deD225Cf42efd21346e317e8e26F58e` before signing.

Wallet prompts are authoritative. Never share a seed phrase or private key. Exact USDC approvals are safer than unlimited approvals. Browser extensions, injected providers, clipboard malware and compromised devices can change transaction intent.

## Delivery and timeout risk

Every role must understand the current order state and deadline. Failure to act before a deadline may cancel an order, release funds, start a return, or treat a courier as defaulted. Network congestion, RPC outages, travel, illness and lost device access do not stop contract time.

Safe drop is available only when the buyer selected it at purchase. It relies on the courier's on-chain report and does not prove the condition or exact location of the item.

## Fees and gas

Protocol fees are denominated in USDC. Base network gas is paid separately in ETH. Submitted protocol fees and blockchain gas are generally non-refundable, including when a later deal stage fails. Claims deduct the fixed action fee from the credited amount, up to the available balance.

## Privacy and permanence

Wallet addresses, transaction amounts, timestamps, role assignments, confirmations and ratings written on-chain are public and may remain available permanently. Do not put names, addresses, phone numbers, tracking numbers or other personal information into on-chain metadata.

## No advice or guarantee

Nothing in the interface or documentation is legal, tax, financial, investment, sanctions, customs or export advice. No statement guarantees availability, security, delivery, profit, recovery, counterparty behavior or a particular legal result.

By signing a transaction, the signer accepts the published contract code and current on-chain state, not a promise made by the website.
