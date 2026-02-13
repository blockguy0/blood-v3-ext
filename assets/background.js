// Background Service Worker for Axiom Trade Extension - Blood v3 API

const DEFAULT_VPS_ADDRESS = 'http://YOUR_VPS_IP:50100';
let API_BASE_URL = `${DEFAULT_VPS_ADDRESS}/api/v1`;

// Load API URL from storage
async function loadApiUrl() {
  try {
    const result = await chrome.storage.local.get('blood-vps-address');
    const vpsAddress = result['blood-vps-address'] || DEFAULT_VPS_ADDRESS;
    API_BASE_URL = `${vpsAddress}/api/v1`;
    console.log('[Blood Extension] API URL loaded:', API_BASE_URL);
  } catch (error) {
    console.error('[Blood Extension] Error loading API URL:', error);
  }
}

// Listen for storage changes to update API URL
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['blood-vps-address']) {
    const newAddress = changes['blood-vps-address'].newValue || DEFAULT_VPS_ADDRESS;
    API_BASE_URL = `${newAddress}/api/v1`;
    console.log('[Blood Extension] API URL updated:', API_BASE_URL);
  }
});

// Initialize API URL on startup
loadApiUrl();

// Storage helper functions
const storage = {
  async getItem(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  },

  async setItem(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  async removeItem(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
  }
};

// Simple API Request Handler (no auth needed for local Blood API)
async function makeApiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    // Handle non-JSON responses (e.g., "OK" text responses)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    // For non-JSON responses, return success indicator
    const text = await response.text();
    return { success: true, message: text };
  } catch (error) {
    console.error('[Blood Extension] API Error:', error);
    throw error;
  }
}

