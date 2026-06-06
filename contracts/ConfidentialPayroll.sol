// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Confidential Payroll
/// @notice Employer pays salaries as encrypted amounts. Balances accumulate and
///         stay encrypted on-chain; only the employee and the employer can decrypt.
contract ConfidentialPayroll is ZamaEthereumConfig {
    address public employer;

    // Each employee's running salary total, stored encrypted.
    mapping(address => euint32) private _salary;

    event SalaryPaid(address indexed employee);

    constructor() {
        employer = msg.sender;
    }

    modifier onlyEmployer() {
        require(msg.sender == employer, "Only employer can pay");
        _;
    }

    /// @notice Pay an employee an encrypted amount; it adds to their total.
    function paySalary(
        address employee,
        externalEuint32 amount,
        bytes calldata inputProof
    ) external onlyEmployer {
        // Unwrap the encrypted input coming from the frontend.
        euint32 added = FHE.fromExternal(amount, inputProof);

        // Accumulate (uninitialized balance is treated as 0).
        _salary[employee] = FHE.add(_salary[employee], added);

        // Persist the new ciphertext and grant decryption rights.
        FHE.allowThis(_salary[employee]);
        FHE.allow(_salary[employee], employee);
        FHE.allow(_salary[employee], employer);

        emit SalaryPaid(employee);
    }

    /// @notice Returns the caller-readable encrypted salary handle for an employee.
    function getSalary(address employee) external view returns (euint32) {
        return _salary[employee];
    }
}