// Content Script for Axiom Trade Extension - Blood v3

console.log('[Blood Extension] Content script loaded');

// Suppress chrome-extension://invalid/ errors (cosmetic errors from third-party content)
console.log('[Blood Extension] Installing error handlers...');

window.addEventListener('error', function(e) {
  console.log('[Blood Extension] Error caught:', e.message, e.filename);
  if (e.message && (e.message.includes('chrome-extension://invalid/') || e.filename && e.filename.includes('chrome-extension://invalid/'))) {
    console.log('[Blood Extension] Suppressing chrome-extension error');
    e.stopPropagation();
    e.preventDefault();
    return false;
  }
}, true);

// Suppress unhandled promise rejections for chrome-extension:// URLs
window.addEventListener('unhandledrejection', function(e) {
  console.log('[Blood Extension] Promise rejection caught:', e.reason);
  if (e.reason && e.reason.message && e.reason.message.includes('chrome-extension://')) {
    console.log('[Blood Extension] Suppressing chrome-extension rejection');
    e.stopPropagation();
    e.preventDefault();
    return false;
  }
}, true);

console.log('[Blood Extension] Error handlers installed');

let currentPanel = null;
let userWallets = [];
let tokenPositions = [];

// New state for position selector
let allPositions = [];
let hiddenPositions = [];
let showHiddenPositions = false;
let selectedPosition = null;

// All user wallets (for BUY - loaded from /wallets/ API)
let allWallets = [];
const SELECTED_POSITION_STORAGE_KEY = 'axiom-selected-position';

// Hidden wallets (stored locally)
const HIDDEN_WALLETS_STORAGE_KEY = 'axiom-hidden-wallets';
let hiddenWalletIds = [];
let showHiddenWallets = false;

// Current page token (detected from URL)
let currentPageToken = null;

// PNL display mode: 'sol' or 'usd'
const PNL_MODE_STORAGE_KEY = 'axiom-pnl-mode';
let pnlDisplayMode = 'sol';

// Customizable button values
const BUY_VALUES_STORAGE_KEY = 'axiom-buy-values';
const SELL_VALUES_STORAGE_KEY = 'axiom-sell-values';
const DEFAULT_BUY_VALUES = [0.1, 0.5, 1, 2];
const DEFAULT_SELL_VALUES = [10, 25, 50, 100];

function getSavedBuyValues() {
  try {
    const saved = localStorage.getItem(BUY_VALUES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === 4) {
        return parsed;
      }
    }
  } catch (e) {}
  return [...DEFAULT_BUY_VALUES];
}

function saveBuyValues(values) {
  localStorage.setItem(BUY_VALUES_STORAGE_KEY, JSON.stringify(values));
}

function getSavedSellValues() {
  try {
    const saved = localStorage.getItem(SELL_VALUES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === 4) {
        return parsed;
      }
    }
  } catch (e) {}
  return [...DEFAULT_SELL_VALUES];
}

function saveSellValues(values) {
  localStorage.setItem(SELL_VALUES_STORAGE_KEY, JSON.stringify(values));
}

function getSavedPnlMode() {
  return localStorage.getItem(PNL_MODE_STORAGE_KEY) || 'sol';
}

function savePnlMode(mode) {
  localStorage.setItem(PNL_MODE_STORAGE_KEY, mode);
  pnlDisplayMode = mode;
}

function getHiddenWalletIds() {
  try {
    const saved = localStorage.getItem(HIDDEN_WALLETS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
}

function saveHiddenWalletIds() {
  localStorage.setItem(HIDDEN_WALLETS_STORAGE_KEY, JSON.stringify(hiddenWalletIds));
}

function hideWallet(walletId) {
  if (!hiddenWalletIds.includes(walletId)) {
    hiddenWalletIds.push(walletId);
    saveHiddenWalletIds();
  }
}

function unhideWallet(walletId) {
  hiddenWalletIds = hiddenWalletIds.filter(id => id !== walletId);
  saveHiddenWalletIds();
}

function togglePnlMode() {
  const newMode = pnlDisplayMode === 'sol' ? 'usd' : 'sol';
  savePnlMode(newMode);
  updatePnlDisplay();
}

function formatPnlValue(position) {
  const pnlPercent = position.total_pnl || 0;
  const pnlSol = position.total_pnl_sol || 0;
  const pnlUsd = position.total_pnl_usd || 0;

  const percentStr = `${pnlPercent >= 0 ? '+' : ''}${formatNumber(pnlPercent)}%`;
  const valueStr = pnlDisplayMode === 'sol'
    ? `${pnlSol >= 0 ? '+' : ''}${formatNumber(pnlSol)} SOL`
    : `${pnlUsd >= 0 ? '+' : ''}$${formatNumber(pnlUsd)}`;

  return { percentStr, valueStr, isPositive: pnlPercent >= 0 };
}

function updatePnlDisplay() {
  if (!currentPanel) return;

  allPositions.forEach(position => {
    const item = currentPanel.querySelector(`.axiom-position-item[data-position-id="${position.id}"]`);
    if (item) {
      const pnlValueEl = item.querySelector('.axiom-pnl-value');
      if (pnlValueEl) {
        const pnlSol = position.total_pnl_sol || 0;
        const pnlUsd = position.total_pnl_usd || 0;
        pnlValueEl.textContent = pnlDisplayMode === 'sol'
          ? `${pnlSol >= 0 ? '+' : ''}${formatNumber(pnlSol)} SOL`
          : `${pnlUsd >= 0 ? '+' : ''}$${formatNumber(pnlUsd)}`;
      }
    }
  });
}

// Toggle edit mode for buy/sell buttons
function toggleEditMode(type) {
  const container = type === 'buy'
    ? currentPanel.querySelector('.axiom-buy-buttons')
    : currentPanel.querySelector('.axiom-sell-buttons');

  const buttons = container.querySelectorAll(type === 'buy' ? '.axiom-buy-btn' : '.axiom-sell-btn');
  const isEditing = buttons[0]?.classList.contains('editing');

  if (isEditing) {
    // Save and exit edit mode
    const newValues = [];
    buttons.forEach((btn, idx) => {
      const input = btn.querySelector('input');
      let newValue = parseFloat(input?.value) || (type === 'buy' ? DEFAULT_BUY_VALUES[idx] : DEFAULT_SELL_VALUES[idx]);

      if (type === 'sell' && newValue > 100) newValue = 100;
      if (newValue <= 0) newValue = type === 'buy' ? DEFAULT_BUY_VALUES[idx] : DEFAULT_SELL_VALUES[idx];

      newValues.push(newValue);
      btn.classList.remove('editing');

      if (type === 'buy') {
        btn.dataset.amount = newValue;
        btn.textContent = newValue;
      } else {
        btn.dataset.percent = newValue;
        btn.textContent = newValue + '%';
      }
    });

    if (type === 'buy') {
      saveBuyValues(newValues);
    } else {
      saveSellValues(newValues);
    }
  } else {
    // Enter edit mode
    buttons.forEach(btn => {
      btn.classList.add('editing');
      const currentValue = type === 'buy'
        ? btn.dataset.amount
        : btn.dataset.percent;

      btn.innerHTML = `<input type="number" class="axiom-edit-input" value="${currentValue}"
        step="${type === 'buy' ? '0.1' : '1'}"
        min="${type === 'buy' ? '0.01' : '1'}"
        max="${type === 'sell' ? '100' : '1000'}">`;

      const input = btn.querySelector('input');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          toggleEditMode(type);
        }
      });
    });

    // Focus first input
    const firstInput = buttons[0]?.querySelector('input');
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
  }
}

// Mode state constants
const MODE_STORAGE_KEY = 'axiom-selection-mode';
const AUTO_WALLET_COUNT_KEY = 'axiom-auto-wallet-count';
const DEFAULT_MODE = 'manual';
const DEFAULT_AUTO_WALLET_COUNT = 1;

// Panel minimized state constants
const PANEL_MINIMIZED_STORAGE_KEY = 'axiom-panel-minimized';
const DEFAULT_PANEL_MINIMIZED = false;

// Mode state variables
let currentMode = DEFAULT_MODE; // 'manual' or 'auto'
let autoWalletCount = DEFAULT_AUTO_WALLET_COUNT; // 1, 2, or 3
let isPanelMinimized = DEFAULT_PANEL_MINIMIZED; // false (normal) or true (minimized)

// Drag state
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let cachedPanelWidth = 0;
let cachedPanelHeight = 0;
let animationFrameId = null;
let panelPosition = null; // Will be loaded from localStorage or use defaults

// Auto-refresh interval
let autoRefreshInterval = null;
const AUTO_REFRESH_MS = 500; // 0.5 second

// Get address from URL (pool address for axiom, token address for gmgn)
function getAddressFromURL() {
  const url = window.location.href;

  // Axiom: /meme/xxx, /t/xxx, /token/xxx, /trade/xxx (returns pool address)
  const axiomMatch = url.match(/axiom\.trade\/(?:meme|t|token|trade)\/([a-zA-Z0-9]+)/);
  if (axiomMatch) {
    console.log('[Blood Extension] Axiom URL matched, address:', axiomMatch[1]);
    return { address: axiomMatch[1], site: 'axiom' };
  }

  // GMGN: /sol/token/xxx (returns token address directly)
  const gmgnMatch = url.match(/gmgn\.ai\/sol\/token\/([a-zA-Z0-9]+)/);
  if (gmgnMatch) {
    console.log('[Blood Extension] GMGN URL matched, address:', gmgnMatch[1]);
    return { address: gmgnMatch[1], site: 'gmgn' };
  }

  console.log('[Blood Extension] No URL pattern matched for:', url);
  return null;
}

// Legacy function for compatibility
function getPoolAddressFromURL() {
  const result = getAddressFromURL();
  return result?.address || null;
}

