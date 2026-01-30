// Popup Script for Axiom Trade Extension - Blood v3

document.addEventListener('DOMContentLoaded', async () => {
  await checkConnectionStatus();

  // Retry button
  document.getElementById('retry-btn')?.addEventListener('click', checkConnectionStatus);

  // Auto-open checkbox
  document.getElementById('auto-open-checkbox')?.addEventListener('change', handleAutoOpenToggle);

  // Save VPS address buttons (both connected and disconnected views)
  document.getElementById('save-vps-btn')?.addEventListener('click', () => saveVpsAddress('vps-address'));
  document.getElementById('save-vps-btn-disconnected')?.addEventListener('click', () => saveVpsAddress('vps-address-disconnected'));

  // Load VPS address for disconnected view immediately
  loadVpsAddress();
});

async function checkConnectionStatus() {
  showView('loading-view');

  try {
    const response = await sendMessage('checkHealth');

    if (response.success && response.data.healthy) {
      showConnectedView();
    } else {
      showView('disconnected-view');
    }
  } catch (error) {
    console.error('Connection check error:', error);
    showView('disconnected-view');
  }
}

async function handleAutoOpenToggle(e) {
  const enabled = e.target.checked;

  try {
    // Save to chrome.storage
    await chrome.storage.local.set({ 'axiom-auto-open-panel': enabled });
    console.log('Auto-open setting saved:', enabled);

    // If enabled and on axiom.trade page, show the panel immediately
    if (enabled) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url?.includes('axiom.trade')) {
        // Send message to content script to open panel
        chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Panel will auto-open on next page load');
          }
        });
      }
    }
  } catch (error) {
    console.error('Error saving auto-open setting:', error);
  }
}

async function loadAutoOpenState() {
  try {
    const result = await chrome.storage.local.get('axiom-auto-open-panel');
    const checkbox = document.getElementById('auto-open-checkbox');
    if (checkbox) {
      checkbox.checked = result['axiom-auto-open-panel'] || false;
    }
  } catch (error) {
    console.error('Error loading auto-open setting:', error);
  }
}

async function showConnectedView() {
  showView('connected-view');
  // Load the auto-open checkbox state
  await loadAutoOpenState();
  // Load VPS address
  await loadVpsAddress();
}

async function loadVpsAddress() {
  try {
    const result = await chrome.storage.local.get('blood-vps-address');
    const address = result['blood-vps-address'] || 'http://YOUR_VPS_IP:50100';

    // Load to both inputs (connected and disconnected views)
    const inputConnected = document.getElementById('vps-address');
    const inputDisconnected = document.getElementById('vps-address-disconnected');

    if (inputConnected) {
      inputConnected.value = address;
    }
    if (inputDisconnected) {
      inputDisconnected.value = address;
    }
  } catch (error) {
    console.error('Error loading VPS address:', error);
  }
}

async function saveVpsAddress(inputId = 'vps-address') {
  const input = document.getElementById(inputId);
  if (!input) return;

  const address = input.value.trim();
  if (!address) {
    console.error('VPS address cannot be empty');
    return;
  }

  try {
    await chrome.storage.local.set({ 'blood-vps-address': address });
    console.log('VPS address saved:', address);
    // Re-check connection with new address
    await checkConnectionStatus();
  } catch (error) {
    console.error('Error saving VPS address:', error);
  }
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(view => {
    view.style.display = 'none';
  });
  document.getElementById(viewId).style.display = 'block';
}

function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}
