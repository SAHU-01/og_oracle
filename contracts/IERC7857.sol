// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ERC-7857 Types and Interfaces
/// @notice Faithful implementation of EIP-7857: AI Agents NFT with Private Metadata
/// @dev See https://eips.ethereum.org/EIPS/eip-7857

enum OracleType {
    TEE,
    ZKP
}

struct AccessProof {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes nonce;
    bytes encryptedPubKey;
    bytes proof;
}

struct OwnershipProof {
    OracleType oracleType;
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes sealedKey;
    bytes encryptedPubKey;
    bytes nonce;
    bytes proof;
}

struct TransferValidityProof {
    AccessProof accessProof;
    OwnershipProof ownershipProof;
}

struct TransferValidityProofOutput {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes sealedKey;
    bytes encryptedPubKey;
    bytes wantedKey;
    address accessAssistant;
    bytes accessProofNonce;
    bytes ownershipProofNonce;
}

struct IntelligentData {
    string dataDescription;
    bytes32 dataHash;
}

/// @notice Verifier contract for validating transfer proofs (TEE or ZKP)
interface IERC7857DataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata _proofs
    ) external returns (TransferValidityProofOutput[] memory);
}

/// @notice Metadata extension for ERC-7857
interface IERC7857Metadata {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function intelligentDataOf(uint256 _tokenId) external view returns (IntelligentData[] memory);
}

/// @notice Core ERC-7857 interface — agent-specific functions only.
///         Functions shared with ERC-721 (approve, ownerOf, etc.) are inherited
///         from OZ's ERC721 implementation. This interface declares only the
///         agent-identity additions defined by EIP-7857.
interface IERC7857 {
    event Authorization(address indexed _from, address indexed _to, uint256 indexed _tokenId);
    event AuthorizationRevoked(address indexed _from, address indexed _to, uint256 indexed _tokenId);
    event Transferred(uint256 _tokenId, address indexed _from, address indexed _to);
    event Cloned(uint256 indexed _tokenId, uint256 indexed _newTokenId, address _from, address _to);
    event PublishedSealedKey(address indexed _to, uint256 indexed _tokenId, bytes[] _sealedKeys);
    event DelegateAccess(address indexed _user, address indexed _assistant);

    function verifier() external view returns (IERC7857DataVerifier);
    function iTransfer(address _to, uint256 _tokenId, TransferValidityProof[] calldata _proofs) external;
    function iClone(address _to, uint256 _tokenId, TransferValidityProof[] calldata _proofs) external returns (uint256 _newTokenId);
    function authorizeUsage(uint256 _tokenId, address _user) external;
    function revokeAuthorization(uint256 _tokenId, address _user) external;
    function delegateAccess(address _assistant) external;
    function authorizedUsersOf(uint256 _tokenId) external view returns (address[] memory);
    function getDelegateAccess(address _user) external view returns (address);
}