// Get token mint address from pool address (via GeckoTerminal API)
// Includes retry for new tokens that may not be indexed yet
async function getTokenAddressFromPool(poolAddress, retryCount = 0) {
  const MAX_RETRIES = 1;
  const RETRY_DELAY_MS = 1000;

  try {
    const response = await sendMessage('getTokenFromPool', { poolAddress });
    if (response.success && response.data?.tokenAddress) {
      return response.data.tokenAddress;
    }

    // Retry once after 1s for new tokens not yet indexed
    if (retryCount < MAX_RETRIES) {
      console.log(`[Blood Extension] Token not found, retrying in ${RETRY_DELAY_MS}ms... (attempt ${retryCount + 2})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return getTokenAddressFromPool(poolAddress, retryCount + 1);
    }

    return null;
  } catch (error) {
    console.error('[Blood Extension] Failed to get token from pool:', error);

    // Retry on error as well
    if (retryCount < MAX_RETRIES) {
      console.log(`[Blood Extension] Retrying after error in ${RETRY_DELAY_MS}ms... (attempt ${retryCount + 2})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return getTokenAddressFromPool(poolAddress, retryCount + 1);
    }

    return null;
  }
}

// Auto-select position based on current page URL
async function autoSelectPositionFromURL() {
  console.log('[Blood Extension] autoSelectPositionFromURL called, URL:', window.location.href);

  const urlInfo = getAddressFromURL();
  console.log('[Blood Extension] getAddressFromURL result:', urlInfo);

  if (!urlInfo) {
    console.log('[Blood Extension] No address in URL');
    return;
  }

  const { address, site } = urlInfo;
  console.log(`[Blood Extension] Detected address from URL (${site}):`, address);

  // Clear previous selection - will be set if matching position found
  selectedPosition = null;

  // For GMGN, the address is already the token address
  // For Axiom, it might be pool address or token address

  // First, check if address matches any mint_address directly
  let matchingPosition = allPositions.find(p =>
    p.mint_address?.toLowerCase() === address.toLowerCase()
  );

  if (matchingPosition) {
    console.log('[Blood Extension] Found matching position by mint address:', matchingPosition.token_symbol);
    selectedPosition = matchingPosition;
    saveSelectedPosition(matchingPosition);
    currentPageToken = matchingPosition.mint_address;
    return;
  }

  // For GMGN, address is already token address - no need to resolve
  if (site === 'gmgn') {
    console.log('[Blood Extension] GMGN token address, no position found');
    currentPageToken = address;
    return;
  }

  // For Axiom, try to resolve pool address to token address via GeckoTerminal
  console.log('[Blood Extension] Trying to resolve pool to token via GeckoTerminal...');
  const tokenAddress = await getTokenAddressFromPool(address);

  if (tokenAddress) {
    console.log('[Blood Extension] Resolved token address:', tokenAddress);
    currentPageToken = tokenAddress;

    matchingPosition = allPositions.find(p =>
      p.mint_address?.toLowerCase() === tokenAddress.toLowerCase()
    );

    if (matchingPosition) {
      console.log('[Blood Extension] Found matching position:', matchingPosition.token_symbol);
      selectedPosition = matchingPosition;
      saveSelectedPosition(matchingPosition);
    } else {
      console.log('[Blood Extension] No matching position for this token');
    }
  } else {
    console.log('[Blood Extension] Could not resolve pool to token');
    currentPageToken = null;
  }
}

// Load all user wallets from Blood API (for BUY operations)
async function loadAllWallets() {
  try {
    console.log('[Blood Extension] Loading all wallets...');
    const response = await sendMessage('getWallets', {});

    if (response.success && response.data?.groups) {
      allWallets = [];
      for (const group of response.data.groups) {
        for (const wallet of group.wallets || []) {
          // wallet.id already contains full name like "snipe1", "snipe2"
          allWallets.push({
            walletId: wallet.id,
            walletName: wallet.id,
            address: wallet.address,
            selected: true, // selected by default
            solBalance: null // will be loaded separately
          });
        }
      }
      console.log(`[Blood Extension] Loaded ${allWallets.length} wallets:`, allWallets.map(w => w.walletId));

      // Fetch SOL balances in parallel (don't await - load in background)
      loadWalletBalances();
    } else {
      console.warn('[Blood Extension] Failed to load wallets:', response.error);
      allWallets = [];
    }
  } catch (error) {
    console.error('[Blood Extension] Error loading wallets:', error);
    allWallets = [];
  }
}

async function loadWalletBalances() {
  try {
    console.log('[Blood Extension] Loading wallet balances for', allWallets.length, 'wallets');

    for (const wallet of allWallets) {
      console.log(`[Blood Extension] Fetching balance for ${wallet.walletId}...`);
      try {
        const response = await sendMessage('getWalletBalance', { walletId: wallet.walletId });
        console.log(`[Blood Extension] Balance response for ${wallet.walletId}:`, response);
        if (response.success && response.data?.amount) {
          const decimals = response.data.token_info?.decimals || 9;
          wallet.solBalance = parseFloat(response.data.amount) / Math.pow(10, decimals);
          console.log(`[Blood Extension] ${wallet.walletId} balance: ${wallet.solBalance} SOL`);
        }
      } catch (e) {
        console.error(`[Blood Extension] Failed to get balance for ${wallet.walletId}:`, e);
      }
    }

    console.log('[Blood Extension] Wallet balances loaded, wallets:', allWallets);

    // Update panel if it exists
    if (currentPanel) {
      updatePanelContent();
    }
  } catch (error) {
    console.error('[Blood Extension] Error loading wallet balances:', error);
  }
}

// Load all positions from Blood API
async function loadAllPositions() {
  try {
    console.log('[Blood Extension] Starting to load positions...');

    // Get ALL positions without filtering
    const positionsResponse = await sendMessage('getPositions', {});

    console.log('[Blood Extension] Positions response received:', {
      success: positionsResponse.success,
      hasData: !!positionsResponse.data,
      dataLength: positionsResponse.data?.length,
      error: positionsResponse.error
    });

    if (!positionsResponse.success) {
      const errorMsg = positionsResponse.error || 'Failed to load positions';
      console.error('[Blood Extension] Position loading failed:', errorMsg);
      throw new Error(errorMsg);
    }

    allPositions = positionsResponse.data || [];
    console.log(`[Blood Extension] Loaded ${allPositions.length} positions`);

    // Log position details for debugging
    if (allPositions.length > 0) {
      console.log('[Blood Extension] First position sample:', {
        id: allPositions[0].id,
        token_name: allPositions[0].token_name,
        token_symbol: allPositions[0].token_symbol,
        has_image: !!allPositions[0].image_url,
        image_url_type: typeof allPositions[0].image_url,
        image_url_value: allPositions[0].image_url
      });
    }

  } catch (error) {
    console.error('[Blood Extension] Load error:', error);
    console.error('[Blood Extension] Error stack:', error.stack);
    showNotification(`Failed to load positions: ${error.message}`, 'error');
    allPositions = [];
  }
}

// Start auto-refresh
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  autoRefreshInterval = setInterval(async () => {
    if (!currentPanel) {
      stopAutoRefresh();
      return;
    }

    try {
      const oldPositionIds = new Set(allPositions.map(p => p.id));
      const oldBalances = new Map(allPositions.map(p => [p.id, p.total_balance]));
      await loadAllPositions();
      const newPositionIds = new Set(allPositions.map(p => p.id));

      // Check if positions changed (added, removed, or balance changed significantly)
      const idsChanged = oldPositionIds.size !== newPositionIds.size ||
        [...oldPositionIds].some(id => !newPositionIds.has(id)) ||
        [...newPositionIds].some(id => !oldPositionIds.has(id));

      const balancesChanged = allPositions.some(p => {
        const oldBal = oldBalances.get(p.id) || 0;
        const newBal = p.total_balance || 0;
        // Detect significant balance change (sold all or bought new)
        return (oldBal > 0 && newBal === 0) || (oldBal === 0 && newBal > 0);
      });

      refreshSelectedPosition();

      if (idsChanged || balancesChanged) {
        // Full panel update when positions added/removed/balance zeroed
        updatePanelContent();
      } else {
        // Only update stats when positions unchanged
        updatePanelStats();
      }
    } catch (error) {
      console.error('[Blood Extension] Auto-refresh error:', error);
    }
  }, AUTO_REFRESH_MS);

  console.log('[Blood Extension] Auto-refresh started (1s interval)');
}

// Stop auto-refresh
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log('[Blood Extension] Auto-refresh stopped');
  }
}

