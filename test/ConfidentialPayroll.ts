import { ConfidentialPayroll, ConfidentialPayroll__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { fhevm } from "hardhat";
import { ethers } from "hardhat";
import { expect } from "chai";

type Signers = {
  employer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
    const factory = (await ethers.getContractFactory(
        "contracts/ConfidentialPayroll.sol:ConfidentialPayroll",
      )) as ConfidentialPayroll__factory;
  const contract = (await factory.deploy()) as ConfidentialPayroll;
  const address = await contract.getAddress();
  return { contract, address };
}

describe("ConfidentialPayroll", function () {
  let signers: Signers;
  let contract: ConfidentialPayroll;
  let address: string;

  before(async function () {
    const eth = await ethers.getSigners();
    // employer = deployer, alice/bob = employees
    signers = { employer: eth[0], alice: eth[1], bob: eth[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      throw new Error(`This test suite runs only in FHEVM mock mode`);
    }
    ({ contract, address } = await deployFixture());
  });

  it("sets the deployer as the employer", async function () {
    expect(await contract.employer()).to.equal(signers.employer.address);
  });

  it("accumulates salary across multiple payments and lets the employee decrypt", async function () {
    // First payment: 3500
    const enc1 = await fhevm
      .createEncryptedInput(address, signers.employer.address)
      .add32(3500)
      .encrypt();
    await contract
      .connect(signers.employer)
      .paySalary(signers.alice.address, enc1.handles[0], enc1.inputProof);

    // Second payment: 1500  -> total should be 5000
    const enc2 = await fhevm
      .createEncryptedInput(address, signers.employer.address)
      .add32(1500)
      .encrypt();
    await contract
      .connect(signers.employer)
      .paySalary(signers.alice.address, enc2.handles[0], enc2.inputProof);

    // Alice reads her encrypted handle and decrypts it herself.
    const encryptedTotal = await contract.getSalary(signers.alice.address);
    const clearTotal = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedTotal,
      address,
      signers.alice,
    );

    expect(clearTotal).to.equal(5000);
  });

  it("blocks a non-employer from paying", async function () {
    const enc = await fhevm
      .createEncryptedInput(address, signers.alice.address)
      .add32(9999)
      .encrypt();

    await expect(
      contract
        .connect(signers.alice)
        .paySalary(signers.bob.address, enc.handles[0], enc.inputProof),
    ).to.be.revertedWith("Only employer can pay");
  });
});