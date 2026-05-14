// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./IERC7857.sol";

/// @title OracleDataVerifier
/// @notice ERC-7857 DataVerifier that validates transfer proofs using ECDSA signatures.
///         The `proof` bytes in each AccessProof/OwnershipProof MUST be a 65-byte ECDSA
///         signature over keccak256(abi.encodePacked(oldDataHash, newDataHash, nonce)).
///         The recovered signer is returned in the output for the main contract to check
///         against the token owner.
contract OracleDataVerifier is IERC7857DataVerifier {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    function verifyTransferValidity(
        TransferValidityProof[] calldata _proofs
    ) external pure override returns (TransferValidityProofOutput[] memory outputs) {
        outputs = new TransferValidityProofOutput[](_proofs.length);

        for (uint256 i = 0; i < _proofs.length; i++) {
            AccessProof calldata ap = _proofs[i].accessProof;
            OwnershipProof calldata op = _proofs[i].ownershipProof;

            // Validate non-zero target data hashes
            require(ap.newDataHash != bytes32(0), "Access: empty new hash");
            require(op.newDataHash != bytes32(0), "Ownership: empty new hash");

            // Access and ownership proofs must agree on the data
            require(ap.newDataHash == op.newDataHash, "Hash mismatch: access vs ownership");
            require(ap.oldDataHash == op.oldDataHash, "Old hash mismatch");

            // Non-empty nonces (replay protection)
            require(ap.nonce.length > 0, "Access: empty nonce");
            require(op.nonce.length > 0, "Ownership: empty nonce");

            // Validate ECDSA signature in accessProof.proof
            // The signer must have signed keccak256(oldDataHash, newDataHash, nonce)
            require(ap.proof.length == 65, "Access: proof must be 65-byte ECDSA signature");
            bytes32 accessDigest = keccak256(
                abi.encodePacked(ap.oldDataHash, ap.newDataHash, ap.nonce)
            ).toEthSignedMessageHash();
            address accessSigner = accessDigest.recover(ap.proof);
            require(accessSigner != address(0), "Access: invalid signature");

            // Validate ECDSA signature in ownershipProof.proof
            require(op.proof.length == 65, "Ownership: proof must be 65-byte ECDSA signature");
            bytes32 ownerDigest = keccak256(
                abi.encodePacked(op.oldDataHash, op.newDataHash, op.nonce)
            ).toEthSignedMessageHash();
            address ownerSigner = ownerDigest.recover(op.proof);
            require(ownerSigner != address(0), "Ownership: invalid signature");

            // Both proofs must be signed by the same entity (the current owner)
            require(accessSigner == ownerSigner, "Signer mismatch: access vs ownership");

            outputs[i] = TransferValidityProofOutput({
                oldDataHash: ap.oldDataHash,
                newDataHash: ap.newDataHash,
                sealedKey: op.sealedKey,
                encryptedPubKey: op.encryptedPubKey,
                wantedKey: ap.encryptedPubKey,
                // Return the recovered signer so PrecisionOracleID can verify it's the token owner
                accessAssistant: accessSigner,
                accessProofNonce: ap.nonce,
                ownershipProofNonce: op.nonce
            });
        }
    }
}