// Update only stats without full panel rebuild
function updatePanelStats() {
  if (!currentPanel) return;

  // Update position list item balances and PNL
  allPositions.forEach(position => {
    const item = currentPanel.querySelector(`.axiom-position-item[data-position-id="${position.id}"]`);
    if (item) {
      const balanceEl = item.querySelector('.axiom-position-balance');
      if (balanceEl) {
        balanceEl.textContent = formatNumber(position.total_balance || 0);
      }

      // Update PNL
      const pnlContainer = item.querySelector('.axiom-position-pnl-container');
      if (pnlContainer) {
        const pnl = position.total_pnl || 0;
        const pnlSol = position.total_pnl_sol || 0;
        const pnlUsd = position.total_pnl_usd || 0;

        pnlContainer.className = `axiom-position-pnl-container ${pnl >= 0 ? 'positive' : 'negative'}`;

        const percentEl = pnlContainer.querySelector('.axiom-pnl-percent');
        if (percentEl) {
          percentEl.textContent = `${pnl >= 0 ? '+' : ''}${formatNumber(pnl)}%`;
        }

        const valueEl = pnlContainer.querySelector('.axiom-pnl-value');
        if (valueEl) {
          valueEl.textContent = pnlDisplayMode === 'sol'
            ? `${pnlSol >= 0 ? '+' : ''}${formatNumber(pnlSol)} SOL`
            : `${pnlUsd >= 0 ? '+' : ''}$${formatNumber(pnlUsd)}`;
        }
      }
    }
  });

  // Update wallet stats using allWallets
  const selectedWalletsList = allWallets.filter(w => w.selected);

  // Calculate total balance from position wallets
  let totalBalance = 0;
  if (selectedPosition?.wallets) {
    const selectedIds = new Set(selectedWalletsList.map(w => w.walletId));
    totalBalance = selectedPosition.wallets
      .filter(w => selectedIds.has(w.walletId))
      .reduce((sum, w) => sum + (parseFloat(w.balance) || 0), 0);
  }

  const walletCountEl = document.getElementById('wallet-count');
  if (walletCountEl) walletCountEl.textContent = selectedWalletsList.length;

  const totalHoldingsEl = document.getElementById('total-holdings');
  if (totalHoldingsEl) totalHoldingsEl.textContent = formatNumber(totalBalance);

  // Update wallet list balances
  const positionWalletMap = new Map();
  if (selectedPosition?.wallets) {
    for (const w of selectedPosition.wallets) {
      positionWalletMap.set(w.walletId, w);
    }
  }

  allWallets.forEach(wallet => {
    const walletItem = currentPanel.querySelector(`.axiom-wallet-item[data-wallet-id="${wallet.walletId}"]`);
    if (walletItem) {
      // Update SOL balance
      const solEl = walletItem.querySelector('.axiom-wallet-sol');
      if (solEl) {
        solEl.textContent = wallet.solBalance !== null && wallet.solBalance !== undefined
          ? `${formatNumber(wallet.solBalance)} SOL`
          : '-';
      }

      // Update token balance
      const tokenEl = walletItem.querySelector('.axiom-wallet-token');
      const positionWallet = positionWalletMap.get(wallet.walletId);
      const tokenBalance = positionWallet?.balance || 0;

      if (tokenBalance > 0) {
        if (tokenEl) {
          tokenEl.textContent = `${formatNumber(tokenBalance)} ${selectedPosition?.token_symbol || ''}`;
        } else {
          // Create token element if it doesn't exist
          const balancesEl = walletItem.querySelector('.axiom-wallet-balances');
          if (balancesEl) {
            const newTokenEl = document.createElement('span');
            newTokenEl.className = 'axiom-wallet-token';
            newTokenEl.textContent = `${formatNumber(tokenBalance)} ${selectedPosition?.token_symbol || ''}`;
            balancesEl.appendChild(newTokenEl);
          }
        }
      } else if (tokenEl) {
        tokenEl.remove();
      }
    }
  });
}

// Panel HTML Generator - unified single view
function generatePanelHTML() {
  // Calculate selected wallets count and holdings from allWallets
  const selectedWalletsList = allWallets.filter(w => w.selected);
  // For holdings, we need to get balance from position wallets if available
  const totalBalance = selectedPosition?.wallets?.filter(w => w.selected)?.reduce((sum, w) => sum + (parseFloat(w.balance) || 0), 0) || 0;

  return `
    <div id="axiom-sell-panel" class="axiom-panel">
      <div class="axiom-panel__header">
        <div class="axiom-panel__title">
          <img src="${chrome.runtime.getURL('assets/logo_new.png')}" class="axiom-panel__logo" alt="Blood" />
          <span>Blood Extension</span>
        </div>
        <div class="axiom-panel__header-buttons">
          <div class="axiom-panel__view-toggle" id="axiom-view-toggle">
            <span class="axiom-view-option ${!showHiddenPositions ? 'active' : ''}" data-view="active">Active</span>
            <span class="axiom-view-option ${showHiddenPositions ? 'active' : ''}" data-view="hidden">Hidden</span>
          </div>
          <button class="axiom-panel__tools" id="axiom-tools-btn" title="Tasks & WL/BL">⚙</button>
          <button class="axiom-panel__minimize" id="axiom-minimize-btn">−</button>
          <button class="axiom-panel__close" id="axiom-close-btn">×</button>
        </div>
      </div>

      <div class="axiom-panel__content">

        <!-- Position List -->
        ${(() => {
          const positions = showHiddenPositions ? hiddenPositions : allPositions;
          const emptyText = showHiddenPositions ? 'No hidden positions' : 'No active positions';

          if (positions.length === 0) {
            return `<div class="axiom-empty-positions"><p class="axiom-empty-text">${emptyText}</p></div>`;
          }

          return `<div class="axiom-position-list">
            ${positions.map(position => `
              <div class="axiom-position-item ${selectedPosition?.id === position.id ? 'active' : ''}"
                   data-position-id="${position.id}" data-hidden="${showHiddenPositions}">
                ${isValidImageUrl(position.image_url) ? `
                  <img src="${position.image_url}" class="axiom-position-icon" alt="${position.token_symbol || 'Token'}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                  <div class="axiom-position-icon-placeholder" style="display:none;">
                    ${position.token_symbol?.slice(0, 2) || '??'}
                  </div>
                ` : `
                  <div class="axiom-position-icon-placeholder">
                    ${position.token_symbol?.slice(0, 2) || '??'}
                  </div>
                `}
                <div class="axiom-position-info">
                  <div class="axiom-position-name">${position.token_symbol || 'Unknown'}</div>
                  <div class="axiom-position-meta">
                    <span class="axiom-position-balance">${formatNumber(position.total_balance || 0)}</span>
                    <span class="axiom-position-wallets">${position.wallets?.length || 0}w</span>
                  </div>
                </div>
                <div class="axiom-position-pnl-container ${(position.total_pnl || 0) >= 0 ? 'positive' : 'negative'}">
                  <span class="axiom-pnl-percent">${(position.total_pnl || 0) >= 0 ? '+' : ''}${formatNumber(position.total_pnl || 0)}%</span>
                  <span class="axiom-pnl-value axiom-pnl-toggle">${pnlDisplayMode === 'sol'
                    ? `${(position.total_pnl_sol || 0) >= 0 ? '+' : ''}${formatNumber(position.total_pnl_sol || 0)} SOL`
                    : `${(position.total_pnl_usd || 0) >= 0 ? '+' : ''}$${formatNumber(position.total_pnl_usd || 0)}`}</span>
                </div>
                <button class="axiom-position-action" title="${showHiddenPositions ? 'Activate position' : 'Hide position'}">${showHiddenPositions ? '↩' : '×'}</button>
                ${showHiddenPositions ? '<button class="axiom-position-delete" title="Delete position">−</button>' : ''}
              </div>
            `).join('')}
          </div>`;
        })()}

        <!-- Token Address -->
        ${selectedPosition || currentPageToken ? `
          <div class="axiom-panel__section axiom-panel__section--address">
            <div class="axiom-panel__address">
              <span class="axiom-address-full">${selectedPosition?.mint_address || currentPageToken}</span>
            </div>
          </div>
        ` : ''}

        <!-- Holdings Summary -->
        <div class="axiom-panel__stats">
          <div class="axiom-stat">
            <span class="axiom-stat-label">Selected Wallets</span>
            <span class="axiom-stat-value" id="wallet-count">${selectedWalletsList.length}</span>
          </div>
          <div class="axiom-stat">
            <span class="axiom-stat-label">Total Holdings</span>
            <span class="axiom-stat-value" id="total-holdings">${formatNumber(totalBalance)}</span>
          </div>
        </div>

        <!-- Mode Buttons -->
        <div class="axiom-mode-buttons">
          <button class="axiom-mode-btn active" id="axiom-manual-btn">Manual</button>
          <button class="axiom-mode-btn" id="axiom-auto-btn">Auto</button>
        </div>

        <!-- Wallet Selection (shared for BUY and SELL) -->
        <div class="axiom-panel__section" id="wallets-section">
          <div class="axiom-wallets-header">
            <div class="axiom-panel__buttons wallet-select-buttons">
              <button class="axiom-wallet-select-btn" id="axiom-select-all-btn">Select All</button>
              <button class="axiom-wallet-select-btn" id="axiom-unselect-all-btn">Unselect All</button>
            </div>
            <div class="axiom-wallet-view-toggle" id="axiom-wallet-view-toggle">
              <span class="axiom-view-option ${!showHiddenWallets ? 'active' : ''}" data-view="active">Active</span>
              <span class="axiom-view-option ${showHiddenWallets ? 'active' : ''}" data-view="hidden">Hidden</span>
            </div>
          </div>
          <div class="axiom-wallet-list" id="wallet-list">
            ${generateUnifiedWalletList()}
          </div>
        </div>

        <!-- Quick Buy Buttons -->
        <div class="axiom-panel__section">
          <label>BUY (SOL) <span class="axiom-edit-btn" id="axiom-edit-values-btn" title="Edit values">⚙</span></label>
          <div class="axiom-panel__buttons axiom-buy-buttons">
            ${getSavedBuyValues().map((val, idx) => `
              <button class="axiom-buy-btn" data-amount="${val}" data-index="${idx}">${val}</button>
            `).join('')}
          </div>
        </div>

        <!-- Quick Sell Buttons -->
        <div class="axiom-panel__section">
          <label>SELL</label>
          <div class="axiom-panel__buttons axiom-sell-buttons">
            ${getSavedSellValues().map((val, idx) => `
              <button class="axiom-sell-btn" data-percent="${val}" data-index="${idx}">${val}%</button>
            `).join('')}
          </div>
        </div>

        <!-- Status -->
        <div id="axiom-status" class="axiom-status" style="display: none;"></div>
      </div>

      <!-- Tools Slide Panel -->
      <div class="axiom-tools-panel" id="axiom-tools-panel">
        <div class="axiom-tools-panel__tabs">
          <button class="tab active" data-tab="tasks">Tasks</button>
          <button class="tab" data-tab="wlbl">WL/BL</button>
        </div>
        <div class="axiom-tools-panel__content">
          <div class="tab-content active" id="tools-tasks-tab">
            ${generateTasksContent()}
          </div>
          <div class="tab-content" id="tools-wlbl-tab">
            ${generateWlBlContent()}
          </div>
        </div>
      </div>
    </div>
  `;
}

