# Sealed Precision Oracle (Track 1: Agentic Infrastructure)

[![ClawHub](https://img.shields.io/badge/ClawHub-Published-blue)](https://clawhub.ai)
[![0G Mainnet](https://img.shields.io/badge/Network-0G_Mainnet-green)](https://chainscan.0g.ai)

The **Sealed Precision Oracle** is a cognitive backbone for autonomous intelligence. It resolves complex, data-dependent questions using a verifiable pipeline of **TEE-attested AI**, **0G Storage memory**, and **ERC-7857 agent identity**.

## 🚀 Quick Install

Boost your agent's reasoning with a single command:

```bash
clawhub install sealed-precision-oracle
```

## 🏗️ Architecture: The Cognitive Backbone

This project implements a complete cognitive layer for agents, ensuring every decision is logically sound and cryptographically verified.

```
┌──────────────────────────────────────────────────────────────┐
│                 Atomic Oracle Pipeline                        │
│                                                              │
│  1. Autonomous Data Fetching (Ground Truth)                  │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐    Real-time     ┌──────────────────────┐ │
│  │ Public RPCs  │ ──────────────▶  │ Gas, Prices, Block#  │ │
│  └──────────────┘                  └──────────┬───────────┘ │
│                                               │              │
│  2. Hardware-Secured Reasoning (TEE Compute)  │              │
│  ┌──────────────┐    ECDSA Sig     ┌──────────▼───────────┐ │
│  │ 0G Compute   │ ──────────────▶  │ AI Reasoning (Qwen)  │ │
│  │ (Direct TEE) │  (Per-Inference) │ Inside Secure Enclave│ │
│  └──────────────┘                  └──────────┬───────────┘ │
│                                               │              │
│  3. Long-Context State Memory (0G Storage)    │              │
│  ┌──────────────┐               ┌─────────────▼──────────┐  │
│  │ 0G Storage   │ ◀──────────── │ Immutable Receipt JSON │  │
│  │ (Audit Log)  │    Upload     │ (Merkle Root Hash)     │  │
│  └──────┬───────┘               └────────────────────────┘  │
│         │ rootHash                                           │
│         ▼                                                    │
│  4. On-Chain Settlement (0G Chain)                           │
│  ┌──────────────┐  recordResolution()                       │
│  │  0G Mainnet  │  ERC-7857 PrecisionOracleID               │
│  │  (Anchor)    │  tokenId → storageRoot                    │
│  └──────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

## 0G Stack Integrations (Track 1 Focus)

| Component | Integration | Purpose |
|-----------|-------------|---------|
| **0G Compute** | Direct TEE Attestation | **Cognitive Layer**: Hardware-verified AI reasoning with per-inference signatures. |
| **0G Storage** | Turbo Indexer | **Long-Context Memory**: Permanent archival of data snapshots and reasoning logic. |
| **0G Chain** | ERC-7857 Smart Contracts | **Agent Identity**: On-chain ownership and verifiable anchoring of AI resolutions. |
| **OpenClaw** | Specialized Skill | **Orchestration**: Seamless integration into autonomous agent frameworks. |

## Feature Status

| Feature | Status | Details |
|---------|--------|---------|
| Real-time Data | **REAL** | Live fetch from Ethereum RPCs and CoinGecko. |
| TEE Attestation | **REAL** | **Per-inference ECDSA signatures** verified against on-chain TEE signers. |
| 0G Storage | **REAL** | Receipts archived on Mainnet Turbo Indexer. |
| On-chain Settlement| **REAL** | Resolutions recorded on 0G Mainnet via ERC-7857 contracts. |

## 🛠️ Usage

### 1. Zero-Config Demo (Recommended for Judges)
Experience the full verifiable flow instantly without any setup. Our hosted API bridge handles the 0G gas and storage fees for you.
```bash
# Install globally
npm install -g sealed-precision-oracle

# Run instantly (Managed Mode)
sealed-precision-oracle "Is the price of Solana above $200?"
```

### 2. Autonomous Mode (For Advanced Agents)
Run the entire pipeline on your own hardware using your own 0G funds.
```bash
# Set your PRIVATE_KEY in your environment
export PRIVATE_KEY="0x..."

# Run locally (Autonomous Mode)
sealed-precision-oracle "Is the price of Solana above $200?"
```

### 3. Smart Contract Integration
The oracle records proofs to:
- **Mainnet Address**: `0xf25E765eF573c26d6314Fd83822564E7AF11C9Ac`
- **Network**: 0G Mainnet (Chain ID: 16661)

## 📂 Project Structure

- `contracts/`: ERC-7857 compliant smart contracts for AI agent identity.
- `src/`: Core logic for data fetching, TEE inference, and storage.
- `api/`: Backend bridge for secure TEE execution (Managed Mode).
- `skills/`: OpenClaw skill manifest for ClawHub publication.
- `bin/`: CLI entry point for global installation.

## 🏁 Track 1 Alignment
This project serves as a foundational **Cognitive Backbone** for agentic infrastructure. By combining real-time data ingestion with TEE-secured reasoning and 0G Storage state persistence, it creates an autonomous intelligence layer that is inherently trustworthy and fully auditable on-chain.

## License
MIT
