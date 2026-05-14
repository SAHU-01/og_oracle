# Sealed Precision Oracle

A tamper-resistant AI Oracle for precision prediction markets, built on the 0G decentralized stack with real ERC-7857 compliance.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                 Atomic Oracle Pipeline                        │
│                                                              │
│  1. Market Question                                          │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐    Real-time     ┌──────────────────────┐ │
│  │  ETH RPC     │ ──────────────▶  │ Gas price, base fee, │ │
│  │  (llamarpc)  │                  │ block number         │ │
│  └──────────────┘                  └──────────┬───────────┘ │
│                                               │              │
│  ┌──────────────┐    TEE metadata  ┌──────────▼───────────┐ │
│  │  0G Compute  │ ──────────────▶  │ AI Model (Qwen 7B)  │ │
│  │  Router      │  /v1/models      │ + real data in prompt│ │
│  └──────────────┘                  └──────────┬───────────┘ │
│                                               │              │
│         Receipt = AI response + real data     │              │
│         + TEE metadata + attestation note     ▼              │
│  ┌──────────────┐               ┌────────────────────────┐  │
│  │  0G Storage  │ ◀──────────── │ JSON Receipt           │  │
│  │  (Immutable) │    Upload     │ (merkle tree root)     │  │
│  └──────┬───────┘               └────────────────────────┘  │
│         │ rootHash                                           │
│         ▼                                                    │
│  ┌──────────────┐  recordResolution()                       │
│  │  0G Chain    │  ERC-7857 PrecisionOracleID               │
│  │  (automatic) │  tokenId → storageRoot (no manual gap)    │
│  └──────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

## 0G Integrations

| Component | Integration | Purpose |
|-----------|-------------|---------|
| **0G Compute** | Router API + TEE metadata check | AI inference with TEE transparency |
| **0G Storage** | Indexer + Merkle Trees | Immutable resolution receipt storage |
| **0G Chain** | ERC-7857 Smart Contracts | On-chain agent identity + receipt anchoring |
| **OpenClaw** | SKILL.md manifest | Agent orchestration skill |

## What's Real vs. Simulated

| Feature | Status | Details |
|---------|--------|---------|
| Real-time data | **REAL** | Gas prices fetched from Ethereum mainnet RPCs |
| 0G Storage upload | **REAL** | Actual Merkle tree + upload via 0G Indexer |
| On-chain recording | **REAL** | Atomic pipeline calls `recordResolution()` automatically |
| ERC-7857 interface | **REAL** | Matches the actual EIP-7857 standard signatures |
| TEE attestation | **PARTIAL** | Checks model TEE metadata; per-inference proofs require direct provider access (documented honestly in receipt) |
| Authorization system | **REAL** | `authorizeUsage()` gates who can call `recordResolution()` |

## Quick Start

### 1. Install Dependencies

```bash
nvm use  # Node 20.17.0
npm install --legacy-peer-deps
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your private key
```

Get free testnet tokens from the [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/0g/galileo).

### 3. Compile & Deploy

```bash
npm run compile
npm run deploy
# Copy the output ORACLE_CONTRACT_ADDRESS into .env
```

This deploys two contracts:
- `OracleDataVerifier` — ERC-7857 transfer proof verifier
- `PrecisionOracleID` — Main Oracle agent identity (ERC-721 + ERC-7857)

### 4. Run the Oracle

```bash
npm run oracle
# or with a custom question:
npx ts-node src/oracle.ts "Will ETH gas exceed 30 gwei right now?"
```

The pipeline runs atomically:
1. Fetches real gas data from Ethereum RPCs
2. Checks TEE metadata on the 0G Compute model
3. Runs AI inference with real data injected
4. Uploads receipt to 0G Storage
5. Calls `recordResolution()` on-chain (if contract address is set)

## Project Structure

```
oracle/
├── contracts/
│   ├── IERC7857.sol              # Real ERC-7857 types & interfaces
│   ├── OracleDataVerifier.sol    # Transfer proof verifier
│   └── PrecisionOracleID.sol     # ERC-721 + ERC-7857 agent identity
├── scripts/
│   └── deploy.ts                 # Deploys Verifier + Oracle
├── src/
│   ├── oracle.ts                 # Atomic pipeline (Compute→Storage→Chain)
│   ├── fetchMarketData.ts        # Real ETH gas price fetcher
│   ├── teeMetadata.ts            # TEE metadata checker (honest)
│   └── uploadReceipt.ts          # 0G Storage upload module
├── skills/
│   └── sealed-precision-oracle/
│       └── SKILL.md              # OpenClaw skill manifest
├── hardhat.config.ts
├── package.json
└── README.md
```

## Contracts (2 contracts, targeting 0G Galileo Testnet)

### OracleDataVerifier

Implements `IERC7857DataVerifier`. Validates structural consistency of transfer proofs (non-zero hashes, matching data between access/ownership proofs, non-empty nonces). In production, this would perform full TEE attestation or ZKP verification.

### PrecisionOracleID

ERC-721 + ERC-7857 contract. Key functions:

| Function | ERC-7857 | Oracle-Specific | Description |
|----------|----------|-----------------|-------------|
| `mint()` | | X | Create a new Oracle agent identity |
| `recordResolution()` | | X | Link a 0G Storage root to the agent (owner OR authorized users) |
| `iTransfer()` | X | | Transfer with proof verification |
| `iClone()` | X | | Clone agent identity with proofs |
| `authorizeUsage()` | X | | Grant usage rights (gates `recordResolution`) |
| `revokeAuthorization()` | X | | Revoke usage rights |
| `delegateAccess()` | X | | Delegate to an assistant address |
| `authorizedUsersOf()` | X | | List authorized users |
| `intelligentDataOf()` | X | | Returns resolution history as IntelligentData |
| `verifier()` | X | | Returns the DataVerifier contract |

## Network Configuration

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| Galileo Testnet | 16601 | https://evmrpc-testnet.0g.ai | https://chainscan-galileo.0g.ai |
| Aristotle Mainnet | 16661 | https://evmrpc.0g.ai | https://chainscan.0g.ai |

## TEE Transparency

The receipt stored on 0G Storage honestly documents:
- Whether the model **claims** TEE support (from `/v1/models` metadata)
- The TEE type and verifier (e.g., Intel TDX, dstack)
- An explicit note that Router API metadata is **not** a per-inference attestation proof
- Instructions for full verification via `0g-compute-ts-sdk`

## Known Limitations

1. **TEE attestation is metadata-level, not per-inference**: The 0G Router API does not expose per-inference attestation proofs. Full verification requires direct provider access via `0g-compute-ts-sdk`.
2. **DataVerifier is simplified**: Validates structural consistency, not full TEE/ZKP proofs. Production would integrate with 0G's TEE attestation infrastructure.
3. **Contracts not yet deployed**: Run `npm run deploy` with a funded Galileo testnet wallet to deploy. Addresses will be output by the script.

## License

MIT