// Generate unified wallet list (used for both BUY and SELL)
function generateUnifiedWalletList() {
  // Filter wallets based on showHiddenWallets toggle
  const visibleWallets = allWallets.filter(w => {
    const isHidden = hiddenWalletIds.includes(w.walletId);
    return showHiddenWallets ? isHidden : !isHidden;
  });

  if (visibleWallets.length === 0) {
    const emptyText = showHiddenWallets ? 'No hidden wallets' : 'No wallets available';
    return `<div class="axiom-wallet-empty">${emptyText}</div>`;
  }

  // Get balance info from selected position if available
  const positionWalletMap = new Map();
  if (selectedPosition?.wallets) {
    for (const w of selectedPosition.wallets) {
      positionWalletMap.set(w.walletId, w);
    }
  }

  return visibleWallets.map(wallet => {
    // Get token balance from position if we have it
    const positionWallet = positionWalletMap.get(wallet.walletId);
    const tokenBalance = positionWallet?.balance || 0;
    const tokenSymbol = selectedPosition?.token_symbol || '';
    const isHidden = hiddenWalletIds.includes(wallet.walletId);

    // Format balance display: show both SOL and token balance
    const solDisplay = wallet.solBalance !== null && wallet.solBalance !== undefined
      ? `${formatNumber(wallet.solBalance)} SOL`
      : '-';
    const tokenDisplay = tokenBalance > 0
      ? `${formatNumber(tokenBalance)} ${tokenSymbol}`
      : '';

    return `
      <div class="axiom-wallet-item ${wallet.selected ? 'active' : ''}" data-wallet-id="${wallet.walletId}" data-hidden="${isHidden}">
        <div class="axiom-wallet-info">
          <div class="axiom-wallet-name">${wallet.walletName || `Wallet ${wallet.walletId}`}</div>
          <div class="axiom-wallet-balances">
            <span class="axiom-wallet-sol">${solDisplay}</span>
            ${tokenDisplay ? `<span class="axiom-wallet-token">${tokenDisplay}</span>` : ''}
          </div>
        </div>
        <button class="axiom-wallet-action" title="${isHidden ? 'Unhide wallet' : 'Hide wallet'}">${isHidden ? '↩' : '×'}</button>
      </div>
    `;
  }).join('');
}

// Generate wallet list for selected position (legacy - kept for compatibility)
function generateWalletListForPosition(position) {
  if (!position.wallets || position.wallets.length === 0) {
    return '<div class="axiom-wallet-empty">No wallets with this token</div>';
  }

  // Initialize selected state for wallets
  position.wallets.forEach(w => {
    if (w.selected === undefined) {
      w.selected = true; // Select all by default
    }
  });

  return position.wallets.map(wallet => `
    <div class="axiom-wallet-item ${wallet.selected ? 'active' : ''}" data-wallet-id="${wallet.walletId}">
      <div class="axiom-wallet-info">
        <div class="axiom-wallet-name">${wallet.walletName || `Wallet ${wallet.walletId}`}</div>
        <div class="axiom-wallet-balance">${formatNumber(wallet.balance || 0)} ${position.token_symbol || ''}</div>
      </div>
    </div>
  `).join('');
}

// Position selection function
function selectPosition(positionId) {
  selectedPosition = allPositions.find(p => p.id === positionId);

  if (selectedPosition) {
    console.log('[Blood Extension] Selected position:', selectedPosition.token_symbol);
    saveSelectedPosition(selectedPosition);
    updatePanelContent();
  } else {
    console.error('[Blood Extension] Position not found for ID:', positionId);
  }
}

async function hidePosition(position) {
  if (!position || !position.wallets || position.wallets.length === 0) {
    showNotification('No position to hide', 'error');
    return;
  }

  const positionIds = position.wallets.map(w => w.positionId).filter(Boolean);
  if (positionIds.length === 0) {
    showNotification('No position IDs found', 'error');
    return;
  }

  try {
    // Hide all positions for this token (one per wallet)
    const hidePromises = positionIds.map(id =>
      sendMessage('hidePosition', { position_id: id })
    );
    const results = await Promise.all(hidePromises);

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      showNotification(`Failed to hide ${failed.length}/${positionIds.length} positions`, 'error');
    } else {
      showNotification(`Hidden ${position.token_symbol}`, 'success');
    }

    // Remove from local state and update UI
    allPositions = allPositions.filter(p => p.id !== position.id);
    if (selectedPosition?.id === position.id) {
      selectedPosition = null;
      localStorage.removeItem(SELECTED_POSITION_STORAGE_KEY);
    }
    updatePanelContent();
  } catch (error) {
    console.error('[Blood Extension] Failed to hide position:', error);
    showNotification('Failed to hide position', 'error');
  }
}

async function activatePosition(position) {
  if (!position || !position.wallets || position.wallets.length === 0) {
    showNotification('No position to activate', 'error');
    return;
  }

  const positionIds = position.wallets.map(w => w.positionId).filter(Boolean);
  if (positionIds.length === 0) {
    showNotification('No position IDs found', 'error');
    return;
  }

  try {
    const activatePromises = positionIds.map(id =>
      sendMessage('activatePosition', { position_id: id })
    );
    const results = await Promise.all(activatePromises);

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      showNotification(`Failed to activate ${failed.length}/${positionIds.length} positions`, 'error');
    } else {
      showNotification(`Activated ${position.token_symbol}`, 'success');
    }

    // Move from hidden to active
    hiddenPositions = hiddenPositions.filter(p => p.id !== position.id);
    allPositions.push(position);
    updatePanelContent();
  } catch (error) {
    console.error('[Blood Extension] Failed to activate position:', error);
    showNotification('Failed to activate position', 'error');
  }
}

async function deletePosition(position) {
  if (!position || !position.wallets || position.wallets.length === 0) {
    showNotification('No position to delete', 'error');
    return;
  }

  const positionIds = position.wallets.map(w => w.positionId).filter(Boolean);
  if (positionIds.length === 0) {
    showNotification('No position IDs found', 'error');
    return;
  }

  try {
    const deletePromises = positionIds.map(id =>
      sendMessage('deletePosition', { position_id: id })
    );
    const results = await Promise.all(deletePromises);

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      showNotification(`Failed to delete ${failed.length}/${positionIds.length} positions`, 'error');
    } else {
      showNotification(`Deleted ${position.token_symbol}`, 'success');
    }

    // Remove from hidden positions
    hiddenPositions = hiddenPositions.filter(p => p.id !== position.id);
    updatePanelContent();
  } catch (error) {
    console.error('[Blood Extension] Failed to delete position:', error);
    showNotification('Failed to delete position', 'error');
  }
}

async function loadHiddenPositions() {
  try {
    const response = await sendMessage('getPositions', { status: 'hidden' });
    if (response.success) {
      hiddenPositions = response.data || [];
    }
  } catch (error) {
    console.error('[Blood Extension] Failed to load hidden positions:', error);
  }
}

function updatePanelContent() {
  if (currentPanel) {
    // Save current position before replacing
    const currentRect = currentPanel.getBoundingClientRect();
    const hadCustomPosition = currentPanel.style.left !== '';

    // Save tools panel state before replacing
    const toolsPanelWasOpen = currentPanel.querySelector('#axiom-tools-panel')?.classList.contains('open') || false;

    const newPanel = document.createElement('div');
    newPanel.innerHTML = generatePanelHTML();
    currentPanel.replaceWith(newPanel.firstElementChild);
    currentPanel = document.getElementById('axiom-sell-panel');

    // Restore position if it was customized
    if (hadCustomPosition) {
      currentPanel.style.left = currentRect.left + 'px';
      currentPanel.style.top = currentRect.top + 'px';
      currentPanel.style.right = 'auto';
    } else {
      applyPanelPosition();
    }

    // Restore tools panel state
    if (toolsPanelWasOpen) {
      const toolsPanel = document.getElementById('axiom-tools-panel');
      const toolsBtn = document.getElementById('axiom-tools-btn');
      if (toolsPanel) toolsPanel.classList.add('open');
      if (toolsBtn) toolsBtn.classList.add('active');
    }

    attachEventListeners();

    // Re-apply AUTO mode selection if active
    if (currentMode === 'auto') {
      applyAutoSelection();
    }
  }
}

function copyAddress(address) {
  navigator.clipboard.writeText(address);
  showNotification('Address copied!', 'success');
}

// Expose reload function to window for the Reload button
window.axiomReloadPositions = async () => {
  showNotification('Reloading positions...', 'info');
  await loadAllPositions();
  refreshSelectedPosition();
  updatePanelContent();
};

