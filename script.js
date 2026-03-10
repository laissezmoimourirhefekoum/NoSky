/**
 * NoSky — Discord Token Extension
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tokenInput           = document.getElementById('token');
const inputRow             = document.getElementById('input-row');
const loginBtn             = document.getElementById('login-btn');
const copyTokenBtn         = document.getElementById('copy-token-btn');
const saveAccountCheckbox  = document.getElementById('save-account-checkbox');
const settingsLink         = document.getElementById('settings-link');
const settingsPanel        = document.getElementById('settings-panel');
const closeSettingsBtn     = document.getElementById('close-settings');
const supportLink          = document.getElementById('support-link');
const verifyTokenCheckbox  = document.getElementById('verify-token-checkbox');
const statusMessage        = document.getElementById('status-message');
const loadingOverlay       = document.getElementById('loading-overlay');
const savedAccountsTrigger = document.getElementById('saved-accounts-trigger');
const accountListContainer = document.getElementById('account-list-container');
const accountList          = document.getElementById('account-list');
const toast                = document.getElementById('toast');
const exportAllBtn         = document.getElementById('export-all-btn');

// Modal
const accountModal     = document.getElementById('account-modal');
const closeModalBtn    = document.getElementById('close-modal');
const modalAvatar      = document.getElementById('modal-avatar');
const modalDisplayName = document.getElementById('modal-display-name');
const modalUsername    = document.getElementById('modal-username');
const modalBody        = document.getElementById('modal-body');
const modalLoginBtn    = document.getElementById('modal-login-btn');
const modalCopyBtn     = document.getElementById('modal-copy-btn');

let verifyTokenEnabled = false;
let accountsVisible    = false;
let currentModalToken  = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkCurrentTab();
    setupEventListeners();
    loadSettings();
    displayVersion();
    loadLastToken();
});

// ── Events ────────────────────────────────────────────────────────────────────
function setupEventListeners() {
    loginBtn.addEventListener('click', handleLogin);
    copyTokenBtn.addEventListener('click', handleCopyToken);
    exportAllBtn.addEventListener('click', handleExportAll);

    if (settingsLink)        settingsLink.addEventListener('click', openSettings);
    if (closeSettingsBtn)    closeSettingsBtn.addEventListener('click', closeSettings);
    if (supportLink)         supportLink.addEventListener('click', openSupportLink);
    if (verifyTokenCheckbox) verifyTokenCheckbox.addEventListener('change', () => {
        verifyTokenEnabled = verifyTokenCheckbox.checked;
        saveSettings();
    });

    savedAccountsTrigger.addEventListener('click', toggleSavedAccounts);

    if (settingsPanel) settingsPanel.addEventListener('click', e => { if (e.target === settingsPanel) closeSettings(); });

    closeModalBtn.addEventListener('click', closeModal);
    accountModal.addEventListener('click', e => { if (e.target === accountModal) closeModal(); });
    modalLoginBtn.addEventListener('click', () => { if (currentModalToken) openDiscord(currentModalToken); });
    modalCopyBtn.addEventListener('click', () => {
        if (currentModalToken) {
            navigator.clipboard.writeText(currentModalToken)
                .then(() => showToast('✅ Token copied', 'success'))
                .catch(() => showToast('Copy failed', 'error'));
        }
    });

    const statusClose = document.querySelector('.status-close');
    if (statusClose) statusClose.addEventListener('click', hideStatusMessage);

    tokenInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleLogin(); });
    tokenInput.addEventListener('input', () => {
        setInputState('idle');
        hideStatusMessage();
    });
}

// ── Input state ───────────────────────────────────────────────────────────────
function setInputState(state) {
    inputRow.classList.remove('err', 'ok');
    if (state === 'error')   inputRow.classList.add('err');
    if (state === 'success') inputRow.classList.add('ok');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimeout = null;
function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className   = `toast ${type}`;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin() {
    const token = tokenInput.value.trim().replace(/^"|"$/g, '');
    if (!token) { setInputState('error'); showStatusMessage('Please enter a token', 'error'); return; }

    showLoading(true);
    loginBtn.disabled = true;
    try {
        let valid = false;
        if (verifyTokenEnabled) {
            valid = await verifyTokenWithAPI(token);
            if (!valid) { setInputState('error'); showStatusMessage('Invalid or expired token', 'error'); }
        } else {
            valid = validateTokenFormat(token);
            if (!valid) { setInputState('error'); showStatusMessage('Invalid token format', 'error'); }
        }
        if (valid) {
            setInputState('success');
            showStatusMessage('Logging in…', 'success');
            chrome.storage.local.set({ lastToken: token });
            openDiscord(token);
        }
    } catch {
        showStatusMessage('An error occurred', 'error');
    } finally {
        showLoading(false);
        loginBtn.disabled = false;
    }
}

function openDiscord(token) {
    window.open('https://discord.com/channels/@me?discordtoken=' + token, '_blank');
}

// ── Fetch full account data ───────────────────────────────────────────────────
async function fetchFullUserData(token) {
    const h = { 'Authorization': token };

    const userRes = await fetch('https://discord.com/api/v9/users/@me', { headers: h });
    if (!userRes.ok) return null;
    const user = await userRes.json();

    // Moyens de paiement
    let billingMethods = [];
    try {
        const r = await fetch('https://discord.com/api/v9/users/@me/billing/payment-sources', { headers: h });
        if (r.ok) {
            const sources = await r.json();
            if (Array.isArray(sources)) {
                billingMethods = sources.map(s => {
                    const a = s.billing_address || {};
                    const base = {
                        id:          s.id,
                        default:     s.default   ?? false,
                        invalid:     s.invalid   ?? false,
                        holder:      a.name       || null,
                        line_1:      a.line_1     || null,
                        line_2:      a.line_2     || null,
                        city:        a.city       || null,
                        state:       a.state      || null,
                        postal_code: a.postal_code|| null,
                        country:     a.country    || null,
                    };
                    if (s.type === 1) {
                        return { ...base, method: 'credit_card', brand: s.brand, last_4: s.last_4, exp_month: s.expires_month, exp_year: s.expires_year };
                    } else if (s.type === 2) {
                        return { ...base, method: 'paypal', paypal_email: s.email || null };
                    }
                    return { ...base, method: 'unknown', raw_type: s.type };
                });
            }
        }
    } catch {}

    // Abonnements
    let subscriptions = [];
    try {
        const r = await fetch('https://discord.com/api/v9/users/@me/billing/subscriptions', { headers: h });
        if (r.ok) subscriptions = await r.json();
    } catch {}

    // Historique factures
    let paymentHistory = [];
    try {
        const r = await fetch('https://discord.com/api/v9/users/@me/billing/payments?limit=5', { headers: h });
        if (r.ok) paymentHistory = await r.json();
    } catch {}

    // Connexions tierces
    let connections = [];
    try {
        const r = await fetch('https://discord.com/api/v9/users/@me/connections', { headers: h });
        if (r.ok) {
            const raw = await r.json();
            connections = raw.map(c => ({ type: c.type, name: c.name, id: c.id, verified: c.verified }));
        }
    } catch {}

    const nitroMap = { 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' };

    return {
        token,
        id:            user.id,
        username:      user.username,
        global_name:   user.global_name   || null,
        discriminator: user.discriminator || '0',
        email:         user.email         || null,
        phone:         user.phone         || null,
        locale:        user.locale        || null,
        mfa_enabled:   user.mfa_enabled   ?? false,
        verified:      user.verified      ?? false,
        nitro:         nitroMap[user.premium_type] ?? 'Unknown',
        nitro_type:    user.premium_type  ?? 0,
        avatar:        getAvatarUrl(user.id, user.avatar),
        billing_methods:  billingMethods,
        subscriptions,
        payment_history:  paymentHistory,
        connections,
        savedAt: Date.now(),
    };
}

// ── Storage ───────────────────────────────────────────────────────────────────
function saveToStorage(account) {
    return new Promise(resolve => {
        chrome.storage.local.get(['accounts'], r => {
            let accounts = r.accounts || [];
            const idx    = accounts.findIndex(a => a.id === account.id);
            if (idx !== -1) accounts[idx] = account;
            else accounts.push(account);
            chrome.storage.local.set({ accounts }, resolve);
        });
    });
}

// ── Saved Accounts toggle ─────────────────────────────────────────────────────
function toggleSavedAccounts() {
    accountsVisible = !accountsVisible;
    accountListContainer.classList.toggle('hidden', !accountsVisible);
    savedAccountsTrigger.innerHTML = accountsVisible
        ? 'Hide Saved Accounts <span id="toggle-arrow">▲</span>'
        : 'Show Saved Accounts <span id="toggle-arrow">▼</span>';
    if (accountsVisible) renderSavedAccounts();
}

// ── Render saved accounts ─────────────────────────────────────────────────────
function renderSavedAccounts() {
    accountList.innerHTML = '';
    chrome.storage.local.get(['accounts'], result => {
        const accounts = result.accounts || [];
        if (accounts.length === 0) {
            accountList.innerHTML = '<div class="no-accounts">No saved accounts</div>';
            return;
        }
        accounts.forEach(acc => {
            const hasBilling = acc.billing_methods && acc.billing_methods.length > 0;
            const m = hasBilling ? acc.billing_methods[0] : null;
            let billingLabel = '';
            if (m) {
                if (m.method === 'credit_card') billingLabel = `${m.brand ?? 'Card'} ••${m.last_4}`;
                else if (m.method === 'paypal')  billingLabel = 'PayPal';
                else billingLabel = 'Payment';
            }

            const item = document.createElement('div');
            item.className = 'account-item';
            item.innerHTML = `
                <img src="${acc.avatar}" class="account-avatar" alt=""
                     onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div class="account-info">
                    <span class="account-display-name">${acc.global_name || acc.username}</span>
                    <span class="account-username">${acc.username}</span>
                    <div class="account-badges">
                        ${acc.nitro && acc.nitro !== 'None' ? `<span class="badge badge-nitro">${acc.nitro}</span>` : ''}
                        ${hasBilling ? `<span class="badge badge-billing">${billingLabel}</span>` : ''}
                    </div>
                </div>
                <div class="account-actions">
                    <button class="action-btn delete-btn" title="Remove">✕</button>
                </div>
            `;
            item.querySelector('.delete-btn').addEventListener('click', e => {
                e.stopPropagation();
                item.classList.add('deleting');
                setTimeout(() => removeAccount(acc.id), 220);
            });
            item.addEventListener('click', e => {
                if (e.target.closest('.account-actions')) return;
                openAccountModal(acc);
            });
            accountList.appendChild(item);
        });
    });
}

function removeAccount(userId) {
    chrome.storage.local.get(['accounts'], r => {
        const accounts = (r.accounts || []).filter(a => a.id !== userId);
        chrome.storage.local.set({ accounts }, renderSavedAccounts);
    });
}

// ── Account Detail Modal ──────────────────────────────────────────────────────
// Reproduit exactement le style Python :
//   ► Payment Method : Credit Card
//   ► CC Brand       : Visa
//   ► CC Number      : ****-****-****-1234
//   etc.

function row(label, value, valueClass = '') {
    return `<div class="info-row">
        <span class="info-label">► ${label} :</span>
        <span class="info-value ${valueClass}">${value ?? '<span class="info-value dim">N/A</span>'}</span>
    </div>`;
}

function sectionTitle(title) {
    return `<div class="section-title">${title}</div>`;
}

function openAccountModal(acc) {
    currentModalToken = acc.token;
    modalAvatar.src = acc.avatar;
    modalDisplayName.textContent = acc.global_name || acc.username;
    modalUsername.textContent    = acc.username;

    let html = '';

    // ── ACCOUNT INFO ──────────────────────────────────────────────
    html += sectionTitle('Account Info');
    html += row('ID',       acc.id,         'mono');
    html += row('Email',    acc.email,       acc.email    ? 'mono green' : '');
    html += row('Phone',    acc.phone        || 'None',   acc.phone ? 'mono green' : 'dim');
    html += row('Locale',   acc.locale);
    html += row('2FA',      acc.mfa_enabled ? '✅ Enabled' : '❌ Disabled', acc.mfa_enabled ? 'green' : 'red');
    html += row('Verified', acc.verified    ? '✅ Yes'     : '❌ No',       acc.verified    ? 'green' : 'red');
    html += row('Nitro',    acc.nitro !== 'None' ? `<span class="inline-badge nitro">${acc.nitro}</span>` : 'None');

    // ── BILLING ───────────────────────────────────────────────────
    if (acc.billing_methods && acc.billing_methods.length > 0) {
        acc.billing_methods.forEach((b, i) => {
            html += sectionTitle(`Payment Method ${acc.billing_methods.length > 1 ? `#${i + 1}` : ''}`);
            html += `<div class="billing-block">`;

            if (b.method === 'credit_card') {
                html += row('Payment Method', 'Credit Card');
                html += row('CC Brand',       b.brand);
                html += row('CC Number',      `****-****-****-${b.last_4}`, 'mono');
                html += row('CC Expiry',      `${b.exp_month} / ${b.exp_year}`, 'mono');
                html += row('CC Holder',      b.holder);
            } else if (b.method === 'paypal') {
                html += row('Payment Method', 'PayPal');
                html += row('PayPal Email',   b.paypal_email, 'mono green');
                html += row('Holder',         b.holder);
            } else {
                html += row('Payment Method', 'Unknown');
            }

            html += `</div>`;

            // Adresse de facturation
            html += sectionTitle('Billing Address');
            html += `<div class="billing-block">`;
            html += row('Address 1',   b.line_1);
            html += row('Address 2',   b.line_2 || 'None', b.line_2 ? '' : 'dim');
            html += row('City',        b.city);
            html += row('Postal Code', b.postal_code, 'mono');
            html += row('State',       b.state);
            html += row('Country',     b.country);
            html += `</div>`;
        });
    } else {
        html += sectionTitle('Payment Method');
        html += `<div class="info-row"><span class="info-value dim">No billing info found</span></div>`;
    }

    // ── CONNECTIONS ───────────────────────────────────────────────
    if (acc.connections && acc.connections.length > 0) {
        html += sectionTitle('Connections');
        acc.connections.forEach(c => {
            html += row(c.type.charAt(0).toUpperCase() + c.type.slice(1), c.name, 'mono');
        });
    }

    modalBody.innerHTML = html;
    accountModal.classList.remove('hidden');
}

function closeModal() {
    accountModal.classList.add('hidden');
    currentModalToken = null;
}

// ── Export — un fichier JSON par compte ───────────────────────────────────────
function handleExportAll() {
    chrome.storage.local.get(['accounts'], result => {
        const accounts = result.accounts || [];
        if (accounts.length === 0) { showToast('No accounts to export', 'error'); return; }

        accounts.forEach((acc, i) => {
            setTimeout(() => {
                const data = {
                    exported_at:     new Date().toISOString(),
                    id:              acc.id,
                    token:           acc.token,
                    username:        acc.username,
                    global_name:     acc.global_name,
                    discriminator:   acc.discriminator,
                    email:           acc.email,
                    phone:           acc.phone,
                    locale:          acc.locale,
                    mfa_enabled:     acc.mfa_enabled,
                    verified:        acc.verified,
                    nitro:           acc.nitro,
                    avatar:          acc.avatar,
                    billing_methods: acc.billing_methods  || [],
                    subscriptions:   acc.subscriptions    || [],
                    payment_history: acc.payment_history  || [],
                    connections:     acc.connections      || [],
                    saved_at:        new Date(acc.savedAt).toISOString(),
                };
                const safeName = (acc.username || acc.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
                const blob     = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url      = URL.createObjectURL(blob);
                const a        = document.createElement('a');
                a.href = url; a.download = `${safeName}.json`;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
            }, i * 400);
        });

        showToast(`✅ ${accounts.length} file(s) exported`, 'success');
    });
}

// ── Copy token from Discord tab ───────────────────────────────────────────────
function handleCopyToken() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab?.url?.includes('discord.com/channels/@me')) {
            showToast('Open discord.com/channels/@me first', 'error');
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId: tab.id },
                func: () => {
                    try {
                        if (window.webpackChunkdiscord_app) {
                            const cache = window.webpackChunkdiscord_app.push([[Symbol()], {}, e => e.c]);
                            const mod   = Object.values(cache).find(e => e?.exports?.default?.getToken);
                            if (mod) { const t = mod.exports.default.getToken(); if (t) return t; }
                        }
                    } catch {}
                    try { const raw = localStorage.getItem('token'); if (raw) return raw.replace(/"/g, ''); } catch {}
                    return null;
                }
            },
            async results => {
                if (chrome.runtime.lastError) { showToast('Cannot access the page', 'error'); return; }
                const token = results?.[0]?.result;
                if (!token) { showToast('Log in to Discord first', 'error'); return; }

                showToast('Fetching account info…', 'info');

                try {
                    const fullData = await fetchFullUserData(token);
                    if (!fullData) { showToast('Token invalid or expired', 'error'); return; }

                    if (saveAccountCheckbox?.checked) await saveToStorage(fullData);

                    tokenInput.value = token;
                    const hasBilling = fullData.billing_methods?.length > 0;

                    navigator.clipboard.writeText(token)
                        .then(() => showToast(hasBilling ? '✅ Token copied · 💳 Billing found' : '✅ Token copied & saved', 'success'))
                        .catch(() => showToast('Token fetched but copy failed', 'error'));

                } catch { showToast('Network error', 'error'); }
            }
        );
    });
}

function checkCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]?.url?.includes('discord.com/channels/@me')) copyTokenBtn.disabled = false;
    });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function validateTokenFormat(token) {
    return token.length > 50 && /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token);
}

async function verifyTokenWithAPI(token) {
    try {
        const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { 'Authorization': token } });
        return r.ok;
    } catch { return false; }
}

function loadLastToken() {
    chrome.storage.local.get(['lastToken'], r => { if (r.lastToken) tokenInput.value = r.lastToken; });
}

function getAvatarUrl(userId, hash) {
    if (!hash) {
        try { return `https://cdn.discordapp.com/embed/avatars/${BigInt(userId) % 5n}.png`; }
        catch { return 'https://cdn.discordapp.com/embed/avatars/0.png'; }
    }
    return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png`;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function openSettings(e)  { e.preventDefault(); settingsPanel.classList.remove('hidden'); }
function closeSettings()  { settingsPanel.classList.add('hidden'); }
function loadSettings()   { chrome.storage.sync.get(['verifyTokenEnabled'], r => { verifyTokenEnabled = r.verifyTokenEnabled || false; if (verifyTokenCheckbox) verifyTokenCheckbox.checked = verifyTokenEnabled; }); }
function saveSettings()   { chrome.storage.sync.set({ verifyTokenEnabled }); }
function showLoading(v)   { loadingOverlay.classList.toggle('hidden', !v); }
function displayVersion() { const v = chrome.runtime.getManifest?.()?.version; const el = document.getElementById('version-display'); if (el && v) el.textContent = `v${v}`; }
function showStatusMessage(msg, type) { statusMessage.querySelector('.status-text').textContent = msg; statusMessage.className = `status-message ${type}`; statusMessage.classList.remove('hidden'); }
function hideStatusMessage() { statusMessage.classList.add('hidden'); }
function openSupportLink(e) { e.preventDefault(); chrome.tabs.create({ url: 'https://discord.gg/48qbg6UP9g' }); }