(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const setStatus = (t) => { const el = $("status"); if (el) el.textContent = String(t ?? "-"); };

  const ERC20_ABI = [
    "function decimals() view returns(uint8)",
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
  ];

  const STAKE_ABI = [
    "function owner() view returns(address)",

    "function stcPerStcex() view returns(uint256)",
    "function minStakeSTCEx() view returns(uint256)",
    "function lockSeconds() view returns(uint256)",
    "function periodSeconds() view returns(uint256)",
    "function rewardBps() view returns(uint256)",

    "function setParams(uint256,uint256,uint256,uint256,uint256)",
    "function ownerWithdrawToken(address,uint256)",
    "function transferOwnership(address)",

    "function airdropSTCEx(address[] to, uint256[] amounts)",
  ];

  let provider, signer, user;
  let stake, stcex, stc;
  let decEx = 18, decStc = 18;
  let ownerAddr = "-";
  let isOwner = false;

  const short = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "-";

  function fmtUnits(v, dec, maxFrac = 6) {
    try {
      const s = ethers.formatUnits(v, dec);
      const n = Number(s);
      if (!isFinite(n)) return s;
      return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
    } catch { return "-"; }
  }

  function setStatic() {
    $("contract").textContent = C.CONTRACT;
    $("addrSTCEx").textContent = C.STCEX;
    $("addrSTC").textContent = C.STC;
  }

  async function ensureBSC() {
    if (!window.ethereum) throw new Error("ไม่พบ Wallet");
    const want = C.CHAIN_ID_HEX || "0x38";

    // บาง wallet ต้องขอ accounts ก่อน ถึงจะ switch chain ได้
    try { await window.ethereum.request({ method: "eth_requestAccounts" }); } catch {}

    const cur = await window.ethereum.request({ method: "eth_chainId" });
    if (cur === want) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: want }],
      });
    } catch (e) {
      const msg = String(e?.message || e);
      // 4902 = chain ยังไม่ถูก add
      if (e?.code === 4902 || msg.includes("4902")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: want,
            chainName: C.CHAIN_NAME || "BSC Mainnet",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [C.RPC_URL || "https://bsc-dataseed.binance.org/"],
            blockExplorerUrls: [C.EXPLORER || "https://bscscan.com"],
          }],
        });
        // หลัง add แล้วสลับอีกครั้ง
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: want }],
        });
      } else if (e?.code === 4001) {
        throw new Error("คุณยกเลิกการสลับเครือข่าย");
      } else {
        throw new Error("กรุณาสลับเครือข่ายเป็น BSC ก่อนทำรายการ");
      }
    }
  }

  function applyOwnerUI() {
    $("owner").textContent = ownerAddr;
    $("isOwner").textContent = isOwner ? "✅ YES" : "❌ NO";

    $("btnRefresh").disabled = !user;

    const en = !!isOwner;
    $("btnSetParams").disabled = !en;
    $("btnTestMode").disabled = !en;
    $("btnProdMode").disabled = !en;

    $("btnWithdrawToken").disabled = !en;
    $("btnFillSTCEx").disabled = !en;
    $("btnFillSTC").disabled = !en;

    $("btnAirdropApprove").disabled = !en;
    $("btnAirdropSend").disabled = !en;

    $("btnChangeOwner").disabled = !en;
  }

  async function rebuildProviderSigner() {
    // สำคัญมาก: หลัง switch chain ให้สร้าง provider ใหม่
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    user = await signer.getAddress();
  }

  async function connect() {
    try {
      setStatus("⏳ กำลังเชื่อมต่อ...");
      await ensureBSC();
      await rebuildProviderSigner();

      stake = new ethers.Contract(C.CONTRACT, STAKE_ABI, signer);
      stcex = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc   = new ethers.Contract(C.STC,   ERC20_ABI, signer);

      try { decEx = Number(await stcex.decimals()); } catch {}
      try { decStc = Number(await stc.decimals()); } catch {}

      ownerAddr = await stake.owner();
      isOwner = ownerAddr.toLowerCase() === user.toLowerCase();

      $("wallet").textContent = user;
      setStatic();
      applyOwnerUI();

      await refreshAll();
      setStatus(isOwner ? "✅ เชื่อมต่อสำเร็จ (คุณเป็น Owner)" : "✅ เชื่อมต่อสำเร็จ (แต่ไม่ใช่ Owner)");
    } catch (e) {
      console.error(e);
      setStatus("❌ เชื่อมต่อไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function refreshAll() {
    try {
      if (!user) return;

      ownerAddr = await stake.owner();
      isOwner = ownerAddr.toLowerCase() === user.toLowerCase();
      applyOwnerUI();

      const [p1, p2, p3, p4, p5] = await Promise.all([
        stake.stcPerStcex(),
        stake.minStakeSTCEx(),
        stake.lockSeconds(),
        stake.periodSeconds(),
        stake.rewardBps(),
      ]);

      $("p1").textContent = p1.toString();
      $("p2").textContent = p2.toString();
      $("p3").textContent = p3.toString();
      $("p4").textContent = p4.toString();
      $("p5").textContent = p5.toString();

      // auto fill inputs
      $("in1").value = p1.toString();
      $("in2").value = p2.toString();
      $("in3").value = p3.toString();
      $("in4").value = p4.toString();
      $("in5").value = p5.toString();

      const [cSTC, cSTCEx] = await Promise.all([
        stc.balanceOf(C.CONTRACT),
        stcex.balanceOf(C.CONTRACT),
      ]);

      $("cSTC").textContent = fmtUnits(cSTC, decStc);
      $("cSTCEx").textContent = fmtUnits(cSTCEx, decEx);

      setStatus("✅ อัปเดตแล้ว");
    } catch (e) {
      console.error(e);
      setStatus("❌ Refresh ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function setParams(mode) {
    try {
      if (!isOwner) return setStatus("❌ คุณไม่ใช่ Owner");
      await ensureBSC();

      let stcPerStcex, minStake, lockS, periodS, bps;

      if (mode === "test") {
        stcPerStcex = ($("in1").value || "").trim() || "1000000000000000000000";
        minStake    = ($("in2").value || "").trim() || "10000000000000000000";
        lockS       = "300";
        periodS     = "60";
        bps         = "1000";
      } else if (mode === "prod") {
        stcPerStcex = ($("in1").value || "").trim() || "1000000000000000000000";
        minStake    = ($("in2").value || "").trim() || "10000000000000000000";
        lockS       = "31536000";
        periodS     = "2592000";
        bps         = "1000";
      } else {
        stcPerStcex = ($("in1").value || "").trim();
        minStake    = ($("in2").value || "").trim();
        lockS       = ($("in3").value || "").trim();
        periodS     = ($("in4").value || "").trim();
        bps         = ($("in5").value || "").trim();
      }

      if (!stcPerStcex || !minStake || !lockS || !periodS || !bps) {
        throw new Error("กรอกค่าให้ครบก่อน");
      }

      const tx = await stake.setParams(stcPerStcex, minStake, lockS, periodS, bps);
      setStatus("⏳ กำลัง setParams... " + tx.hash);
      await tx.wait();
      setStatus("✅ setParams สำเร็จ");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus("❌ setParams ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function ownerWithdraw() {
    try {
      if (!isOwner) return setStatus("❌ คุณไม่ใช่ Owner");
      await ensureBSC();

      const token = ($("wToken").value || "").trim();
      const amt   = ($("wAmt").value || "").trim();
      if (!token || !amt) throw new Error("กรอก token และ amount");

      const tx = await stake.ownerWithdrawToken(token, amt);
      setStatus("⏳ กำลัง Withdraw... " + tx.hash);
      await tx.wait();
      setStatus("✅ Withdraw สำเร็จ");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus("❌ Withdraw ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  function fillToken(addr) { $("wToken").value = addr; }

  function parseAirdropList(text) {
    const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const to = [];
    const amounts = [];
    for (const line of lines) {
      const parts = line.split(",").map(s => s.trim());
      if (parts.length !== 2) throw new Error("รูปแบบผิด: " + line);
      const addr = parts[0];
      const amtStr = parts[1];
      if (!addr.startsWith("0x") || addr.length !== 42) throw new Error("address ผิด: " + addr);
      const amt = ethers.parseUnits(amtStr, decEx);
      to.push(addr);
      amounts.push(amt);
    }
    return { to, amounts };
  }

  async function airdropApproveTotal() {
    try {
      if (!isOwner) return setStatus("❌ คุณไม่ใช่ Owner");
      await ensureBSC();

      const { to, amounts } = parseAirdropList($("airList").value);
      if (to.length === 0) throw new Error("ไม่มีรายการ airdrop");

      let total = 0n;
      for (const a of amounts) total += a;

      const tx = await stcex.approve(C.CONTRACT, total);
      setStatus("⏳ กำลัง Approve STCEx(total)... " + tx.hash);
      await tx.wait();
      setStatus("✅ Approve total สำเร็จ");
    } catch (e) {
      console.error(e);
      setStatus("❌ Approve total ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function airdropSend() {
    try {
      if (!isOwner) return setStatus("❌ คุณไม่ใช่ Owner");
      await ensureBSC();

      const { to, amounts } = parseAirdropList($("airList").value);
      if (to.length === 0) throw new Error("ไม่มีรายการ airdrop");

      const ok = confirm(`ยืนยันส่ง Airdrop STCEx จำนวน ${to.length} กระเป๋า?`);
      if (!ok) return;

      const tx = await stake.airdropSTCEx(to, amounts);
      setStatus("⏳ กำลัง Airdrop... " + tx.hash);
      await tx.wait();
      setStatus("✅ Airdrop สำเร็จ");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus("❌ Airdrop ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function changeOwner() {
    try {
      if (!isOwner) return setStatus("❌ คุณไม่ใช่ Owner");

      // กัน Bitget: ขอ account + เช็ค chain ก่อนยิง tx
      await ensureBSC();
      await provider.send("eth_requestAccounts", []);

      const newOwner = ($("newOwnerAddr").value || "").trim();
      if (!newOwner.startsWith("0x") || newOwner.length !== 42) throw new Error("address ใหม่ไม่ถูกต้อง");

      const ok = confirm("⚠ ยืนยันเปลี่ยน Owner?\nโอนแล้วโอนไม่กลับ");
      if (!ok) return;

      const tx = await stake.transferOwnership(newOwner);
      setStatus("⏳ กำลังเปลี่ยน Owner... " + tx.hash);
      await tx.wait();

      setStatus("✅ เปลี่ยน Owner สำเร็จ (ตอนนี้คุณอาจไม่ใช่ Owner แล้ว)");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus("❌ Change Owner ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  window.addEventListener("load", () => {
    setStatic();

    $("btnConnect").onclick = connect;
    $("btnRefresh").onclick = refreshAll;

    $("btnSetParams").onclick = () => setParams("custom");
    $("btnTestMode").onclick = () => setParams("test");
    $("btnProdMode").onclick = () => setParams("prod");

    $("btnWithdrawToken").onclick = ownerWithdraw;
    $("btnFillSTCEx").onclick = () => fillToken(C.STCEX);
    $("btnFillSTC").onclick = () => fillToken(C.STC);

    $("btnAirdropApprove").onclick = airdropApproveTotal;
    $("btnAirdropSend").onclick = airdropSend;

    $("btnChangeOwner").onclick = changeOwner;

    setStatus("พร้อมใช้งาน: กดเชื่อมต่อกระเป๋า");
  });
})();
