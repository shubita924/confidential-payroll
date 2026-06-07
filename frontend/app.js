const CONTRACT = "0xB0A0A62B1f7e1950096f7eeCEB3991837c1B94f3";

const logEl = document.getElementById("log");
const log = (m) => { logEl.textContent += "\n" + m; console.log(m); };
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

if (window.ethereum) {
  window.ethereum.on("chainChanged", () => window.location.reload());
}

let provider, signer, instance;

document.getElementById("connect").addEventListener("click", async () => {
  const btn = document.getElementById("connect");
  btn.disabled = true;
  try {
    const SDK = window.relayerSDK;
    if (!SDK) { log("❌ SDK global not found."); btn.disabled = false; return; }

    let eth = window.ethereum;
    if (eth?.providers?.length) eth = eth.providers.find((p) => p.isMetaMask) || eth;
    if (!eth) { log("❌ No wallet found."); btn.disabled = false; return; }

    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
    } catch (e) { log("⚠ Switch request: " + (e.message || e)); }

    await eth.request({ method: "eth_requestAccounts" });
    provider = new ethers.BrowserProvider(eth);
    signer = await provider.getSigner();
    const userAddr = await signer.getAddress();
    log("✓ Wallet: " + userAddr);

    const net = await provider.getNetwork();
    if (net.chainId !== 11155111n) {
      log("⚠ Not on Sepolia (chainId " + net.chainId + "). Approve the switch, then click again.");
      btn.disabled = false; return;
    }
    log("✓ On Sepolia");

    log("Initializing FHE SDK (loading WASM)…");
    await SDK.initSDK();
    instance = await SDK.createInstance({ ...SDK.SepoliaConfig, network: eth });
    log("✓ SDK ready — encryption is live.");

    // Detect role: only the employer sees the payroll panel.
    let role = "Employee";
    try {
      const roleC = new ethers.Contract(CONTRACT, ["function employer() view returns (address)"], provider);
      const employerAddr = await roleC.employer();
      if (userAddr.toLowerCase() === employerAddr.toLowerCase()) {
        role = "Employer";
        document.getElementById("employerPanel").style.display = "block";
      }
    } catch (e) {
      log("⚠ Could not read role, showing all panels.");
      document.getElementById("employerPanel").style.display = "block";
    }
    document.getElementById("employeePanel").style.display = "block";

    document.getElementById("walletAddr").textContent = short(userAddr);
    document.getElementById("walletRole").textContent = role;
    document.getElementById("status").style.display = "inline-flex";
    btn.textContent = "Connected ✓";
  } catch (e) {
    log("ERROR: " + (e.message || e));
    console.error(e);
    btn.disabled = false;
  }
});

const PAY_ABI = ["function paySalary(address employee, bytes32 amount, bytes inputProof) external"];

document.getElementById("pay").addEventListener("click", async () => {
  const btn = document.getElementById("pay");
  btn.disabled = true;
  try {
    const employee = document.getElementById("employee").value.trim();
    const amount = parseInt(document.getElementById("amount").value, 10);
    if (!ethers.isAddress(employee)) { log("❌ Invalid employee address."); return; }
    if (!Number.isInteger(amount) || amount <= 0) { log("❌ Enter a positive amount."); return; }

    const userAddr = await signer.getAddress();
    log(`Encrypting ${amount} for ${employee}…`);
    const input = instance.createEncryptedInput(CONTRACT, userAddr);
    input.add32(amount);
    const enc = await input.encrypt();
    log("✓ Encrypted. Sending transaction…");

    const contract = new ethers.Contract(CONTRACT, PAY_ABI, signer);
    const tx = await contract.paySalary(employee, enc.handles[0], enc.inputProof);
    log("tx sent: " + tx.hash);
    await tx.wait();
    log("✓ Salary paid on-chain. The amount is encrypted — not visible on Etherscan.");
  } catch (e) {
    log("ERROR: " + (e.message || e));
    console.error(e);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("decrypt").addEventListener("click", async () => {
  const btn = document.getElementById("decrypt");
  const balEl = document.getElementById("balance");
  btn.disabled = true;
  try {
    const userAddr = await signer.getAddress();
    const readAbi = ["function getSalary(address) view returns (bytes32)"];
    const contract = new ethers.Contract(CONTRACT, readAbi, provider);

    log("Reading encrypted balance…");
    const handle = await contract.getSalary(userAddr);
    log("Encrypted handle: " + handle);
    if (handle === ethers.ZeroHash) { log("No salary recorded yet."); balEl.textContent = "0"; return; }

    const keypair = instance.generateKeypair();
    const startTime = Math.floor(Date.now() / 1000);
    const durationDays = 7;
    const contracts = [CONTRACT];

    const eip712 = instance.createEIP712(keypair.publicKey, contracts, startTime, durationDays);
    log("Sign the decryption request in MetaMask…");
    const signature = await signer.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message,
    );

    log("Decrypting…");
    const result = await instance.userDecrypt(
      [{ handle, contractAddress: CONTRACT }],
      keypair.privateKey, keypair.publicKey,
      signature.replace("0x", ""),
      contracts, userAddr, startTime, durationDays,
    );

    const value = result[handle];
    balEl.textContent = value + " cUSD";
    balEl.classList.add("revealed");
    log("✓ Your decrypted salary: " + value);
  } catch (e) {
    log("ERROR: " + (e.message || e));
    console.error(e);
  } finally {
    btn.disabled = false;
  }
});