// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./IERC7857.sol";

/// @title PrecisionOracleID
/// @notice On-chain identity for the Sealed Precision Oracle.
///         Implements ERC-7857 (AI Agents NFT with Private Metadata) on top of ERC-721.
///         Maps each agent token to its 0G Storage resolution receipts.
contract PrecisionOracleID is ERC721, Ownable, IERC7857, IERC7857Metadata {
    using EnumerableSet for EnumerableSet.AddressSet;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── State ──────────────────────────────────────────────────────────

    uint256 private _nextTokenId;
    IERC7857DataVerifier private _dataVerifier;

    // TEE signer registry — addresses of verified TEE signers
    mapping(address => bool) public registeredTeeSigners;

    // ERC-7857: authorized users per token (enumerable for authorizedUsersOf)
    mapping(uint256 => EnumerableSet.AddressSet) private _authorizedUsers;

    // ERC-7857: delegate access (user => assistant)
    mapping(address => address) private _delegates;

    // ERC-7857: intelligent data per token
    mapping(uint256 => IntelligentData[]) private _intelligentData;

    // Oracle-specific: latest 0G Storage Merkle root per token
    mapping(uint256 => bytes32) public storageRoots;

    // Oracle-specific: full resolution history per token
    mapping(uint256 => bytes32[]) public resolutionHistory;

    // Oracle-specific: nonce per token (anti-replay for resolutions)
    mapping(uint256 => uint256) public resolutionNonces;

    // Oracle-specific: clone lineage
    mapping(uint256 => uint256) public clonedFrom;

    // ─── Events ─────────────────────────────────────────────────────────

    event ResolutionRecorded(
        uint256 indexed tokenId,
        bytes32 indexed storageRoot,
        uint256 nonce,
        address indexed operator,
        address teeSigner,
        uint256 timestamp
    );

    event TeeSignerRegistered(address indexed signer);
    event TeeSignerRemoved(address indexed signer);

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(
        address verifierAddress
    ) ERC721("PrecisionOracleID", "PORID") Ownable(msg.sender) {
        require(verifierAddress != address(0), "Zero verifier address");
        _dataVerifier = IERC7857DataVerifier(verifierAddress);
        _nextTokenId = 1;
    }

    // ─── Minting (owner-only) ───────────────────────────────────────────

    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(to, tokenId);
    }

    // ─── TEE Signer Registry ───────────────────────────────────────────

    /// @notice Register a TEE signer address (from the 0G InferenceServing contract)
    function registerTeeSigner(address signer) external onlyOwner {
        require(signer != address(0), "Zero address");
        registeredTeeSigners[signer] = true;
        emit TeeSignerRegistered(signer);
    }

    /// @notice Remove a TEE signer
    function removeTeeSigner(address signer) external onlyOwner {
        registeredTeeSigners[signer] = false;
        emit TeeSignerRemoved(signer);
    }

    // ─── Oracle Resolution Recording ───────────────────────────────────

    /// @notice Record a resolution receipt with TEE attestation.
    ///         Callable by token owner OR authorized users.
    /// @param tokenId The Oracle agent token
    /// @param storageRoot 0G Storage Merkle root hash of the receipt
    /// @param signedText The raw text that the TEE signed
    /// @param teeSignature The TEE's ECDSA signature over the signedText
    /// @param teeSigner The TEE signer address to verify against (zero = skip verification)
    function recordResolution(
        uint256 tokenId,
        bytes32 storageRoot,
        string calldata signedText,
        bytes calldata teeSignature,
        address teeSigner
    ) external {
        require(_ownerOrAuthorized(tokenId, msg.sender), "Not owner or authorized");
        require(storageRoot != bytes32(0), "Empty storage root");

        // If TEE signature provided, verify it on-chain
        if (teeSignature.length > 0 && teeSigner != address(0)) {
            require(registeredTeeSigners[teeSigner], "TEE signer not registered");

            // Recover signer from the signature over the raw signed text
            bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(bytes(signedText));
            address recovered = ethSignedHash.recover(teeSignature);
            require(recovered == teeSigner, "TEE signature verification failed");
        }

        uint256 nonce = resolutionNonces[tokenId]++;
        storageRoots[tokenId] = storageRoot;
        resolutionHistory[tokenId].push(storageRoot);

        // Add as intelligent data (ERC-7857 metadata)
        _intelligentData[tokenId].push(IntelligentData({
            dataDescription: string.concat("Oracle Resolution #", Strings.toString(nonce)),
            dataHash: storageRoot
        }));

        emit ResolutionRecorded(tokenId, storageRoot, nonce, msg.sender, teeSigner, block.timestamp);
    }

    function resolutionCount(uint256 tokenId) external view returns (uint256) {
        return resolutionHistory[tokenId].length;
    }

    /// @notice Paginated query for intelligent data. Avoids gas bomb on large histories.
    /// @param tokenId The token to query
    /// @param offset Start index
    /// @param limit Max items to return
    function intelligentDataPaginated(
        uint256 tokenId,
        uint256 offset,
        uint256 limit
    ) external view returns (IntelligentData[] memory result, uint256 total) {
        require(limit > 0 && limit <= 1000, "Limit must be 1-1000");
        IntelligentData[] storage data = _intelligentData[tokenId];
        total = data.length;
        if (offset >= total) {
            return (new IntelligentData[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;
        result = new IntelligentData[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = data[offset + i];
        }
    }

    // ─── ERC-7857: Core Functions ──────────────────────────────────────

    /// @inheritdoc IERC7857
    function verifier() external view override returns (IERC7857DataVerifier) {
        return _dataVerifier;
    }

    /// @inheritdoc IERC7857
    function iTransfer(
        address _to,
        uint256 _tokenId,
        TransferValidityProof[] calldata _proofs
    ) external override {
        require(ownerOf(_tokenId) == msg.sender, "Not token owner");
        require(_to != address(0), "Transfer to zero address");
        require(_proofs.length > 0, "No proofs provided");

        // Verify transfer proofs via the data verifier
        TransferValidityProofOutput[] memory outputs = _dataVerifier.verifyTransferValidity(_proofs);

        // Verify that the proof signer is the token owner
        // (accessAssistant field carries the recovered ECDSA signer from the verifier)
        for (uint256 j = 0; j < outputs.length; j++) {
            require(outputs[j].accessAssistant == msg.sender, "Proof signer is not token owner");
        }

        // Execute transfer (ERC-721 internal, no approval check needed)
        address from = msg.sender;
        _transfer(from, _to, _tokenId);

        // Publish sealed keys so new owner can decrypt agent metadata
        bytes[] memory sealedKeys = new bytes[](outputs.length);
        for (uint256 i = 0; i < outputs.length; i++) {
            sealedKeys[i] = outputs[i].sealedKey;
        }
        emit PublishedSealedKey(_to, _tokenId, sealedKeys);
        emit Transferred(_tokenId, from, _to);
    }

    /// @inheritdoc IERC7857
    function iClone(
        address _to,
        uint256 _tokenId,
        TransferValidityProof[] calldata _proofs
    ) external override returns (uint256 _newTokenId) {
        require(ownerOf(_tokenId) == msg.sender, "Not token owner");
        require(_to != address(0), "Clone to zero address");
        require(_proofs.length > 0, "No proofs provided");

        // Verify proofs
        TransferValidityProofOutput[] memory outputs = _dataVerifier.verifyTransferValidity(_proofs);

        // Verify that the proof signer is the token owner
        for (uint256 j = 0; j < outputs.length; j++) {
            require(outputs[j].accessAssistant == msg.sender, "Proof signer is not token owner");
        }

        // Mint clone
        _newTokenId = _nextTokenId++;
        _mint(_to, _newTokenId);
        clonedFrom[_newTokenId] = _tokenId;

        // Inherit intelligent data from parent
        IntelligentData[] storage parentData = _intelligentData[_tokenId];
        for (uint256 i = 0; i < parentData.length; i++) {
            _intelligentData[_newTokenId].push(parentData[i]);
        }

        // Inherit latest storage root
        storageRoots[_newTokenId] = storageRoots[_tokenId];

        // Publish sealed keys
        bytes[] memory sealedKeys = new bytes[](outputs.length);
        for (uint256 i = 0; i < outputs.length; i++) {
            sealedKeys[i] = outputs[i].sealedKey;
        }
        emit PublishedSealedKey(_to, _newTokenId, sealedKeys);
        emit Cloned(_tokenId, _newTokenId, msg.sender, _to);
    }

    /// @inheritdoc IERC7857
    function authorizeUsage(uint256 _tokenId, address _user) external override {
        require(ownerOf(_tokenId) == msg.sender, "Not token owner");
        require(_user != address(0), "Zero address");
        require(_authorizedUsers[_tokenId].add(_user), "Already authorized");

        emit Authorization(msg.sender, _user, _tokenId);
    }

    /// @inheritdoc IERC7857
    function revokeAuthorization(uint256 _tokenId, address _user) external override {
        require(ownerOf(_tokenId) == msg.sender, "Not token owner");
        require(_authorizedUsers[_tokenId].remove(_user), "Not authorized");

        emit AuthorizationRevoked(msg.sender, _user, _tokenId);
    }

    /// @inheritdoc IERC7857
    function authorizedUsersOf(uint256 _tokenId) external view override returns (address[] memory) {
        return _authorizedUsers[_tokenId].values();
    }

    /// @inheritdoc IERC7857
    function delegateAccess(address _assistant) external override {
        _delegates[msg.sender] = _assistant;
        emit DelegateAccess(msg.sender, _assistant);
    }

    /// @inheritdoc IERC7857
    function getDelegateAccess(address _user) external view override returns (address) {
        return _delegates[_user];
    }

    // ─── ERC-7857 Metadata ─────────────────────────────────────────────

    /// @inheritdoc IERC7857Metadata
    function intelligentDataOf(
        uint256 _tokenId
    ) external view override returns (IntelligentData[] memory) {
        require(_requireOwned(_tokenId) != address(0), "Token does not exist");
        return _intelligentData[_tokenId];
    }

    /// @dev Override required because both ERC721 and IERC7857Metadata declare name()
    function name() public view override(ERC721, IERC7857Metadata) returns (string memory) {
        return super.name();
    }

    /// @dev Override required because both ERC721 and IERC7857Metadata declare symbol()
    function symbol() public view override(ERC721, IERC7857Metadata) returns (string memory) {
        return super.symbol();
    }

    // ─── Interface Support ──────────────────────────────────────────────

    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return
            interfaceId == type(IERC7857).interfaceId ||
            interfaceId == type(IERC7857Metadata).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ─── ERC-721 Transfer Override ────────────────────────────────────
    // Disable bare ERC-721 transfers — all transfers MUST go through
    // iTransfer() with proof verification per ERC-7857.

    function transferFrom(address, address, uint256) public pure override {
        revert("Use iTransfer() with proofs");
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert("Use iTransfer() with proofs");
    }

    // ─── Internals ──────────────────────────────────────────────────────

    function _ownerOrAuthorized(uint256 tokenId, address caller) private view returns (bool) {
        return ownerOf(tokenId) == caller || _authorizedUsers[tokenId].contains(caller);
    }

}
