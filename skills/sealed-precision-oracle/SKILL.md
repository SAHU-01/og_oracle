---
name: sealed-precision-oracle
description: Tamper-proof AI Oracle for precision prediction markets. Resolves market questions using real-time data, 0G Compute (TEE inference), 0G Storage (immutable receipts), and 0G Chain (ERC-7857 agent identity).
metadata: {"openclaw":{"emoji":"🔮","requires":{"bins":["node","npx"],"env":["PRIVATE_KEY","ORACLE_CONTRACT_ADDRESS"],"os":["darwin","linux"]},"primaryEnv":"PRIVATE_KEY"}}
---

# Sealed Precision Oracle

## What it does

Resolves precision prediction market questions (e.g., "Will ETH gas exceed 50 gwei?") using a verifiable, tamper-resistant pipeline:

1. **Fetches real-time data** from public Ethereum RPCs (gas prices, block numbers)
2. **Checks TEE metadata** on the 0G Compute model to verify trusted execution claims
3. **Runs AI inference** via 0G Compute Router with real data injected into the prompt
4. **Uploads an immutable receipt** (AI reasoning + data + TEE metadata) to 0G Storage
5. **Records the resolution on-chain** by calling `recordResolution()` on the PrecisionOracleID contract (ERC-7857)

## When to use

- User asks to resolve a prediction market question
- User asks to check current ETH gas prices and make a prediction
- User wants a verifiable, on-chain record of an AI-generated market resolution

## Workflow

1. Ask the user for the **market question** to resolve (or use their provided question).
2. Run the oracle pipeline:
   ```bash
   npx ts-node src/oracle.ts "<market question>"
   ```
3. The script will:
   - Fetch real ETH gas data from public RPCs
   - Query 0G Compute for the AI resolution
   - Upload the receipt to 0G Storage
   - Record the Merkle root hash on 0G Chain (if ORACLE_CONTRACT_ADDRESS is set)
4. Report the results to the user: resolution, storage root hash, and chain TX hash.

## Prerequisites

Before first use, the user must:
1. Have a funded wallet on 0G Galileo Testnet (faucet: cloud.google.com/application/web3/faucet/0g/galileo)
2. Set `PRIVATE_KEY` in the `.env` file
3. Deploy the contracts: `npm run deploy`
4. Set `ORACLE_CONTRACT_ADDRESS` in `.env` with the deployed address

## Guardrails

- Never fabricate market data. The oracle fetches real gas prices from Ethereum RPCs.
- Always report the TEE attestation status honestly. If TEE metadata check fails, say so.
- Do not modify the receipt content after the AI generates it.
- If the 0G Storage upload or on-chain recording fails, report the exact error.
- Do not claim full TEE attestation verification — the Router API provides metadata, not per-inference proofs.

## Output format

After running, report:
- **Resolution**: YES/NO with confidence percentage
- **Real data used**: Gas price, block number, source
- **TEE status**: Whether the model claims TEE support
- **0G Storage root hash**: The permanent receipt identifier
- **0G Chain TX**: The on-chain recording transaction (if applicable)
