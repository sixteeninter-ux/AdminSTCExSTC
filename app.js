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

  // ตาม ABI ที่คุณให้มา
  const STAKE_ABI = [
    "function owner() view returns(address)",
    "function STCEx() view returns(address)",
    "function STC() view returns(address)",

    "function stcPerStcex() view returns(uint256)",
    "function minStakeSTCEx() view returns(uint256)",
    "function lockSeconds() view returns(uint256)",
    "function periodSeconds() view returns(uint256)",
    "function rewardBps() view returns(uint256)",

    "function positionsCount(address) view returns(uint256)",
    "function getPosition(address,uint256) view returns(uint256 principalSTC,uint256 startTime,bool withdrawn)",
    "function unlockAt(address,uint256) view returns(uint256)",
    "function timeUntilUnlock(address,uint256) view returns(uint256)",
    "function matured(address,uint256) view returns(bool)",
    "function accruedRewardSTC(address,uint256) view returns(uint256 reward,uint256 periods)",

    "function stakeWithSTCEx(uint256)",
    "function withdrawPosition(uint256)",
  ];

  let provider, signer, user;
  let stake, stcex, stc;
  let decEx = 18, decStc = 18;
  let ownerAddr = "-";
  let isOwner = false;

  // cache unlockAt for client-side countdown (เบาและลื่น)
  const unlockCache = new Map(); // key `${posId}` -> unlockAtSeconds
  let countdownTimer = null;

  function fmtUnits(v, dec, maxFrac = 6) {
    try {
      const s = ethers.formatUnits(v, dec);
      const n = Number(s);
      if (!isFinite(n)) return s;
      return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
    } catch { return "-"; }
  }

  function fmtDate(sec) {
    try {
      const d = new Date(Number(sec) * 1000);
      return d.toLocaleString();
    } catch { return "-"; }
  }

  function fmtDuration(sec) {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return "00:00:00";
    const d = Math.floor(sec / 86400);
    sec -= d * 86400;
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec - m * 60);
    const pad = (x) => String(x).padStart(2, "0");
    return (d > 0 ? `${d}d ` : "") + `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  async function ensureBSC() {
    if (!window.ethereum) throw new Error("ไม่พบ Wallet (MetaMask/Bitget)");
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== C.CHAIN_ID_HEX) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: C.CHAIN_ID_HEX }],
      });
    }
  }

  function setLinks() {
    $("contract").textContent = C.CONTRACT;
    $("linkContract").href = `${C.EXPLORER}/address/${C.CONTRACT}`;
    if (user) $("linkWallet").href = `${C.EXPLORER}/address/${user}`;
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
      $("owner").textContent = ownerAddr;
      $("isOwner").textContent = isOwner ? "✅ YES" : "❌ NO";

      $("btnRefresh").disabled = false;
      $("btnApprove").disabled = false;
      $("btnStake").disabled = false;

      setLinks();
      await refreshAll();

      setStatus("เชื่อมต่อสำเร็จ ✅");
    } catch (e) {
      setStatus("เชื่อมต่อไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function refreshBalancesAndAllowance() {
    const [bEx, bStc, allow] = await Promise.all([
      stcex.balanceOf(user),
      stc.balanceOf(user),
      stcex.allowance(user, C.CONTRACT),
    ]);
    $("balSTCEx").textContent = fmtUnits(bEx, decEx);
    $("balSTC").textContent = fmtUnits(bStc, decStc);
    $("allowSTCEx").textContent = fmtUnits(allow, decEx);
  }

  async function refreshParamsAndContractBalances() {
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

    const [cSTC, cSTCEx] = await Promise.all([
      stc.balanceOf(C.CONTRACT),
      stcex.balanceOf(C.CONTRACT),
    ]);
    $("cSTC").textContent = fmtUnits(cSTC, decStc);
    $("cSTCEx").textContent = fmtUnits(cSTCEx, decEx);
  }

  async function loadPositions() {
    unlockCache.clear();
    const n = await stake.positionsCount(user);
    $("posCount").textContent = n.toString();

    const tbody = $("posTbody");
    if (Number(n) === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่มี position</td></tr>`;
      return;
    }

    // ดึงข้อมูลทั้งหมดแบบ parallel
    const ids = [...Array(Number(n)).keys()];
    const posPromises = ids.map((i) => stake.getPosition(user, i));
    const unlockPromises = ids.map((i) => stake.unlockAt(user, i));
    const maturedPromises = ids.map((i) => stake.matured(user, i));
    const rewardPromises = ids.map((i) => stake.accruedRewardSTC(user, i));

    const [positions, unlocks, matureds, rewards] = await Promise.all([
      Promise.all(posPromises),
      Promise.all(unlockPromises),
      Promise.all(maturedPromises),
      Promise.all(rewardPromises),
    ]);

    // build table
    let html = "";
    for (let i = 0; i < ids.length; i++) {
      const posId = ids[i];
      const p = positions[i];
      const principal = p.principalSTC;
      const start = p.startTime;
      const withdrawn = p.withdrawn;

      const unlockAt = unlocks[i];
      unlockCache.set(String(posId), Number(unlockAt));

      const matured = matureds[i];
      const reward = rewards[i].reward;
      const periods = rewards[i].periods;

      const status =
        withdrawn ? `<span class="danger">Withdrawn</span>` :
        matured   ? `<span class="ok">Matured</span>` :
                    `<span class="warn">Locked</span>`;

      const btn =
        withdrawn ? "-" :
        matured ? `<button data-w="${posId}" class="btnWithdraw">Withdraw</button>` :
                  `<span class="small">รอครบสัญญา</span>`;

      html += `
        <tr>
          <td class="mono">${posId}</td>
          <td class="mono">${fmtUnits(principal, decStc, 6)}</td>
          <td class="mono">${fmtDate(start)}</td>
          <td class="mono">${fmtDate(unlockAt)}</td>
          <td class="mono" id="cd_${posId}">-</td>
          <td class="mono">${periods.toString()}</td>
          <td class="mono">${fmtUnits(reward, decStc, 6)}</td>
          <td>${status}</td>
          <td>${btn}</td>
        </tr>
      `;
    }

    tbody.innerHTML = html;

    // bind withdraw buttons
    [...document.querySelectorAll(".btnWithdraw")].forEach((b) => {
      b.onclick = async () => {
        const posId = Number(b.getAttribute("data-w"));
        await withdraw(posId);
      };
    });

    startCountdownLoop();
  }

  function startCountdownLoop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      for (const [posId, unlockAt] of unlockCache.entries()) {
        const el = document.getElementById(`cd_${posId}`);
        if (!el) continue;
        const left = unlockAt - now;
        el.textContent = left <= 0 ? "ครบแล้ว ✅" : fmtDuration(left);
      }
    }, 1000);
  }

  async function refreshAll() {
    try {
      if (!user) return;
      setLinks();
      await Promise.all([
        refreshBalancesAndAllowance(),
        refreshParamsAndContractBalances(),
      ]);
      await loadPositions();
      setStatus("อัปเดตแล้ว ✅");
    } catch (e) {
      setStatus("Refresh ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function approve() {
    try {
      if (!user) return setStatus("กรุณาเชื่อมต่อก่อน");
      // approve แบบ unlimited
      const tx = await stcex.approve(C.CONTRACT, ethers.MaxUint256);
      setStatus("กำลัง Approve... " + tx.hash);
      await tx.wait();
      setStatus("Approve สำเร็จ ✅");
      await refreshBalancesAndAllowance();
    } catch (e) {
      setStatus("Approve ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function stakeNow() {
    try {
      if (!user) return setStatus("กรุณาเชื่อมต่อก่อน");
      const s = ($("inStake").value || "").trim();
      if (!s) throw new Error("กรุณาใส่จำนวน STCEx");
      const amt = ethers.parseUnits(s, decEx);

      const tx = await stake.stakeWithSTCEx(amt);
      setStatus("กำลัง Stake... " + tx.hash);
      await tx.wait();
      setStatus("Stake สำเร็จ ✅");
      $("inStake").value = "";
      await refreshAll();
    } catch (e) {
      setStatus("Stake ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  async function withdraw(posId) {
    try {
      const ok = confirm(`ยืนยันถอน posId ${posId} ?\n(จะจ่าย STC: ต้น + ดอก)`);
      if (!ok) return;

      const tx = await stake.withdrawPosition(posId);
      setStatus("กำลัง Withdraw... " + tx.hash);
      await tx.wait();
      setStatus("Withdraw สำเร็จ ✅");
      await refreshAll();
    } catch (e) {
      setStatus("Withdraw ไม่สำเร็จ: " + (e?.shortMessage || e?.message || e));
    }
  }

  window.addEventListener("load", () => {
    $("btnConnect").onclick = connect;
    $("btnRefresh").onclick = refreshAll;
    $("btnApprove").onclick = approve;
    $("btnStake").onclick = stakeNow;
    setLinks();
    setStatus("พร้อมใช้งาน: กดเชื่อมต่อกระเป๋า");
  });
})();