function formatNumber(num, minDecimals = 2) {
  const value = parseFloat(num);
  if (value === 0) return '0';

  const absValue = Math.abs(value);

  // For very small values, show more decimals
  let decimals = minDecimals;
  if (absValue > 0 && absValue < 0.01) {
    decimals = 4;
  }
  if (absValue > 0 && absValue < 0.0001) {
    decimals = 6;
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

// Helper to validate image URLs
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url === 'null' || url === 'undefined' || url === '') return false;
  // Check if it's a valid URL format
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Drag-and-Drop Functions
function loadPanelPosition() {
  const saved = localStorage.getItem('axiom-panel-position');
  if (saved) {
    try {
      panelPosition = JSON.parse(saved);
    } catch (e) {
      panelPosition = null;
    }
  }
}

function loadSavedPosition() {
  const saved = localStorage.getItem(SELECTED_POSITION_STORAGE_KEY);
  if (!saved) return null;

  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

function refreshSelectedPosition() {
  let restored = false;

  const savedSelection = loadSavedPosition();
  if (savedSelection) {
    const match = findPositionFromSaved(savedSelection);
    if (match) {
      selectedPosition = match;
      restored = true;
    }
  }

  if (!restored && selectedPosition) {
    const fallbackMatch = findPositionFromSaved({
      id: selectedPosition.id,
      mint: selectedPosition.mint_address
    });
    if (fallbackMatch) {
      selectedPosition = fallbackMatch;
      restored = true;
    }
  }

  if (!restored && allPositions.length > 0) {
    selectedPosition = allPositions[0];
  }

  // Clear selectedPosition if it no longer exists in allPositions
  if (!restored && allPositions.length === 0) {
    selectedPosition = null;
    localStorage.removeItem(SELECTED_POSITION_STORAGE_KEY);
  }
}

function saveSelectedPosition(position) {
  if (!position) {
    localStorage.removeItem(SELECTED_POSITION_STORAGE_KEY);
    return;
  }

  const payload = {
    id: position.id,
    mint: position.mint_address?.toLowerCase() || null
  };

  localStorage.setItem(SELECTED_POSITION_STORAGE_KEY, JSON.stringify(payload));
}

function findPositionFromSaved(saved) {
  if (!saved) return null;

  // Match by ID first
  if (saved.id) {
    const match = allPositions.find(p => p.id === saved.id);
    if (match) return match;
  }

  // Match by mint address
  if (saved.mint) {
    const savedMint = saved.mint.toLowerCase();
    return allPositions.find(p => p.mint_address?.toLowerCase() === savedMint) || null;
  }

  return null;
}

function savePanelPosition(x, y) {
  panelPosition = { x, y };
  localStorage.setItem('axiom-panel-position', JSON.stringify(panelPosition));
}

function applyPanelPosition() {
  if (!currentPanel) return;

  if (panelPosition) {
    // Use saved position
    currentPanel.style.left = panelPosition.x + 'px';
    currentPanel.style.top = panelPosition.y + 'px';
    currentPanel.style.right = 'auto';
  }
  // If no saved position, CSS defaults will apply (top: 100px, right: 20px)
}

// Mode state persistence functions
function getSavedMode() {
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'auto' ? 'auto' : 'manual';
}

function saveMode(mode) {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  currentMode = mode;
}

function getSavedAutoWalletCount() {
  const stored = localStorage.getItem(AUTO_WALLET_COUNT_KEY);
  const count = parseInt(stored, 10);
  return [1, 2, 3].includes(count) ? count : DEFAULT_AUTO_WALLET_COUNT;
}

function saveAutoWalletCount(count) {
  const sanitized = [1, 2, 3].includes(count) ? count : DEFAULT_AUTO_WALLET_COUNT;
  localStorage.setItem(AUTO_WALLET_COUNT_KEY, sanitized.toString());
  autoWalletCount = sanitized;
  return sanitized;
}

function getSavedPanelMinimized() {
  const stored = localStorage.getItem(PANEL_MINIMIZED_STORAGE_KEY);
  return stored === 'true';
}

function savePanelMinimized(minimized) {
  localStorage.setItem(PANEL_MINIMIZED_STORAGE_KEY, minimized.toString());
  isPanelMinimized = minimized;
}

function toggleMinimize() {
  const panel = document.getElementById('axiom-sell-panel');
  if (!panel) return;

  isPanelMinimized = !isPanelMinimized;
  savePanelMinimized(isPanelMinimized);

  if (isPanelMinimized) {
    panel.classList.add('axiom-panel--minimized');
  } else {
    panel.classList.remove('axiom-panel--minimized');
  }
}

function startDrag(e) {
  // Don't drag if minimized or clicking on buttons
  if (isPanelMinimized ||
      e.target.closest('.axiom-panel__close') ||
      e.target.closest('button') ||
      e.target.closest('input')) {
    return;
  }

  isDragging = true;
  currentPanel.classList.add('dragging');

  // Calculate offset from mouse to panel's current position
  const rect = currentPanel.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;

  // Cache panel dimensions to avoid reflow during drag
  cachedPanelWidth = rect.width;
  cachedPanelHeight = rect.height;

  // Add global listeners
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);

  e.preventDefault();
}

function drag(e) {
  if (!isDragging) return;

  // Cancel any pending animation frame to avoid stacking
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  animationFrameId = requestAnimationFrame(() => {
    // Calculate new position
    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    // Constrain to viewport bounds using cached dimensions (keep at least 50px visible)
    const minVisible = 50;
    newX = Math.max(-cachedPanelWidth + minVisible, Math.min(newX, window.innerWidth - minVisible));
    newY = Math.max(0, Math.min(newY, window.innerHeight - minVisible));

    // Apply position using transform for GPU acceleration
    currentPanel.style.transform = `translate(${newX}px, ${newY}px)`;
    currentPanel.style.left = '0';
    currentPanel.style.top = '0';
    currentPanel.style.right = 'auto';
  });
}

function stopDrag(e) {
  if (!isDragging) return;

  // Cancel any pending animation frame
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  isDragging = false;
  currentPanel.classList.remove('dragging');

  // Save position (getBoundingClientRect gives final position with transform applied)
  const rect = currentPanel.getBoundingClientRect();
  savePanelPosition(rect.left, rect.top);

  // Remove global listeners
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', stopDrag);
}

// Panel Injection
async function injectPanel() {
  try {
    // Remove existing panel
    if (currentPanel) {
      stopAutoRefresh();
      currentPanel.remove();
      currentPanel = null;
    }

    // Check if Blood API is available
    const healthCheck = await sendMessage('checkAuth');
    if (!healthCheck.success || !healthCheck.data.authenticated) {
      showNotification('Blood API not available. Make sure Blood is running on your VPS', 'error');
      return;
    }

    // Load ALL wallets and positions from Blood API (in parallel)
    await Promise.all([loadAllWallets(), loadAllPositions()]);

    // Reset selected position
    selectedPosition = null;

    // Try to auto-select position based on URL
    await autoSelectPositionFromURL();

    // Load saved position
    loadPanelPosition();

    console.log('[Blood Extension] Generating panel HTML...');
    // Create panel
    const panelContainer = document.createElement('div');
    const htmlContent = generatePanelHTML();
    console.log('[Blood Extension] HTML generated, length:', htmlContent.length);

    console.log('[Blood Extension] Setting innerHTML...');
    panelContainer.innerHTML = htmlContent;
    console.log('[Blood Extension] Appending to body...');
    document.body.appendChild(panelContainer.firstElementChild);
    currentPanel = document.getElementById('axiom-sell-panel');
    console.log('[Blood Extension] Panel element found:', !!currentPanel);

    // Apply saved position if available
    applyPanelPosition();

    refreshSelectedPosition();

    // Attach event listeners
    attachEventListeners();

    // Initialize minimized state
    isPanelMinimized = getSavedPanelMinimized();
    if (isPanelMinimized && currentPanel) {
      currentPanel.classList.add('axiom-panel--minimized');
    }

    // Start auto-refresh
    startAutoRefresh();

    console.log('[Blood Extension] Panel injected successfully');
  } catch (error) {
    console.error('[Blood Extension] Error injecting panel:', error);
    showNotification('Failed to load panel: ' + error.message, 'error');
  }
}

// Helper function to get selected wallets from detail view
function getSelectedWallets() {
  if (!selectedPosition) return [];
  return selectedPosition.wallets?.filter(w => w.selected) || [];
}

// Event Listeners
function attachEventListeners() {
  // Drag functionality and click handling on header
  const header = currentPanel.querySelector('.axiom-panel__header');
  if (header) {
    // Drag functionality
    header.addEventListener('mousedown', startDrag);

    // Click to restore when minimized
    header.addEventListener('click', (e) => {
      // Only restore if minimized and not clicking buttons
      if (isPanelMinimized &&
          !e.target.closest('.axiom-panel__minimize') &&
          !e.target.closest('.axiom-panel__close')) {
        toggleMinimize();
      }
    });
  }

  // Close button
  document.getElementById('axiom-close-btn')?.addEventListener('click', () => {
    if (currentPanel) {
      stopAutoRefresh();
      currentPanel.remove();
      currentPanel = null;
      selectedPosition = null;
    }
  });

  // Minimize button
  document.getElementById('axiom-minimize-btn')?.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent header click event
    toggleMinimize();
  });

  // View toggle (Active/Hidden)
  document.getElementById('axiom-view-toggle')?.addEventListener('click', async (e) => {
    const option = e.target.closest('.axiom-view-option');
    if (!option) return;
    const view = option.getAttribute('data-view');
    showHiddenPositions = view === 'hidden';
    if (showHiddenPositions && hiddenPositions.length === 0) {
      await loadHiddenPositions();
    }
    updatePanelContent();
  });

  // Position item clicks - navigate to token page and remember selection
  const positionList = currentPanel.querySelector('.axiom-position-list');
  if (positionList) {
    positionList.addEventListener('click', async (e) => {
      // Ignore clicks on PNL toggle (SOL/USD switch)
      if (e.target.classList.contains('axiom-pnl-toggle')) {
        return;
      }

      // Handle hide/activate button click
      if (e.target.classList.contains('axiom-position-action')) {
        e.stopPropagation();
        const positionItem = e.target.closest('.axiom-position-item');
        if (positionItem) {
          const positionId = positionItem.getAttribute('data-position-id');
          const isHidden = positionItem.getAttribute('data-hidden') === 'true';
          const positions = isHidden ? hiddenPositions : allPositions;
          const position = positions.find(p => p.id === positionId);
          if (position) {
            if (isHidden) {
              await activatePosition(position);
            } else {
              await hidePosition(position);
            }
          }
        }
        return;
      }

      // Handle delete button click (only for hidden positions)
      if (e.target.classList.contains('axiom-position-delete')) {
        e.stopPropagation();
        const positionItem = e.target.closest('.axiom-position-item');
        if (positionItem) {
          const positionId = positionItem.getAttribute('data-position-id');
          const position = hiddenPositions.find(p => p.id === positionId);
          if (position) {
            await deletePosition(position);
          }
        }
        return;
      }

      // Find the clicked position item (even if user clicked on child element)
      const positionItem = e.target.closest('.axiom-position-item');
      if (positionItem) {
        const positionId = positionItem.getAttribute('data-position-id');
        if (positionId) {
          // Find position and navigate to token page
          const positions = showHiddenPositions ? hiddenPositions : allPositions;
          const position = positions.find(p => p.id === positionId);
          if (position && position.mint_address) {
            console.log('[Blood Extension] Navigating to:', position.token_symbol);
            selectedPosition = position;
            saveSelectedPosition(position);
            window.location.href = `https://axiom.trade/t/${position.mint_address}`;
          }
        }
      }
    });
  }

  // Quick buy buttons
  document.querySelectorAll('.axiom-buy-btn[data-amount]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (btn.classList.contains('editing')) return;
      const amount = parseFloat(e.currentTarget.dataset.amount);
      await executeBuy(amount);
    });
  });

  // Quick sell buttons (in detail view)
  document.querySelectorAll('.axiom-sell-btn[data-percent]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (btn.classList.contains('editing')) return;
      const percentage = parseFloat(e.currentTarget.dataset.percent);
      await executeSell(percentage);
    });
  });

  // Edit button (gear icon) - edits both buy and sell
  document.getElementById('axiom-edit-values-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEditMode('buy');
    toggleEditMode('sell');
  });

  // Wallet view toggle (Active/Hidden)
  document.getElementById('axiom-wallet-view-toggle')?.addEventListener('click', (e) => {
    const option = e.target.closest('.axiom-view-option');
    if (!option) return;
    const view = option.getAttribute('data-view');
    showHiddenWallets = view === 'hidden';
    updatePanelContent();
  });

  // Wallet selection toggles - works with allWallets
  const walletList = currentPanel.querySelector('.axiom-wallet-list');
  if (walletList) {
    walletList.addEventListener('click', (e) => {
      // Handle hide/unhide action button
      if (e.target.classList.contains('axiom-wallet-action')) {
        e.stopPropagation();
        const walletItem = e.target.closest('.axiom-wallet-item');
        if (!walletItem) return;
        const walletId = walletItem.getAttribute('data-wallet-id');
        const isHidden = walletItem.getAttribute('data-hidden') === 'true';
        if (isHidden) {
          unhideWallet(walletId);
          showNotification('Wallet unhidden', 'success');
        } else {
          hideWallet(walletId);
          showNotification('Wallet hidden', 'success');
        }
        updatePanelContent();
        return;
      }

      // Prevent manual selection in AUTO mode
      if (currentMode === 'auto') {
        showNotification('Switch to Manual mode to select wallets manually', 'info');
        return;
      }

      const walletItem = e.target.closest('.axiom-wallet-item');
      if (!walletItem) return;

      const walletId = walletItem.getAttribute('data-wallet-id');
      const wallet = allWallets.find(w => String(w.walletId) === walletId);

      if (wallet) {
        wallet.selected = !wallet.selected;
        walletItem.classList.toggle('active', wallet.selected);
        updateStats();
      }
    });
  }

  // Select All / Unselect All buttons - work with allWallets
  document.getElementById('axiom-select-all-btn')?.addEventListener('click', () => {
    if (currentMode === 'auto') {
      showNotification('Switch to Manual mode to select wallets manually', 'info');
      return;
    }

    allWallets.forEach(wallet => {
      wallet.selected = true;
    });

    // Update UI
    document.querySelectorAll('.axiom-wallet-item').forEach(item => {
      item.classList.add('active');
    });

    updateStats();
  });

  document.getElementById('axiom-unselect-all-btn')?.addEventListener('click', () => {
    if (currentMode === 'auto') {
      showNotification('Switch to Manual mode to select wallets manually', 'info');
      return;
    }

    allWallets.forEach(wallet => {
      wallet.selected = false;
    });

    // Update UI
    document.querySelectorAll('.axiom-wallet-item').forEach(item => {
      item.classList.remove('active');
    });

    updateStats();
  });

  // Mode button click handlers
  document.getElementById('axiom-manual-btn')?.addEventListener('click', () => {
    if (currentMode === 'manual') return; // Already in manual mode

    currentMode = 'manual';
    saveMode('manual');

    // Update button states
    document.getElementById('axiom-manual-btn')?.classList.add('active');
    document.getElementById('axiom-auto-btn')?.classList.remove('active');

    // Update AUTO button text to remove count
    const autoBtn = document.getElementById('axiom-auto-btn');
    if (autoBtn) autoBtn.textContent = 'Auto';

    console.log('[Mode] Switched to MANUAL mode');
  });

  document.getElementById('axiom-auto-btn')?.addEventListener('click', () => {
    if (currentMode === 'auto') {
      // Cycle through wallet counts: 1 → 2 → 3 → 1
      autoWalletCount = autoWalletCount >= 3 ? 1 : autoWalletCount + 1;
      saveAutoWalletCount(autoWalletCount);

      console.log(`[Mode] AUTO mode - selecting top ${autoWalletCount} wallet(s)`);
    } else {
      // Switch from manual to auto
      currentMode = 'auto';
      saveMode('auto');

      // Update button states
      document.getElementById('axiom-manual-btn')?.classList.remove('active');
      document.getElementById('axiom-auto-btn')?.classList.add('active');

      console.log('[Mode] Switched to AUTO mode');
    }

    // Update AUTO button text to show count
    const autoBtn = document.getElementById('axiom-auto-btn');
    if (autoBtn) autoBtn.textContent = `Auto (${autoWalletCount})`;

    // Apply auto-selection
    applyAutoSelection();
  });

  // Initialize mode buttons with saved values
  currentMode = getSavedMode();
  autoWalletCount = getSavedAutoWalletCount();

  if (currentMode === 'auto') {
    document.getElementById('axiom-manual-btn')?.classList.remove('active');
    document.getElementById('axiom-auto-btn')?.classList.add('active');

    // Update AUTO button text
    const autoBtn = document.getElementById('axiom-auto-btn');
    if (autoBtn) autoBtn.textContent = `Auto (${autoWalletCount})`;

    // Apply auto-selection
    applyAutoSelection();
  } else {
    document.getElementById('axiom-manual-btn')?.classList.add('active');
    document.getElementById('axiom-auto-btn')?.classList.remove('active');
  }

  // Ensure stats reflect initial checkbox state when panel loads
  updateStats();

  // PNL toggle (SOL/USD) - click on any PNL value to toggle
  currentPanel.addEventListener('click', (e) => {
    if (e.target.classList.contains('axiom-pnl-toggle')) {
      e.stopPropagation();
      togglePnlMode();
    }
  });

  // Initialize PNL display mode
  pnlDisplayMode = getSavedPnlMode();

  // Initialize hidden wallet IDs
  hiddenWalletIds = getHiddenWalletIds();

  // Tools panel toggle
  const toolsBtn = document.getElementById('axiom-tools-btn');
  const toolsPanel = document.getElementById('axiom-tools-panel');
  if (toolsBtn && toolsPanel) {
    toolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toolsPanel.classList.toggle('open');
      toolsBtn.classList.toggle('active');
      if (toolsPanel.classList.contains('open')) {
        loadToolsPanelData();
      }
    });

    // Tab switching within tools panel
    toolsPanel.querySelectorAll('.axiom-tools-panel__tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update active tab button
        toolsPanel.querySelectorAll('.axiom-tools-panel__tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update active content
        toolsPanel.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        toolsPanel.querySelector(`#tools-${tabName}-tab`)?.classList.add('active');
      });
    });
  }
}

