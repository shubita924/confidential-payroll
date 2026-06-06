import { task } from "hardhat/config";
import { FhevmType } from "@fhevm/hardhat-plugin";

const CONTRACT = "0xB0A0A62B1f7e1950096f7eeCEB3991837c1B94f3";

task("pay-salary", "Pay an encrypted salary to an employee")
  .addParam("employee", "Employee address")
  .addParam("amount", "Salary amount (plain number)")
  .setAction(async (args, hre) => {
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const [employer] = await ethers.getSigners();
    const payroll = await ethers.getContractAt("ConfidentialPayroll", CONTRACT);

    console.log(`Employer: ${employer.address}`);
    console.log(`Paying ${args.amount} to ${args.employee}...`);

    const enc = await fhevm
      .createEncryptedInput(CONTRACT, employer.address)
      .add32(parseInt(args.amount))
      .encrypt();

    const tx = await payroll
      .connect(employer)
      .paySalary(args.employee, enc.handles[0], enc.inputProof);
    console.log(`tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`confirmed on-chain.`);

    const encBalance = await payroll.getSalary(args.employee);
    const clear = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encBalance,
      CONTRACT,
      employer,
    );
    console.log(`Decrypted balance for employee (as employer): ${clear}`);
  });