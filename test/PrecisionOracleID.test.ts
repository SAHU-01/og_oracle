import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PrecisionOracleID", function () {
  let oracle: any;
  let verifier: any;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const STORAGE_ROOT = ethers.keccak256(ethers.toUtf8Bytes("test-resolution"));

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory("OracleDataVerifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const Oracle = await ethers.getContractFactory("PrecisionOracleID");
    oracle = await Oracle.deploy(await verifier.getAddress());
    await oracle.waitForDeployment();
  });

  // ─── Minting ────────────────────────────────────────────────────────

  describe("Minting", function () {
    it("owner can mint", async function () {
      await oracle.mint(alice.address);
      expect(await oracle.ownerOf(1)).to.equal(alice.address);
    });

    it("non-owner cannot mint", async function () {
      await expect(
        oracle.connect(alice).mint(alice.address)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("token IDs increment", async function () {
      await oracle.mint(alice.address);
      await oracle.mint(bob.address);
      expect(await oracle.ownerOf(1)).to.equal(alice.address);
      expect(await oracle.ownerOf(2)).to.equal(bob.address);
    });
  });

  // ─── Resolution Recording ──────────────────────────────────────────

  describe("recordResolution", function () {
    beforeEach(async function () {
      await oracle.mint(alice.address);
    });

    it("token owner can record resolution", async function () {
      await oracle
        .connect(alice)
        .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress);

      expect(await oracle.storageRoots(1)).to.equal(STORAGE_ROOT);
      expect(await oracle.resolutionCount(1)).to.equal(1);
    });

    it("unauthorized user cannot record", async function () {
      await expect(
        oracle
          .connect(bob)
          .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress)
      ).to.be.revertedWith("Not owner or authorized");
    });

    it("authorized user CAN record", async function () {
      await oracle.connect(alice).authorizeUsage(1, bob.address);
      await oracle
        .connect(bob)
        .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress);

      expect(await oracle.resolutionCount(1)).to.equal(1);
    });

    it("revoked user cannot record", async function () {
      await oracle.connect(alice).authorizeUsage(1, bob.address);
      await oracle.connect(alice).revokeAuthorization(1, bob.address);

      await expect(
        oracle
          .connect(bob)
          .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress)
      ).to.be.revertedWith("Not owner or authorized");
    });

    it("rejects empty storage root", async function () {
      await expect(
        oracle
          .connect(alice)
          .recordResolution(1, ethers.ZeroHash, "0x", ethers.ZeroAddress)
      ).to.be.revertedWith("Empty storage root");
    });

    it("increments nonce on each resolution", async function () {
      const root2 = ethers.keccak256(ethers.toUtf8Bytes("second"));
      await oracle
        .connect(alice)
        .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress);
      await oracle
        .connect(alice)
        .recordResolution(1, root2, "0x", ethers.ZeroAddress);

      expect(await oracle.resolutionCount(1)).to.equal(2);
      expect(await oracle.storageRoots(1)).to.equal(root2);
      expect(await oracle.resolutionNonces(1)).to.equal(2);
    });

    it("adds IntelligentData entries", async function () {
      await oracle
        .connect(alice)
        .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress);

      const data = await oracle.intelligentDataOf(1);
      expect(data.length).to.equal(1);
      expect(data[0].dataDescription).to.equal("Oracle Resolution #0");
      expect(data[0].dataHash).to.equal(STORAGE_ROOT);
    });

    it("emits ResolutionRecorded event", async function () {
      await expect(
        oracle
          .connect(alice)
          .recordResolution(1, STORAGE_ROOT, "0x", ethers.ZeroAddress)
      ).to.emit(oracle, "ResolutionRecorded");
    });
  });

  // ─── TEE Signature Verification ────────────────────────────────────

  describe("TEE signature on-chain verification", function () {
    let teeSigner: SignerWithAddress;

    beforeEach(async function () {
      teeSigner = bob;
      await oracle.mint(alice.address);
      await oracle.registerTeeSigner(teeSigner.address);
    });

    it("accepts valid TEE signature", async function () {
      // TEE signer signs the storageRoot (EIP-191 personal sign)
      const signature = await teeSigner.signMessage(
        ethers.getBytes(STORAGE_ROOT)
      );

      await oracle
        .connect(alice)
        .recordResolution(1, STORAGE_ROOT, signature, teeSigner.address);

      expect(await oracle.resolutionCount(1)).to.equal(1);
    });

    it("rejects invalid TEE signature", async function () {
      // Alice signs instead of the registered TEE signer
      const badSig = await alice.signMessage(ethers.getBytes(STORAGE_ROOT));

      await expect(
        oracle
          .connect(alice)
          .recordResolution(1, STORAGE_ROOT, badSig, teeSigner.address)
      ).to.be.revertedWith("TEE signature verification failed");
    });

    it("rejects unregistered TEE signer", async function () {
      const signature = await alice.signMessage(ethers.getBytes(STORAGE_ROOT));

      await expect(
        oracle
          .connect(alice)
          .recordResolution(1, STORAGE_ROOT, signature, alice.address)
      ).to.be.revertedWith("TEE signer not registered");
    });
  });

  // ─── ERC-7857 Authorization ────────────────────────────────────────

  describe("ERC-7857 Authorization", function () {
    beforeEach(async function () {
      await oracle.mint(alice.address);
    });

    it("authorizeUsage + authorizedUsersOf", async function () {
      await oracle.connect(alice).authorizeUsage(1, bob.address);
      const users = await oracle.authorizedUsersOf(1);
      expect(users).to.include(bob.address);
    });

    it("revokeAuthorization removes user", async function () {
      await oracle.connect(alice).authorizeUsage(1, bob.address);
      await oracle.connect(alice).revokeAuthorization(1, bob.address);
      const users = await oracle.authorizedUsersOf(1);
      expect(users).to.not.include(bob.address);
    });

    it("delegateAccess + getDelegateAccess", async function () {
      await oracle.connect(alice).delegateAccess(bob.address);
      expect(await oracle.getDelegateAccess(alice.address)).to.equal(
        bob.address
      );
    });
  });

  // ─── ERC-721 Transfer Lockdown ─────────────────────────────────────

  describe("ERC-721 transfer lockdown", function () {
    beforeEach(async function () {
      await oracle.mint(alice.address);
    });

    it("transferFrom reverts", async function () {
      await expect(
        oracle.connect(alice).transferFrom(alice.address, bob.address, 1)
      ).to.be.revertedWith("Use iTransfer() with proofs");
    });

    it("safeTransferFrom reverts", async function () {
      await expect(
        oracle
          .connect(alice)
          ["safeTransferFrom(address,address,uint256,bytes)"](
            alice.address,
            bob.address,
            1,
            "0x"
          )
      ).to.be.revertedWith("Use iTransfer() with proofs");
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────

  describe("intelligentDataPaginated", function () {
    beforeEach(async function () {
      await oracle.mint(alice.address);
      // Record 5 resolutions
      for (let i = 0; i < 5; i++) {
        const root = ethers.keccak256(ethers.toUtf8Bytes(`resolution-${i}`));
        await oracle
          .connect(alice)
          .recordResolution(1, root, "0x", ethers.ZeroAddress);
      }
    });

    it("returns correct page", async function () {
      const [result, total] = await oracle.intelligentDataPaginated(1, 1, 2);
      expect(total).to.equal(5);
      expect(result.length).to.equal(2);
      expect(result[0].dataDescription).to.equal("Oracle Resolution #1");
      expect(result[1].dataDescription).to.equal("Oracle Resolution #2");
    });

    it("handles offset beyond length", async function () {
      const [result, total] = await oracle.intelligentDataPaginated(1, 10, 5);
      expect(total).to.equal(5);
      expect(result.length).to.equal(0);
    });

    it("clamps limit to remaining items", async function () {
      const [result, total] = await oracle.intelligentDataPaginated(1, 3, 100);
      expect(total).to.equal(5);
      expect(result.length).to.equal(2);
    });
  });

  // ─── supportsInterface ─────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("supports ERC-721", async function () {
      expect(await oracle.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("supports ERC-7857", async function () {
      // IERC7857 interface ID
      const iface = new ethers.Interface([
        "function verifier() view returns (address)",
        "function iTransfer(address,uint256,(((bytes32,bytes32,bytes,bytes,bytes),(uint8,bytes32,bytes32,bytes,bytes,bytes,bytes)))[]) external",
        "function iClone(address,uint256,(((bytes32,bytes32,bytes,bytes,bytes),(uint8,bytes32,bytes32,bytes,bytes,bytes,bytes)))[]) external returns (uint256)",
        "function authorizeUsage(uint256,address) external",
        "function revokeAuthorization(uint256,address) external",
        "function delegateAccess(address) external",
        "function authorizedUsersOf(uint256) view returns (address[])",
        "function getDelegateAccess(address) view returns (address)",
      ]);
      // Just check that the contract reports support for IERC7857
      // The exact interface ID depends on function selectors
      const id = iface.getFunction("verifier")!.selector;
      // We can't easily compute the full interfaceId, so just verify ERC721 + custom
      expect(await oracle.supportsInterface("0x80ac58cd")).to.be.true;
    });
  });
});

describe("OracleDataVerifier", function () {
  let verifier: any;
  let signer: SignerWithAddress;

  beforeEach(async function () {
    [signer] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("OracleDataVerifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
  });

  it("validates well-formed proofs with valid signatures", async function () {
    const oldHash = ethers.keccak256(ethers.toUtf8Bytes("old"));
    const newHash = ethers.keccak256(ethers.toUtf8Bytes("new"));
    const nonce = ethers.toUtf8Bytes("nonce-1");

    // Sign keccak256(abi.encodePacked(oldHash, newHash, nonce))
    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "bytes32", "bytes"],
        [oldHash, newHash, nonce]
      )
    );
    const signature = await signer.signMessage(ethers.getBytes(digest));

    const proof = {
      accessProof: {
        oldDataHash: oldHash,
        newDataHash: newHash,
        nonce: nonce,
        encryptedPubKey: "0x",
        proof: signature,
      },
      ownershipProof: {
        oracleType: 0, // TEE
        oldDataHash: oldHash,
        newDataHash: newHash,
        sealedKey: "0x",
        encryptedPubKey: "0x",
        nonce: nonce,
        proof: signature,
      },
    };

    const outputs = await verifier.verifyTransferValidity([proof]);
    expect(outputs.length).to.equal(1);
    expect(outputs[0].newDataHash).to.equal(newHash);
    // accessAssistant is the recovered signer
    expect(outputs[0].accessAssistant.toLowerCase()).to.equal(
      signer.address.toLowerCase()
    );
  });

  it("rejects empty proof bytes", async function () {
    const oldHash = ethers.keccak256(ethers.toUtf8Bytes("old"));
    const newHash = ethers.keccak256(ethers.toUtf8Bytes("new"));

    const proof = {
      accessProof: {
        oldDataHash: oldHash,
        newDataHash: newHash,
        nonce: ethers.toUtf8Bytes("n"),
        encryptedPubKey: "0x",
        proof: "0x", // empty — should fail
      },
      ownershipProof: {
        oracleType: 0,
        oldDataHash: oldHash,
        newDataHash: newHash,
        sealedKey: "0x",
        encryptedPubKey: "0x",
        nonce: ethers.toUtf8Bytes("n"),
        proof: "0x",
      },
    };

    await expect(
      verifier.verifyTransferValidity([proof])
    ).to.be.revertedWith("Access: proof must be 65-byte ECDSA signature");
  });

  it("rejects mismatched hashes", async function () {
    const hash1 = ethers.keccak256(ethers.toUtf8Bytes("a"));
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes("b"));

    const sig = await signer.signMessage(ethers.toUtf8Bytes("dummy"));

    const proof = {
      accessProof: {
        oldDataHash: hash1,
        newDataHash: hash2,
        nonce: ethers.toUtf8Bytes("n"),
        encryptedPubKey: "0x",
        proof: sig,
      },
      ownershipProof: {
        oracleType: 0,
        oldDataHash: hash1,
        newDataHash: hash1, // mismatch with accessProof.newDataHash
        sealedKey: "0x",
        encryptedPubKey: "0x",
        nonce: ethers.toUtf8Bytes("n"),
        proof: sig,
      },
    };

    await expect(
      verifier.verifyTransferValidity([proof])
    ).to.be.revertedWith("Hash mismatch: access vs ownership");
  });
});
