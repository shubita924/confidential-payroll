# Confidential Payroll

A privacy-preserving payroll smart contract built on **Zama's FHEVM**. An employer
pays salaries on-chain as **encrypted amounts**. Employee balances accumulate and
remain encrypted in contract storage — anyone watching the blockchain can see that a
payment happened, but **not how much**. Only the employee and the employer can
decrypt a given balance.

Built for the Blockchain Technologies final project. The full stack — smart
contract, automated tests, and a browser dApp — runs live on the Sepolia testnet.

**Deployed contract (Sepolia):** `0xB0A0A62B1f7e1950096f7eeCEB3991837c1B94f3`
([view on Etherscan](https://sepolia.etherscan.io/address/0xB0A0A62B1f7e1950096f7eeCEB3991837c1B94f3))

---

## What problem this solves

On a normal public blockchain, every value is visible to everyone. A naive on-chain
payroll would publish every employee's exact salary forever. This project keeps the
*amounts* confidential while still living on a public chain, using Fully Homomorphic
Encryption (FHE): the contract performs arithmetic (adding each new payment to a
running total) directly on ciphertext, without ever decrypting it on-chain.

---

## The privacy property (threat model)

The most important question for any privacy system is precise: *who can see what?*

| Data | Employer | Employee (own balance) | Public / any observer |
| --- | --- | --- | --- |
| Salary **amount** of a payment | ✅ (they set it) | ✅ (their own) | ❌ encrypted |
| Employee's **running balance** | ✅ | ✅ (their own) | ❌ encrypted |
| **That** a payment happened | ✅ | ✅ | ✅ visible |
| **Which addresses** are on payroll | ✅ | — | ✅ visible |

**What is protected:** the salary amounts and the accumulated balances. These exist
on-chain only as encrypted handles (e.g. `0x1d0fadca…a70400`). Reading the chain
reveals nothing about the numbers.

**What is *not* protected (known limitation):** transaction *metadata*. Because each
`paySalary` call is a public transaction between two addresses, an observer can still
see that the employer paid *some* address, when, and how often — just not the amount.
This is the standard confidential-token trade-off. Hiding the relationship graph too
would require additional techniques (e.g. stealth addresses or a pooled/mixer design)
and is out of scope for this MVP.

**Trust assumptions:** confidentiality relies on (1) the security of the FHE scheme,
and (2) Zama's Gateway / threshold-KMS network, which performs decryption only for
addresses the contract has authorized via its Access Control List (ACL). The employer
is trusted to set correct salary values — this project protects *confidentiality*, not
*correctness of the employer's input*.

---

## Why FHE (and not ZK, MPC, or TEE)

The task is to keep a value secret **while doing arithmetic on it on-chain** (adding
each payment to a running balance). That requirement is what selects the primitive:

- **FHE (chosen):** computation runs directly on encrypted data on-chain. No party
  ever needs the plaintext to update the balance. This fits the problem exactly.
- **ZK proofs:** great for *proving* a statement about hidden data, but a prover must
  hold the plaintext to generate the proof — there's no shared encrypted state the
  contract keeps adding to over time. Wrong shape for accumulating balances.
- **MPC:** would require ≥2 non-colluding parties to jointly hold shares of each
  balance — operationally heavy and adds a liveness/collusion assumption.
- **TEE:** moves trust into hardware enclaves; you'd be trusting a chip vendor rather
  than a cryptographic assumption.

FHE keeps it single-party, on-chain, and trust-minimized for this use case.

---

## Architecture

```
  Browser (the user)                 Sepolia testnet            Zama services (free)
  ┌────────────────────┐  encrypted  ┌──────────────────┐  FHE  ┌──────────────────┐
  │ Static dApp page    │── tx ──────▶│ ConfidentialPay- │──────▶│ Coprocessor (FHE │
  │ + relayer-sdk (WASM)│            │ roll contract     │       │ compute) + KMS   │
  │ + MetaMask          │◀─ decrypt ──┴──────────────────┘       │ (threshold       │
  └────────────────────┘   (for authorized user)                │ decryption)      │
                                                                  └──────────────────┘
```

- **Smart contract** (`contracts/ConfidentialPayroll.sol`): stores a
  `mapping(address => euint32)` of encrypted balances; `paySalary` accumulates with
  `FHE.add`; `FHE.allow` grants decryption rights to the employee and employer.
- **Frontend** (`frontend/`): a static HTML/JS page. Encrypts the amount client-side,
  sends the transaction with ethers.js, and performs user-decryption via an EIP-712
  signature. No backend server.
- **Zama Gateway / KMS:** managed, free on testnet — performs the off-chain FHE
  computation and authorized decryptions.

---

## Tech stack

- **Solidity** + **Zama FHEVM** (`@fhevm/solidity`) — encrypted types & operations
- **Hardhat** (FHEVM Hardhat plugin) — compile, test (mock mode), deploy
- **Sepolia** testnet (chainId `11155111`)
- **Frontend:** plain HTML/JS, **ethers v6**, **`@zama-fhe/relayer-sdk` v0.4.x** (UMD
  bundle + WASM, loaded locally)
- **MetaMask** for signing

---

## Project structure

```
confidential-payroll/
├── contracts/
│   ├── ConfidentialPayroll.sol   # the payroll contract
│   └── FHECounter.sol            # template example (reference)
├── deploy/deploy.ts              # deploys ConfidentialPayroll
├── tasks/payroll.ts              # CLI task: pay a salary + decrypt
├── test/ConfidentialPayroll.ts   # automated tests (mock mode)
├── frontend/
│   ├── index.html                # the dApp UI
│   ├── app.js                    # connect, encrypt+pay, decrypt
│   ├── relayer-sdk.js            # Zama SDK browser bundle
│   ├── tfhe_bg.wasm              # FHE WASM (required by the SDK)
│   └── kms_lib_bg.wasm
└── hardhat.config.ts
```

---

## How to run

### Prerequisites
- Node.js 20+
- MetaMask, with the account funded with Sepolia test ETH (from a faucet)
- An Infura (or Alchemy) API key for a Sepolia RPC endpoint

### Contract: install, test, deploy

```bash
cd confidential-payroll
npm install

# Run the automated tests in FHEVM mock mode (no network needed)
npx hardhat test test/ConfidentialPayroll.ts

# Store secrets outside the repo (Hardhat encrypted vars)
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY

# Deploy to Sepolia
npx hardhat deploy --network sepolia
```

### Pay a salary from the command line (optional)

```bash
npx hardhat pay-salary --employee 0xYourEmployeeAddress --amount 3500 --network sepolia
```

This encrypts the amount, calls `paySalary`, then reads the balance back and decrypts
it to verify.

### Frontend

```bash
cd frontend
npm install
# (one-time) copy the SDK bundle + WASM next to the page:
cp node_modules/@zama-fhe/relayer-sdk/bundle/relayer-sdk-js.umd.cjs ./relayer-sdk.js
cp node_modules/@zama-fhe/relayer-sdk/bundle/tfhe_bg.wasm ./tfhe_bg.wasm
cp node_modules/@zama-fhe/relayer-sdk/bundle/kms_lib_bg.wasm ./kms_lib_bg.wasm

npx serve
```

Open the printed `localhost` URL in a browser with MetaMask. Click **Connect wallet**
(approve the Sepolia switch), then pay a salary and decrypt a balance.

---

## Tests

`test/ConfidentialPayroll.ts` runs in FHEVM mock mode and verifies the privacy logic:

1. **Employer is set** — the deployer becomes the employer.
2. **Accumulation + decryption** — paying an employee 3500 then 1500 yields a
   decryptable balance of 5000, proving arithmetic happened on encrypted data and the
   authorized employee can decrypt the result.
3. **Access control** — a non-employer calling `paySalary` reverts.

```bash
npx hardhat test test/ConfidentialPayroll.ts
```

---

## Live demo flow

1. Connect MetaMask on Sepolia.
2. **Employer** enters an employee address + amount → the amount is encrypted in the
   browser → `paySalary` transaction is sent.
3. On Etherscan, the transaction's input is an encrypted blob — the amount is absent.
4. **Employee** clicks *Decrypt my balance* → signs an EIP-712 authorization (no gas) →
   the real total is revealed only to them.

---

## Possible extensions

- Back the balances with a real **confidential ERC-20** (ERC-7984) so amounts represent
  transferable value, not just bookkeeping.
- Add encrypted **withdrawals** and payslip history.
- Reduce metadata leakage (stealth addresses / pooled payments).
- Encrypted **comparisons** (e.g. salary-band checks) using `FHE.select`.

---

## License

MIT