// Auto-select top N wallets by balance (using allWallets)
function applyAutoSelection() {
  if (allWallets.length === 0 || currentMode !== 'auto') return;

  // Build a map of wallet balances from position (if available)
  const balanceMap = new Map();
  if (selectedPosition?.wallets) {
    for (const w of selectedPosition.wallets) {
      balanceMap.set(w.walletId, parseFloat(w.balance) || 0);
    }
  }

  // Sort allWallets by balance (descending) - wallets without position balance go last
  const sortedWallets = [...allWallets]
    .sort((a, b) => {
      const balanceA = balanceMap.get(a.walletId) || 0;
      const balanceB = balanceMap.get(b.walletId) || 0;
      return balanceB - balanceA;
    });

  // Deselect all wallets first
  allWallets.forEach(wallet => {
    wallet.selected = false;
  });

  // Select top N wallets
  for (let i = 0; i < Math.min(autoWalletCount, sortedWallets.length); i++) {
    const walletToSelect = sortedWallets[i];
    const originalWallet = allWallets.find(w => w.walletId === walletToSelect.walletId);
    if (originalWallet) {
      originalWallet.selected = true;
    }
  }

  // Update UI
  document.querySelectorAll('.axiom-wallet-item').forEach(item => {
    const walletId = item.getAttribute('data-wallet-id');
    const wallet = allWallets.find(w => String(w.walletId) === walletId);
    if (wallet) {
      item.classList.toggle('active', wallet.selected);
    }
  });

  updateStats();
}

