document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const lastCleanEl = $("lastClean");
  const cookiesClearedEl = $("cookiesCleared");
  const statusEl = $("status");
  const premiumStatusEl = $("premiumStatus");
  const upgradeBtn = $("upgradeBtn");

  const cleanBtn = $("cleanNow");
  const smartBtn = $("smartProtection");
  const bulkBtn = $("bulkOptOut");

  const addWhitelistBtn = $("addWhitelist");
  const addBlacklistBtn = $("addBlacklist");

  function formatDate(ts) {
    if (!ts) return "Never";

    const d = new Date(ts);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function setStatus(active, isPremium) {
    if (!statusEl) return;

    let text = active ? "● Active" : "● Inactive";
    if (!isPremium) text += " (Free)";
    statusEl.textContent = text;
    statusEl.classList.toggle("active", active);
    statusEl.classList.toggle("inactive", !active);
  }

  async function refresh() {
    try {
      const data = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      console.log("Refresh data:", data);  // Debug
      if (!data || !data.state) return;

      if (lastCleanEl) lastCleanEl.textContent = formatDate(data.state.lastClean);
      if (cookiesClearedEl) cookiesClearedEl.textContent = data.state.cookiesCleared ?? 0;
      setStatus(!!data.state.active, !!data.state.isPremium);

      if (premiumStatusEl) {
        premiumStatusEl.textContent = data.state.isPremium ? "Premium Active" : "Free Version";
      }

      if (bulkBtn) {
        bulkBtn.disabled = !data.state.isPremium;
        bulkBtn.title = data.state.isPremium ? "" : "Premium Feature - Upgrade required";
      }

      if (data.state.lastError) {
        alert(`Error: ${data.state.lastError}`);
      }
    } catch (e) {
      setStatus(false, false);
      alert("Failed to connect: " + e.message);
    }
  }

  async function act(type) {
    try {
      const res = await chrome.runtime.sendMessage({ type });
      console.log(`Action ${type} response:`, res);  // Debug
      if (res.error) {
        alert(`Action failed: ${res.error}`);
      }
    } catch (e) {
      alert(`Action failed: ${e.message}`);
    }
    await refresh();
  }

  // Action buttons
  cleanBtn?.addEventListener("click", () => act("CLEAN_NOW"));
  smartBtn?.addEventListener("click", () => act("SMART_PROTECTION"));
  bulkBtn?.addEventListener("click", () => act("BULK_OPT_OUT"));
  upgradeBtn?.addEventListener("click", () => act("UPGRADE_PREMIUM"));

  // Add buttons with logs
  addWhitelistBtn?.addEventListener("click", async () => {
  const input = $("whitelistInput");
  const domain = input?.value.trim();
  if (!domain) return;

  console.log("Sending ADD_WHITELIST for:", domain);
  const res = await chrome.runtime.sendMessage({ type: "ADD_WHITELIST", domain });
  console.log("Response:", res);
  if (res.error) {
    alert(res.error);  // Π.χ. "Domain is already in blacklist!"
  }
  input.value = "";
  refreshLists();
});

  addBlacklistBtn?.addEventListener("click", async () => {
    const input = $("blacklistInput");
    const domain = input?.value.trim();
    if (!domain) return;

    console.log("Sending ADD_BLACKLIST for:", domain);
    const res = await chrome.runtime.sendMessage({ type: "ADD_BLACKLIST", domain });
    console.log("Response:", res);
  if (res.error) {
    alert(res.error);  // Π.χ. "Domain is already in blacklist!"
  }
  input.value = "";
  refreshLists();
});

  async function refreshLists() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      console.log("refreshLists data:", res);

      const wl = $("whitelistList");
      const bl = $("blacklistList");

      if (!wl || !bl) return;

      wl.innerHTML = "";
      bl.innerHTML = "";

      (res.whitelist || []).forEach(d => {
        const li = document.createElement("li");
        li.textContent = d;
        li.style.cursor = "pointer";
        li.title = "Click to remove";

        li.onclick = async () => {
          await chrome.runtime.sendMessage({ type: "REMOVE_WHITELIST", domain: d });
          refreshLists();
        };

        wl.appendChild(li);
      });

      (res.blacklist || []).forEach(d => {
        const li = document.createElement("li");
        li.textContent = d;
        li.style.cursor = "pointer";
        li.title = "Click to remove";

        li.onclick = async () => {
          await chrome.runtime.sendMessage({ type: "REMOVE_BLACKLIST", domain: d });
          refreshLists();
        };

        bl.appendChild(li);
      });
    } catch (e) {
      console.error("refreshLists error:", e);
    }
  }

  // Initial calls
  refresh();
  refreshLists();
});