// Message Handlers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.action);

  if (message.action === 'checkHealth') {
    handleCheckHealth()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'checkAuth') {
    // For Blood v3, we just check if API is reachable
    handleCheckHealth()
      .then(result => sendResponse({ success: true, data: { authenticated: result.healthy } }))
      .catch(error => sendResponse({ success: false, data: { authenticated: false }, error: error.message }));
    return true;
  }

  if (message.action === 'getWallets') {
    handleGetWallets()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getPositions') {
    handleGetPositions(message.data?.status || 'active')
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'sellTokens') {
    handleSellTokens(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getWalletBalance') {
    handleGetWalletBalance(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'buyTokens') {
    handleBuyTokens(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getTokenFromPool') {
    handleGetTokenFromPool(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Tasks API handlers
  if (message.action === 'getTasks') {
    makeApiRequest('/tasks/')
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'startTask') {
    const endpoint = `/tasks/${message.data.task_id}`;
    console.log('[Background] Starting task, endpoint:', endpoint, 'task_id:', message.data.task_id);
    makeApiRequest(endpoint, { method: 'POST' })
      .then(result => {
        console.log('[Background] Start task result:', result);
        sendResponse({ success: true, data: result });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'stopTask') {
    const endpoint = `/tasks/${message.data.task_id}`;
    console.log('[Background] Stopping task, endpoint:', endpoint, 'task_id:', message.data.task_id);
    makeApiRequest(endpoint, { method: 'PUT' })
      .then(result => {
        console.log('[Background] Stop task result:', result);
        sendResponse({ success: true, data: result });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'deleteTask') {
    makeApiRequest(`/tasks/${message.data.task_id}`, { method: 'DELETE' })
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'startIdleTasks') {
    // No bulk start endpoint - must get all tasks and start idle ones individually
    (async () => {
      try {
        const tasksResult = await makeApiRequest('/tasks/');
        console.log('[Background] startIdleTasks - API response:', JSON.stringify(tasksResult, null, 2));
        const groups = tasksResult.groups || [];
        let startedCount = 0;

        for (const group of groups) {
          console.log('[Background] Group:', group.id, 'active:', group.meta?.active);
          // Check if group is idle (not active)
          if (!group.meta?.active) {
            try {
              console.log('[Background] Starting idle group:', group.id);
              const result = await makeApiRequest(`/tasks/${group.id}`, { method: 'POST' });
              console.log('[Background] Start result:', result);
              startedCount++;
            } catch (e) {
              console.error(`Failed to start task ${group.id}:`, e);
            }
          }
        }

        console.log('[Background] Total started:', startedCount);
        sendResponse({ success: true, data: { started: startedCount } });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'stopRunningTasks') {
    // No bulk stop endpoint - must get all tasks and stop running ones individually
    (async () => {
      try {
        const tasksResult = await makeApiRequest('/tasks/');
        const groups = tasksResult.groups || [];
        let stoppedCount = 0;

        for (const group of groups) {
          // Check if group is active (running)
          if (group.meta?.active) {
            try {
              await makeApiRequest(`/tasks/${group.id}`, { method: 'PUT' });
              stoppedCount++;
            } catch (e) {
              console.error(`Failed to stop task ${group.id}:`, e);
            }
          }
        }

        sendResponse({ success: true, data: { stopped: stoppedCount } });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // WL/BL API handlers
  if (message.action === 'getWlBlWallets') {
    makeApiRequest('/wlbl')
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'addWlBlWallet') {
    // Transform to API format: { wallets: [{ address, group_id, is_whitelisted, is_blacklisted }] }
    const { address, group_id, type } = message.data;
    const payload = {
      wallets: [{
        address: address,
        group_id: group_id,
        is_whitelisted: type === 'whitelist',
        is_blacklisted: type === 'blacklist'
      }]
    };
    makeApiRequest('/wlbl', { method: 'POST', body: JSON.stringify(payload) })
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getWlBlWalletsByGroup') {
    makeApiRequest(`/wlbl/${message.data.group_id}`)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'deleteWlBlWallet') {
    makeApiRequest(`/wlbl/${message.data.group_id}/${message.data.wallet_id}`, { method: 'DELETE' })
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'hidePosition') {
    makeApiRequest(`/positions/${message.data.position_id}/hide`, { method: 'POST' })
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'activatePosition') {
    makeApiRequest(`/positions/${message.data.position_id}/activate`, { method: 'POST' })
      .then(result => {
        console.log('[Background] Activate position result:', result);
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('[Background] Activate position error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.action === 'deletePosition') {
    makeApiRequest(`/positions/${message.data.position_id}/delete`, { method: 'POST' })
      .then(result => {
        console.log('[Background] Delete position result:', result);
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('[Background] Delete position error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// Health Check Handler
async function handleCheckHealth() {
  console.log('[Blood Extension] Checking health at:', `${API_BASE_URL}/health`);
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    console.log('[Blood Extension] Health response status:', response.status, response.ok);
    if (response.ok) {
      return { healthy: true };
    }
    return { healthy: false };
  } catch (error) {
    console.error('[Blood Extension] Health check failed:', error);
    return { healthy: false };
  }
}

// Get User Wallets - returns { groups: [...] } structure
async function handleGetWallets() {
  const response = await makeApiRequest('/wallets/');
  // API should return { groups: [...] }
  // Ensure we always return an object with groups array
  if (response && response.groups) {
    return response;
  }
  // Fallback if response is already an array or unexpected format
  if (Array.isArray(response)) {
    return { groups: response };
  }
  return { groups: [] };
}

// Get wallet balance for specific token (or native SOL if no tokenAddress)
async function handleGetWalletBalance({ walletId, tokenAddress }) {
  const endpoint = tokenAddress
    ? `/wallets/${walletId}/balance?token_address=${tokenAddress}`
    : `/wallets/${walletId}/balance`;
  console.log('[Background] Getting wallet balance:', endpoint);
  const response = await makeApiRequest(endpoint);
  console.log('[Background] Wallet balance response:', response);
  return response;
}

// Get All Positions and Aggregate by Token
async function handleGetPositions(status = 'active') {
  try {
    console.log(`[Blood Extension] Fetching positions from /positions/?status=${status}`);
    const response = await makeApiRequest(`/positions/?status=${status}`);

    // API returns { positions: [...] } structure
    const positions = response?.positions || response;

    console.log('[Blood Extension] Positions response:', {
      count: Array.isArray(positions) ? positions.length : 0
    });

    if (!positions || !Array.isArray(positions)) {
      console.error('[Blood Extension] Invalid positions response');
      return [];
    }

    // Aggregate positions by token address
    const aggregated = await aggregatePositionsByToken(positions);

    console.log('[Blood Extension] Aggregated positions:', aggregated.length);
    return aggregated;
  } catch (error) {
    console.error('[Blood Extension] Failed to get positions:', error);
    throw error;
  }
}

// Aggregate positions by token mint address
async function aggregatePositionsByToken(positions) {
  const tokenMap = new Map();

  for (const position of positions) {
    const mintAddress = position.shitcoin_info?.address;
    if (!mintAddress) continue;

    if (!tokenMap.has(mintAddress)) {
      tokenMap.set(mintAddress, {
        id: mintAddress, // Use mint address as unique ID
        mint_address: mintAddress,
        token_name: position.shitcoin_info?.metadata?.name || 'Unknown',
        token_symbol: position.shitcoin_info?.metadata?.symbol || '???',
        image_url: null,
        metadata_uri: position.shitcoin_info?.metadata?.uri || null,
        total_balance: 0,
        total_pnl: 0,
        total_pnl_sol: 0,
        total_pnl_usd: 0,
        total_spent_sol: 0,
        total_spent_usd: 0,
        wallets: []
      });
    }

    const token = tokenMap.get(mintAddress);
    const decimals = position.shitcoin_info?.decimals || 6;
    const rawBalance = parseFloat(position.shitcoin_left) || 0;
    const balance = rawBalance / Math.pow(10, decimals);

    const pnlPercent = parseFloat(position.pnl) || 0;
    // stable_spent is in lamports (1 SOL = 10^9 lamports)
    const stableDecimals = position.stablecoin_info?.decimals || 9;
    const spentSol = (parseFloat(position.stable_spent) || 0) / Math.pow(10, stableDecimals);
    const spentUsd = parseFloat(position.stable_spent_usd) || 0;
    const pnlSol = spentSol * (pnlPercent / 100);
    const pnlUsd = spentUsd * (pnlPercent / 100);

    token.total_balance += balance;
    token.total_pnl_sol += pnlSol;
    token.total_pnl_usd += pnlUsd;
    token.total_spent_sol += spentSol;
    token.total_spent_usd += spentUsd;

    token.wallets.push({
      walletId: position.wallet_id,
      walletName: position.wallet_name || `Wallet ${position.wallet_id}`,
      balance: balance,
      pnl: pnlPercent,
      pnl_sol: pnlSol,
      pnl_usd: pnlUsd,
      spent_sol: spentSol,
      positionId: position.id,
      selected: true // Select all by default
    });
  }

  // Convert map to array, calculate weighted avg PNL %, and sort
  const aggregated = Array.from(tokenMap.values())
    .map(token => {
      // Calculate weighted average PNL percentage
      token.total_pnl = token.total_spent_sol > 0
        ? (token.total_pnl_sol / token.total_spent_sol) * 100
        : 0;
      return token;
    })
    .sort((a, b) => b.total_balance - a.total_balance);

  // Fetch images from metadata URIs in parallel
  await Promise.all(
    aggregated.map(async (token) => {
      if (token.metadata_uri) {
        token.image_url = await fetchTokenImage(token.metadata_uri);
      }
    })
  );

  return aggregated;
}

// Get token address from pool address via GeckoTerminal
async function handleGetTokenFromPool({ poolAddress }) {
  const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}`);

  if (!response.ok) {
    throw new Error(`GeckoTerminal API error: ${response.status}`);
  }

  const data = await response.json();
  const tokenId = data?.data?.relationships?.base_token?.data?.id;

  if (tokenId && tokenId.startsWith('solana_')) {
    return {
      tokenAddress: tokenId.replace('solana_', ''),
      tokenName: data?.data?.attributes?.name || 'Unknown'
    };
  }

  throw new Error('Token not found in pool data');
}

// Buy Tokens
async function handleBuyTokens({ walletIds, mintAddress, amount }) {
  const results = [];
  const errors = [];

  console.log(`[Blood Extension] Buying ${amount} SOL of ${mintAddress} from wallets:`, walletIds);

  for (const walletId of walletIds) {
    try {
      // Execute trade
      const tradeResponse = await makeApiRequest('/trade/', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: walletId,
          input: mintAddress,
          amount: amount.toString(),
          direction: 'buy'
        })
      });

      results.push({
        walletId,
        success: true,
        response: tradeResponse
      });

    } catch (error) {
      console.error(`[Blood Extension] Failed to buy from wallet ${walletId}:`, error);
      errors.push({
        walletId,
        error: error.message
      });
    }
  }

  return {
    results,
    errors,
    success: errors.length === 0,
    message: errors.length > 0
      ? `Completed with ${errors.length} error(s)`
      : `Buy sent to ${results.length} wallet(s)`
  };
}

// Sell Tokens - uses percentage directly, Blood API handles the calculation
async function handleSellTokens({ walletIds, mintAddress, percentage }) {
  const results = [];
  const errors = [];

  console.log(`[Blood Extension] Selling ${percentage}% of ${mintAddress} from wallets:`, walletIds);

  for (const walletId of walletIds) {
    try {
      console.log(`[Blood Extension] Executing sell for wallet ${walletId}: ${percentage}%`);

      // Execute trade - send percentage as string, let Blood API handle it
      const tradeResponse = await makeApiRequest('/trade/', {
        method: 'POST',
        body: JSON.stringify({
          wallet_id: walletId,
          input: mintAddress,
          amount: `${percentage}%`,
          direction: 'sell'
        })
      });

      console.log(`[Blood Extension] Trade response for ${walletId}:`, tradeResponse);

      results.push({
        walletId,
        success: true,
        response: tradeResponse
      });

    } catch (error) {
      console.error(`[Blood Extension] Failed to sell from wallet ${walletId}:`, error);
      errors.push({
        walletId,
        error: error.message
      });
    }
  }

  return {
    results,
    errors,
    success: errors.length === 0,
    message: errors.length > 0
      ? `Completed with ${errors.length} error(s)`
      : `Sell sent to ${results.length} wallet(s)`
  };
}

// Fetch token image from metadata URI
async function fetchTokenImage(metadataUri) {
  if (!metadataUri) return null;
  try {
    const response = await fetch(metadataUri);
    if (!response.ok) return null;
    const metadata = await response.json();
    return metadata.image || null;
  } catch {
    return null;
  }
}

// Installation handler
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Blood Extension] Installed successfully');
});

// Badge update on tab change
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const tokenRegex = /axiom\.trade\/(token|trade|t)\/[a-zA-Z0-9]+/;
    if (tokenRegex.test(tab.url)) {
      chrome.action.setBadgeText({ text: '●', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