function updateStats() {
  // Get selected wallets from allWallets
  const selectedWalletsList = allWallets.filter(w => w.selected);

  // Calculate total balance from position wallets (only for selected wallets)
  let totalBalance = 0;
  if (selectedPosition?.wallets) {
    const selectedIds = new Set(selectedWalletsList.map(w => w.walletId));
    totalBalance = selectedPosition.wallets
      .filter(w => selectedIds.has(w.walletId))
      .reduce((sum, w) => sum + (parseFloat(w.balance) || 0), 0);
  }

  const walletCountEl = document.getElementById('wallet-count');
  if (walletCountEl) {
    walletCountEl.textContent = selectedWalletsList.length;
  }

  const totalHoldingsEl = document.getElementById('total-holdings');
  if (totalHoldingsEl) totalHoldingsEl.textContent = formatNumber(totalBalance);
}

// Sell Execution - uses allWallets but only those that have a position
async function executeSell(percentage) {
  if (!selectedPosition) {
    showNotification('No position selected', 'error');
    return;
  }

  // Get selected wallets from allWallets
  const selectedWalletsList = allWallets.filter(w => w.selected);

  if (selectedWalletsList.length === 0) {
    showNotification('Select at least one wallet', 'error');
    return;
  }

  // Filter to only wallets that have a position in this token
  const positionWalletIds = new Set(selectedPosition.wallets?.map(w => w.walletId) || []);
  const walletsWithPosition = selectedWalletsList.filter(w => positionWalletIds.has(w.walletId));

  if (walletsWithPosition.length === 0) {
    showNotification('Selected wallets have no holdings in this token', 'error');
    return;
  }

  const walletIds = walletsWithPosition.map(w => w.walletId);

  showStatus(`Sending sell order...`, 'loading');

  try {
    const response = await sendMessage('sellTokens', {
      walletIds,
      mintAddress: selectedPosition.mint_address,
      percentage
    });

    if (response.success) {
      const data = response.data;
      if (data.success) {
        showStatus(`✓ ${data.message}`, 'success');
        // Wait for blockchain to process, then reload
        await new Promise(resolve => setTimeout(resolve, 2000));
        await loadAllPositions();

        // Explicitly update selectedPosition with fresh data
        if (selectedPosition) {
          const updatedPosition = allPositions.find(p => p.mint_address === selectedPosition.mint_address);
          if (updatedPosition) {
            selectedPosition = updatedPosition;
          } else {
            // Position was sold completely - clear selection
            selectedPosition = null;
            localStorage.removeItem(SELECTED_POSITION_STORAGE_KEY);
          }
        }

        updatePanelContent();
      } else {
        showStatus(`⚠ ${data.message}`, 'error');
      }
    } else {
      showStatus(`Error: ${response.error}`, 'error');
    }
  } catch (error) {
    showStatus(`Failed: ${error.message}`, 'error');
  }
}

// Buy Execution - uses allWallets (all user wallets from /wallets/ API)
async function executeBuy(amount) {
  // Get token address - prefer currentPageToken (what user is viewing), fallback to selectedPosition
  const mintAddress = currentPageToken || selectedPosition?.mint_address;

  if (!mintAddress) {
    showNotification('No token detected. Navigate to a token page on Axiom.', 'error');
    return;
  }

  // Use allWallets (loaded from /wallets/ API) for BUY
  const selectedWalletsList = allWallets.filter(w => w.selected);

  if (selectedWalletsList.length === 0) {
    showNotification('Select at least one wallet', 'error');
    return;
  }

  const walletIds = selectedWalletsList.map(w => w.walletId);

  showStatus(`Sending buy order...`, 'loading');

  try {
    const response = await sendMessage('buyTokens', {
      walletIds,
      mintAddress,
      amount
    });

    if (response.success) {
      const data = response.data;
      if (data.success) {
        showStatus(`✓ ${data.message}`, 'success');
        // Wait for blockchain to process, then reload
        await new Promise(resolve => setTimeout(resolve, 2000));
        await loadAllPositions();

        // After buy, select the position for the token we just bought
        if (mintAddress) {
          const boughtPosition = allPositions.find(p => p.mint_address === mintAddress);
          if (boughtPosition) {
            selectedPosition = boughtPosition;
            saveSelectedPosition(boughtPosition);
          }
        }

        updatePanelContent();
      } else {
        showStatus(`⚠ ${data.message}`, 'error');
      }
    } else {
      showStatus(`Error: ${response.error}`, 'error');
    }
  } catch (error) {
    showStatus(`Failed: ${error.message}`, 'error');
  }
}

// Status Display
function showStatus(message, type) {
  const statusEl = document.getElementById('axiom-status');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = `axiom-status axiom-status--${type}`;
  statusEl.style.display = 'block';

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);
  }
}

