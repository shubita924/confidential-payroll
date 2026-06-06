const CONTRACT = "0xB0A0A62B1f7e1950096f7eeCEB3991837c1B94f3";

const logEl = document.getElementById("log");
const log = (m) => { logEl.textContent += "\n" + m; console.log(m); };

// Reload if the user changes network manually, so the provider is never stale.
if (window.ethereum) {
  window.ethereum.on("chainChanged", () => window.location.reload());
}

let provider, signer, instance;

document.getElementById("connect").addEventListener("click", async () => {
  try {
    const SDK = window.relayerSDK;
    if (!SDK) { log("❌ SDK global not found."); return; }

    // Pick MetaMask specifically.
    let eth = window.ethereum;
    if (eth?.providers?.length) {
      eth = eth.providers.find((p) => p.isMetaMask) || eth;
    }
    if (!eth) { log("❌ No wallet found."); return; }

    // Ask MetaMask to switch THIS site to Sepolia (0xaa36a7 = 11155111).
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (switchErr) {
      log("⚠ Switch request: " + (switchErr.message || switchErr));
    }

    await eth.request({ method: "eth_requestAccounts" });

    // Create the provider AFTER switching, so it isn't cached on mainnet.
    provider = new ethers.BrowserProvider(eth);
    signer = await provider.getSigner();
    log("✓ Wallet: " + (await signer.getAddress()));

    const net = await provider.getNetwork();
    if (net.chainId !== 11155111n) {
      log("⚠ Still not on Sepolia (chainId " + net.chainId + "). Approve the switch in MetaMask, then click again.");
      return;
    }
    log("✓ On Sepolia");

    log("Initializing FHE SDK (loading WASM)…");
    await SDK.initSDK();
    instance = await SDK.createInstance({ ...SDK.SepoliaConfig, network: eth });
    log("✓ SDK ready — encryption is live.");
    document.getElementById("panel").style.display = "block";
  } catch (e) {
    log("ERROR: " + (e.message || e));
    console.error(e);
  }
});



const ABI = [
    "function paySalary(address employee, bytes32 amount, bytes inputProof) external",
  ];
  
  document.getElementById("pay").addEventListener("click", async () => {
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
  
      const contract = new ethers.Contract(CONTRACT, ABI, signer);
      const tx = await contract.paySalary(employee, enc.handles[0], enc.inputProof);
      log("tx sent: " + tx.hash);
      await tx.wait();
      log("✓ Salary paid on-chain. The amount is encrypted — not visible on Etherscan.");
    } catch (e) {
      log("ERROR: " + (e.message || e));
      console.error(e);
    }
  });