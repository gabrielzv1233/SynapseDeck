const { streamDeckClient } = SDPIComponents;
const statusBox = document.getElementById("status");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const setupLink = document.getElementById("setup-link");
const deviceSelect = document.getElementById("device");
const profileSelect = document.getElementById("profile");
const retryButton = document.getElementById("retry");

let lastDeviceId;
let lastPhase;

function setStatus(status) {
  if (!status || typeof status !== "object") return;
  const phase = status.phase || "starting";
  statusBox.className = `status ${phase}`;
  statusTitle.textContent = {
    ready: "Connected to Razer Synapse",
    missing: "SynapseCTRL is required",
    "synapse-unavailable": "Synapse is not running or prepared",
    incompatible: "SynapseCTRL needs an update",
    error: "SynapseCTRL connection problem",
    stopped: "SynapseCTRL bridge stopped",
    starting: "Connecting to SynapseCTRL…",
  }[phase] || "SynapseDeck status";
  statusMessage.textContent = status.message || "";
  if (status.docsUrl) setupLink.href = status.docsUrl;

  const ready = Boolean(status.ready);
  deviceSelect.disabled = !ready;
  profileSelect.disabled = !ready || !deviceSelect.value;
  retryButton.disabled = phase === "starting";

  if (ready && lastPhase !== "ready") {
    Promise.resolve(deviceSelect.refresh?.()).catch(() => undefined);
    Promise.resolve(profileSelect.refresh?.()).catch(() => undefined);
  }
  lastPhase = phase;
}

async function initialize() {
  const settings = await streamDeckClient.getSettings();
  lastDeviceId = settings.deviceId;
  profileSelect.disabled = !lastDeviceId;
  await streamDeckClient.send("sendToPlugin", { event: "getStatus" });
}

streamDeckClient.sendToPropertyInspector.subscribe((message) => {
  const payload = message?.payload;
  if (!payload || typeof payload !== "object") return;
  if (payload.event === "status") setStatus(payload.status);
});

deviceSelect.addEventListener("valuechange", async () => {
  const deviceId = typeof deviceSelect.value === "string" ? deviceSelect.value : "";
  if (deviceId === lastDeviceId) return;
  lastDeviceId = deviceId;

  const settings = await streamDeckClient.getSettings();
  const next = { ...settings, deviceId };
  delete next.profileId;
  delete next.profileName;
  await streamDeckClient.setSettings(next);
  profileSelect.value = undefined;
  profileSelect.disabled = !deviceId || lastPhase !== "ready";
  await streamDeckClient.send("sendToPlugin", { event: "getProfiles", deviceId });
  await Promise.resolve(profileSelect.refresh?.());
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  await streamDeckClient.send("sendToPlugin", { event: "retryBridge" });
});

void initialize();
