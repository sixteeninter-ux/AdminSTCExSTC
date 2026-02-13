(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const setStatus = (t) => { $("status").textContent = t; };

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

  function fmtUnits(v, dec, maxFrac = 6) {
    try {
      const s = ethers.formatUnits(v, dec);
      const n = Number(s);
      if (!isFinite(n)) return s;
      return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
    } catch { return "-"; }
  }

  async function ensureBSC() {
    if (!window.ethereum) throw new Error("ไม่พบ Wallet");
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== C.CHAIN_ID_HEX) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: C.CHAIN_ID_HEX }],
      });
    }
  }

  function applyOwnerUI() {
    $("contract").textContent = C.CONTRACT;
    $("addrSTCEx").textContent = C.STCEX;
    $("addrSTC").textContent = C.STC;

    $("owner").textContent = ownerAddr;
    $("isOwner").textContent = isOwner ? "✅ YES" : "❌ NO";

    $("btnRefresh").disabled = !user;
    $("btnSetParams").disabled = !isOwner;
    $("btnTestMode").disabled = !isOwner;
    $("btnProdMode").disabled = !isOwner;

    $("btnWithdrawToken").disabled = !isOwner;
    $("btnFillSTCEx").disabled = !isOwner;
    $("btnFillSTC").disabled = !isOwner;

    $("btnAirdropApprove").disabled = !isOwner;
    $("btnAirdropSend").disabled = !isOwner;

    $("btnChangeOwner").disabled = !isOwner;
  }

  async function connect() {
    try {
      await ensureBSC();
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      user = await signer.getAddress();

      stake = new ethers.Contract(C.CONTRACT, STAKE_ABI, signer);
      stcex = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc   = new ethers.Contract(C.STC, ERC20_ABI, signer);

      decEx = await stcex.decimals();
      decStc = await stc.decimals();

      ownerAddr = await stake.owner();
      isOwner = ownerAddr.toLowerCase() === user.toLowerCase();

      $("wallet").textContent = user;
      applyOwnerUI();
      await refreshAll();
      setStatus(isOwner ? "เชื่อมต่อสำเร็จ ✅ (คุณเป็น Owner)" : "เชื่อมต่อสำเร็จ ✅ (แต่ไม่ใช่ Owner)");
    } catch (e) {
      setStatus("เชื่อมต่อไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
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

      setStatus("อัปเดตแล้ว ✅");
    } catch (e) {
      setStatus("Refresh ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function setParams(mode) {
    try {
      if (!isOwner) return setStatus("คุณไม่ใช่ Owner");

      let stcPerStcex, minStake, lockS, periodS, bps;

      if (mode === "test") {
        // test: lock 5m / period 1m / 10%
        stcPerStcex = $("in1").value || "1000000000000000000000";
        minStake = $("in2").value || "10000000000000000000";
        lockS = "300";
        periodS = "60";
        bps = "1000";
      } else if (mode === "prod") {
        // prod: 365d / 30d / 10%
        stcPerStcex = $("in1").value || "1000000000000000000000";
        minStake = $("in2").value || "10000000000000000000";
        lockS = "31536000";
        periodS = "2592000";
        bps = "1000";
      } else {
        stcPerStcex = $("in1").value.trim();
        minStake = $("in2").value.trim();
        lockS = $("in3").value.trim();
        periodS = $("in4").value.trim();
        bps = $("in5").value.trim();
      }

      const tx = await stake.setParams(stcPerStcex, minStake, lockS, periodS, bps);
      setStatus("กำลัง setParams... " + tx.hash);
      await tx.wait();
      setStatus("setParams สำเร็จ ✅");
      await refreshAll();
    } catch (e) {
      setStatus("setParams ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function ownerWithdraw() {
    try {
      if (!isOwner) return setStatus("คุณไม่ใช่ Owner");
      const token = $("wToken").value.trim();
      const amt = $("wAmt").value.trim();
      if (!token || !amt) throw new Error("กรอก token และ amount");
      const tx = await stake.ownerWithdrawToken(token, amt);
      setStatus("กำลัง Withdraw... " + tx.hash);
      await tx.wait();
      setStatus("Withdraw สำเร็จ ✅");
      await refreshAll();
    } catch (e) {
      setStatus("Withdraw ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  function fillToken(addr) { $("wToken").value = addr; }

  function parseAirdropList(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
      if (!isOwner) return setStatus("คุณไม่ใช่ Owner");
      const { to, amounts } = parseAirdropList($("airList").value);
      if (to.length === 0) throw new Error("ไม่มีรายการ airdrop");

      let total = 0n;
      for (const a of amounts) total += a;

      // approve contract ให้ดึงจาก owner ได้
      const tx = await stcex.approve(C.CONTRACT, total);
      setStatus("กำลัง Approve STCEx(total)... " + tx.hash);
      await tx.wait();
      setStatus("Approve total สำเร็จ ✅");
    } catch (e) {
      setStatus("Approve total ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function airdropSend() {
    try {
      if (!isOwner) return setStatus("คุณไม่ใช่ Owner");
      const { to, amounts } = parseAirdropList($("airList").value);
      if (to.length === 0) throw new Error("ไม่มีรายการ airdrop");

      const ok = confirm(`ยืนยันส่ง Airdrop STCEx จำนวน ${to.length} กระเป๋า?`);
      if (!ok) return;

      const tx = await stake.airdropSTCEx(to, amounts);
      setStatus("กำลัง Airdrop... " + tx.hash);
      await tx.wait();
      setStatus("Airdrop สำเร็จ ✅");
      await refreshAll();
    } catch (e) {
      setStatus("Airdrop ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function changeOwner() {
    try {
      if (!isOwner) return setStatus("คุณไม่ใช่ Owner");
      const newOwner = $("newOwnerAddr").value.trim();
      if (!newOwner.startsWith("0x") || newOwner.length !== 42) throw new Error("address ใหม่ไม่ถูกต้อง");

      const ok = confirm("⚠ ยืนยันเปลี่ยน Owner?\nโอนแล้วโอนไม่กลับ");
      if (!ok) return;

      const tx = await stake.transferOwnership(newOwner);
      setStatus("กำลังเปลี่ยน Owner... " + tx.hash);
      await tx.wait();
      setStatus("เปลี่ยน Owner สำเร็จ ✅");
      await refreshAll();
    } catch (e) {
      setStatus("Change Owner ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  window.addEventListener("load", () => {
    $("contract").textContent = C.CONTRACT;
    $("addrSTCEx").textContent = C.STCEX;
    $("addrSTC").textContent = C.STC;

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