// Notification System
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `axiom-notification axiom-notification--${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Message Helper
function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      showNotification('Extension was updated. Please reload the page (F5).', 'error');
      reject(new Error('Extension context invalidated - please reload page'));
      return;
    }

    try {
      chrome.runtime.sendMessage({ action, data }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '';
          if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
            showNotification('Extension was updated. Please reload the page (F5).', 'error');
          }
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      showNotification('Extension was updated. Please reload the page (F5).', 'error');
      reject(error);
    }
  });
}

// =====================================================
// TOOLS PANEL - Tasks & WL/BL Wallets Data
// =====================================================

let toolsPanelTasks = {};
let toolsPanelWlBl = [];
let toolsPanelGroups = [];

// Generate Tasks Tab Content
function generateTasksContent() {
  if (!toolsPanelTasks || Object.keys(toolsPanelTasks).length === 0) {
    return '<div class="tasks-empty">No tasks available</div>';
  }

  let html = `
    <div class="tasks-buttons-row">
      <button class="start-all-idle-btn">Start All</button>
      <button class="stop-all-running-btn">Stop All</button>
    </div>
  `;

  for (const [category, tasks] of Object.entries(toolsPanelTasks)) {
    if (!Array.isArray(tasks) || tasks.length === 0) continue;

    const groupStatus = tasks[0]?.status || 'idle';

    html += `
      <div class="task-group" data-group-id="${category}">
        <div class="task-group__header">
          ${category}
          <span class="task-status ${groupStatus}"></span>
        </div>
        ${tasks.map(task => `
          <div class="task-item" data-task-id="${task.id}" data-group-id="${task.group_id || category}">
            <span class="task-status ${task.status || 'idle'}"></span>
            <span class="task-name">${task.name || task.id}</span>
            <div class="task-actions">
              <button class="task-btn start-btn" title="Start">▶</button>
              <button class="task-btn stop-btn" title="Stop">■</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  return html;
}

// Generate WL/BL Tab Content
function generateWlBlContent() {
  const groupOptions = toolsPanelGroups.map(g =>
    `<option value="${g.id}">`
  ).join('');

  let html = `
    <div class="wlbl-add">
      <input type="text" placeholder="Wallet address" id="wlbl-wallet-input" />
      <input type="text" placeholder="Group name" id="wlbl-group-input" list="wlbl-groups-list" />
      <datalist id="wlbl-groups-list">
        ${groupOptions}
      </datalist>
      <div class="wlbl-add__buttons">
        <button class="wl-btn">+WL</button>
        <button class="bl-btn">+BL</button>
      </div>
    </div>
  `;

  if (!toolsPanelWlBl || toolsPanelWlBl.length === 0) {
    html += '<div class="wlbl-empty">No wallets in WL/BL</div>';
    return html;
  }

  const grouped = {};
  for (const wallet of toolsPanelWlBl) {
    const groupId = wallet.group_id || 'default';
    if (!grouped[groupId]) grouped[groupId] = [];
    grouped[groupId].push(wallet);
  }

  for (const [groupId, wallets] of Object.entries(grouped)) {
    const groupName = toolsPanelGroups.find(g => g.id === groupId)?.name || groupId;
    html += `
      <div class="wlbl-group" data-group-id="${groupId}">
        <div class="wlbl-group__header">${groupName}</div>
        <div class="wlbl-list">
          ${wallets.map(wallet => {
            const isWl = wallet.is_whitelisted === true;
            return `
            <div class="wlbl-item" data-wallet-id="${wallet.address}" data-group-id="${groupId}">
              <span class="wlbl-type ${isWl ? 'wl' : 'bl'}">${isWl ? 'WL' : 'BL'}</span>
              <span class="wallet-address" title="${wallet.address}">${shortenAddress(wallet.address)}</span>
              <button class="delete-btn" title="Delete">✕</button>
            </div>
          `}).join('')}
        </div>
      </div>
    `;
  }

  return html;
}

// Shorten wallet address for display
function shortenAddress(address) {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Load data for tools panel
async function loadToolsPanelData() {
  try {
    // Load tasks
    const tasksResponse = await sendMessage('getTasks', {});
    if (tasksResponse.success && tasksResponse.data?.groups) {
      toolsPanelTasks = {};
      for (const group of tasksResponse.data.groups) {
        const groupStatus = group.meta?.active ? 'running' : 'idle';
        toolsPanelTasks[group.id] = (group.tasks || []).map(task => ({
          ...task,
          status: groupStatus,
          name: task.name || task.id || `Task ${task.id}`
        }));
      }
    } else if (tasksResponse.success) {
      toolsPanelTasks = tasksResponse.data || {};
    }

    // Load WL/BL wallets
    const wlblResponse = await sendMessage('getWlBlWallets', {});
    if (wlblResponse.success) {
      toolsPanelWlBl = wlblResponse.data?.wallets || wlblResponse.data || [];
      const uniqueGroups = [...new Set(toolsPanelWlBl.map(w => w.group_id).filter(Boolean))];
      toolsPanelGroups = uniqueGroups.map(id => ({ id, name: id }));
    }

    // Update panel content
    updateToolsPanelContent();
  } catch (error) {
    console.error('[Blood Extension] Failed to load tools panel data:', error);
    showNotification('Failed to load panel data', 'error');
  }
}

// Update tools panel content (attached to main panel)
function updateToolsPanelContent() {
  const toolsPanel = document.getElementById('axiom-tools-panel');
  if (!toolsPanel) return;

  const tasksTab = toolsPanel.querySelector('#tools-tasks-tab');
  const wlblTab = toolsPanel.querySelector('#tools-wlbl-tab');

  if (tasksTab) tasksTab.innerHTML = generateTasksContent();
  if (wlblTab) wlblTab.innerHTML = generateWlBlContent();

  // Attach event listeners for tools panel content
  attachToolsPanelContentListeners();
}

// Attach event listeners for tools panel content (tasks/wlbl)
function attachToolsPanelContentListeners() {
  const toolsPanel = document.getElementById('axiom-tools-panel');
  if (!toolsPanel) return;

  // Start All Idle Tasks button
  const startAllBtn = toolsPanel.querySelector('.start-all-idle-btn');
  if (startAllBtn) {
    startAllBtn.onclick = async () => {
      try {
        showNotification('Starting all idle tasks...', 'info');
        const response = await sendMessage('startIdleTasks', {});
        if (response.success) {
          showNotification('Idle tasks started', 'success');
          await loadToolsPanelData();
        } else {
          showNotification(`Failed: ${response.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    };
  }

  // Stop All Running Tasks button
  const stopAllBtn = toolsPanel.querySelector('.stop-all-running-btn');
  if (stopAllBtn) {
    stopAllBtn.onclick = async () => {
      try {
        showNotification('Stopping all running tasks...', 'info');
        const response = await sendMessage('stopRunningTasks', {});
        if (response.success) {
          showNotification('Running tasks stopped', 'success');
          await loadToolsPanelData();
        } else {
          showNotification(`Failed: ${response.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    };
  }

  // Task start buttons (API uses group_id)
  toolsPanel.querySelectorAll('.task-btn.start-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const taskItem = btn.closest('.task-item');
      const groupId = taskItem?.dataset.groupId;
      console.log('[Blood Extension] Starting task group:', groupId);
      if (!groupId) return;

      try {
        const response = await sendMessage('startTask', { task_id: groupId });
        console.log('[Blood Extension] Start response:', response);
        if (response.success) {
          showNotification(`Task group started`, 'success');
          await loadToolsPanelData();
        } else {
          showNotification(`Failed: ${response.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    };
  });

  // Task stop buttons
  toolsPanel.querySelectorAll('.task-btn.stop-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const taskItem = btn.closest('.task-item');
      const groupId = taskItem?.dataset.groupId;
      console.log('[Blood Extension] Stopping task group:', groupId);
      if (!groupId) return;

      try {
        const response = await sendMessage('stopTask', { task_id: groupId });
        if (response.success) {
          showNotification(`Task stopped`, 'success');
          await loadToolsPanelData();
        } else {
          showNotification(`Failed: ${response.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    };
  });

  // WL/BL Add buttons
  const wlBtn = toolsPanel.querySelector('.wlbl-add .wl-btn');
  const blBtn = toolsPanel.querySelector('.wlbl-add .bl-btn');
  if (wlBtn) wlBtn.onclick = () => addWlBlWalletFromTools('whitelist');
  if (blBtn) blBtn.onclick = () => addWlBlWalletFromTools('blacklist');

  // WL/BL Delete buttons
  toolsPanel.querySelectorAll('.wlbl-item .delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const wlblItem = btn.closest('.wlbl-item');
      const walletId = wlblItem?.dataset.walletId;
      const groupId = wlblItem?.dataset.groupId;
      if (!walletId || !groupId) return;

      try {
        const response = await sendMessage('deleteWlBlWallet', { group_id: groupId, wallet_id: walletId });
        if (response.success) {
          showNotification('Wallet removed', 'success');
          await loadToolsPanelData();
        } else {
          showNotification(`Failed: ${response.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    };
  });
}

// Add wallet to WL/BL from tools panel
async function addWlBlWalletFromTools(type) {
  const toolsPanel = document.getElementById('axiom-tools-panel');
  if (!toolsPanel) return;

  const addressInput = toolsPanel.querySelector('#wlbl-wallet-input');
  const groupInput = toolsPanel.querySelector('#wlbl-group-input');

  const address = addressInput?.value?.trim();
  const groupId = groupInput?.value?.trim();

  if (!address) {
    showNotification('Enter a wallet address', 'error');
    return;
  }

  if (!groupId) {
    showNotification('Enter a group name', 'error');
    return;
  }

  try {
    const response = await sendMessage('addWlBlWallet', {
      address: address,
      group_id: groupId,
      type: type
    });

    if (response.success) {
      showNotification(`Wallet added to ${type === 'whitelist' ? 'WL' : 'BL'}`, 'success');
      addressInput.value = '';
      await loadToolsPanelData();
    } else {
      showNotification(`Failed: ${response.error}`, 'error');
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Check if we're on a supported site (axiom.trade or gmgn.ai)
function isSupportedSite() {
  const hostname = window.location.hostname;
  return hostname.includes('axiom.trade') || hostname.includes('gmgn.ai');
}

// Legacy alias
function isAxiomTrade() {
  return isSupportedSite();
}

// Check if we're on a token page
function isTokenPage() {
  const url = window.location.href;
  // Axiom: /meme/xxx, /t/xxx, /token/xxx, /trade/xxx
  if (/axiom\.trade\/(?:meme|t|token|trade)\/[a-zA-Z0-9]+/.test(url)) {
    console.log('[Blood Extension] isTokenPage: true (axiom)');
    return true;
  }
  // GMGN: /sol/token/xxx
  if (/gmgn\.ai\/sol\/token\/[a-zA-Z0-9]+/.test(url)) {
    console.log('[Blood Extension] isTokenPage: true (gmgn)');
    return true;
  }
  console.log('[Blood Extension] isTokenPage: false, url:', url);
  return false;
}

// Track last known URL for polling
let lastKnownUrl = window.location.href;
let urlPollingInterval = null;

// Handle URL changes for SPA navigation
async function handleUrlChange() {
  const currentUrl = window.location.href;

  // Skip if URL hasn't actually changed
  if (currentUrl === lastKnownUrl) {
    return;
  }

  console.log('[Blood Extension] URL changed:', lastKnownUrl, '->', currentUrl);
  lastKnownUrl = currentUrl;

  // If we're not on a token page, hide the panel
  if (!isTokenPage()) {
    if (currentPanel) {
      console.log('[Blood Extension] Left token page, closing panel');
      stopAutoRefresh();
      currentPanel.remove();
      currentPanel = null;
    }
    currentPageToken = null;
    return;
  }

  // We're on a token page
  const urlInfo = getAddressFromURL();
  console.log('[Blood Extension] Token page detected:', urlInfo);

  if (currentPanel) {
    // Panel is open - update the selection
    await autoSelectPositionFromURL();
    updatePanelContent();
  } else {
    // Panel is closed but we're on token page - check auto-open
    checkAutoOpen();
  }
}

// Start polling for URL changes (most reliable for SPAs)
function startUrlPolling() {
  if (urlPollingInterval) return;

  urlPollingInterval = setInterval(() => {
    if (window.location.href !== lastKnownUrl) {
      handleUrlChange();
    }
  }, 300); // Check every 300ms

  console.log('[Blood Extension] URL polling started');
}

// Set up SPA navigation listeners
function setupNavigationListeners() {
  // Start URL polling (most reliable method)
  startUrlPolling();

  // Also listen to popstate for immediate response to back/forward
  window.addEventListener('popstate', handleUrlChange);

  // Intercept History API as backup
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    handleUrlChange();
  };

  console.log('[Blood Extension] SPA navigation listeners installed');
}

// Initialize - inject panel when user clicks extension icon
// Note: The panel now shows ALL positions, not tied to specific token pages
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Blood Extension] Received message:', request.action);

    if (request.action === 'togglePanel') {
      if (currentPanel) {
        stopAutoRefresh();
        currentPanel.remove();
        currentPanel = null;
        selectedPosition = null;
        sendResponse({ success: true });
      } else if (isTokenPage()) {
        injectPanel();
        sendResponse({ success: true });
      } else {
        showNotification('Panel is only available on token pages', 'info');
        sendResponse({ success: false, error: 'Not a token page' });
      }
      return true; // Keep channel open for async response
    }
  });
}

// Check auto-open setting and inject panel if enabled (only on token pages)
async function checkAutoOpen() {
  if (!isTokenPage()) return;

  try {
    const result = await chrome.storage.local.get('axiom-auto-open-panel');
    const autoOpen = result['axiom-auto-open-panel'];

    console.log('[Blood Extension] Auto-open setting:', autoOpen);

    if (autoOpen && !currentPanel) {
      try {
        console.log('[Blood Extension] Auto-opening positions panel');
        await injectPanel();
      } catch (error) {
        console.error('[Blood Extension] Error auto-opening panel:', error);
        showNotification('Failed to auto-open panel. Click extension icon to try again.', 'error');
      }
    }
  } catch (error) {
    console.error('[Blood Extension] Error checking auto-open setting:', error);
  }
}

// Initialize on page load
if (isSupportedSite()) {
  console.log('[Blood Extension] Content script ready on', window.location.hostname);

  // Set up SPA navigation listeners (must be done once at load time)
  setupNavigationListeners();

  // Check if on token page and auto-open panel
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isTokenPage()) {
        checkAutoOpen();
      }
    });
  } else {
    if (isTokenPage()) {
      checkAutoOpen();
    }
  }
}
