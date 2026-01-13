document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const lastCleanEl = $("lastClean");
  const cookiesClearedEl = $("cookiesCleared");
  const statusEl = $("status");
  const premiumStatusEl = $("premiumStatus");  // New
  const upgradeBtn = $("upgradeBtn");  // New

  const cleanBtn = $("cleanNow");
  const smartBtn = $("smartProtection");
  const bulkBtn = $("bulkOptOut");

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
      if (!data || !data.state) return;

      if (lastCleanEl) lastCleanEl.textContent = formatDate(data.state.lastClean);
      if (cookiesClearedEl) cookiesClearedEl.textContent = data.state.cookiesCleared ?? 0;
      setStatus(!!data.state.active, !!data.state.isPremium);

      // Premium UI
      if (premiumStatusEl) {
        premiumStatusEl.textContent = data.state.isPremium ? "Premium Active" : "Free Version";
      }

      if (bulkBtn) {
        if (!data.state.isPremium) {
          bulkBtn.disabled = true;
          bulkBtn.title = "Premium Feature - Upgrade required";
        } else {
          bulkBtn.disabled = false;
          bulkBtn.title = "";
        }
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
      if (res.error) alert(`Action failed: ${res.error}`);
    } catch (e) {
      alert(`Action failed: ${e.message}`);
    }
    await refresh();
  }

  cleanBtn?.addEventListener("click", () => act("CLEAN_NOW"));
  smartBtn?.addEventListener("click", () => act("SMART_PROTECTION"));
  bulkBtn?.addEventListener("click", () => act("BULK_OPT_OUT"));
  upgradeBtn?.addEventListener("click", () => act("UPGRADE_PREMIUM"));  // New

  refresh();
});

function safeById(id) {
  return document.getElementById(id);
}

async function refreshLists() {
  const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });

  const wl = safeById("whitelistList");
  const bl = safeById("blacklistList");

  if (!wl || !bl) return;

  wl.innerHTML = "";
  bl.innerHTML = "";

  (res.whitelist || []).forEach(d => {
    const li = document.createElement("li");
    li.textContent = d;
    li.style.cursor = "pointer";
    li.title = "Click to remove";

    li.onclick = async () => {
      await chrome.runtime.sendMessage({
        type: "REMOVE_WHITELIST",
        domain: d
      });
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
      await chrome.runtime.sendMessage({
        type: "REMOVE_BLACKLIST",
        domain: d
      });
      refreshLists();
    };

    bl.appendChild(li);
  });
}

// ---- SAFE EVENT BINDINGS ----
const addWhitelistBtn = safeById("addWhitelist");
const addBlacklistBtn = safeById("addBlacklist");

if (addWhitelistBtn) {
  addWhitelistBtn.addEventListener("click", async () => {
    const input = safeById("whitelistInput");
    if (!input || !input.value.trim()) return;

    await chrome.runtime.sendMessage({
      type: "ADD_WHITELIST",
      domain: input.value.trim()
    });

    input.value = "";
    refreshLists();
  });
}

if (addBlacklistBtn) {
  addBlacklistBtn.addEventListener("click", async () => {
    const input = safeById("blacklistInput");
    if (!input || !input.value.trim()) return;

    await chrome.runtime.sendMessage({
      type: "ADD_BLACKLIST",
      domain: input.value.trim()
    });

    input.value = "";
    refreshLists();
  });
}

refreshLists();