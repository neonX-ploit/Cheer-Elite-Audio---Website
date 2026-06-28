import { db }                             from './firebase.js';
import { state }                          from './state.js';
import { $, escHtml, getInitials, formatFull, fmtDuration, statusClass, formatTime } from './utils.js';
import { showToast, showReceipt }         from './ui.js';
import { renderOrders }                   from './orders.js';
import { startListeningToOrders }         from './orders.js';
import { loadDeliveries }                 from './deliveries.js';
import {
  collection, doc, addDoc, getDoc, updateDoc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Cloudinary config ─────────────────────────────────
const CLOUDINARY_CLOUD  = 'dz7oewy7z';
const CLOUDINARY_PRESET = 'Cheer Elite Audio - trackdeliveries';

export let currentAdminName = 'Support';
export function setCurrentAdminName(name) { currentAdminName = name; }

let adminTypingTimeout = null;
let unsubAdminTyping   = null;
let adminTypingBubble  = null;

/* ── Client list ────────────────────────────────────────── */
export function startListeningToChats() {
  const q = query(collection(db, 'chats'), orderBy('lastUpdated', 'desc'));
  state.unsubChats = onSnapshot(q, snap => {
    state.allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const visibleChats = state.allChats.filter(c => !c.archivedByAdmin);
    renderClientList(visibleChats);
    updateUnreadBadge(visibleChats);
    const el = $('stat-clients');
    if (el) el.textContent = visibleChats.length;
  });
}

let requestsExpanded = false; // remember open/closed state across re-renders

export function renderClientList(chats) {
  const clientListEl = $('client-list');
  clientListEl.innerHTML = '';

  const conversations = chats.filter(c => c.adminReplied);
  const requests      = chats.filter(c => !c.adminReplied && c.lastMessage !== '');

  if (conversations.length === 0 && requests.length === 0) {
    clientListEl.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">
          <svg viewBox="0 0 48 48" fill="none">
            <path d="M8 14a4 4 0 014-4h24a4 4 0 014 4v18a4 4 0 01-4 4H14l-8 6V14z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          </svg>
        </div>
        <p>No clients yet.<br/>They'll appear when they send their first message.</p>
      </div>`;
    return;
  }

  // ── Message Requests FIRST ──
  if (requests.length > 0) {
    const header = document.createElement('div');
    header.className = 'cl-section-header cl-requests-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;
        border-top:1px solid #e5e7eb;border-bottom:${requestsExpanded ? '1px solid #e5e7eb' : 'none'};
        background:#ffffff;user-select:none;">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.06);
          border:1px solid rgba(0,0,0,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Message Requests</div>
          <div style="font-size:11px;color:#6b7280;">${requests.length} pending request${requests.length > 1 ? 's' : ''}</div>
        </div>
        <svg class="cl-requests-chevron" viewBox="0 0 24 24" fill="none" stroke="#6b7280"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"
          style="transition:transform .2s;transform:rotate(${requestsExpanded ? '0' : '-90'}deg);">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>`;
    clientListEl.appendChild(header);

    const requestsContainer = document.createElement('div');
    requestsContainer.className = 'cl-requests-container';
    requestsContainer.style.cssText = `overflow:hidden;transition:max-height .25s ease;max-height:0;`;
    requests.forEach(chat => requestsContainer.appendChild(buildClientItem(chat)));
    clientListEl.appendChild(requestsContainer);

    header.addEventListener('click', () => {
      requestsExpanded = !requestsExpanded;
      requestsContainer.style.maxHeight = requestsExpanded ? '9999px' : '0';
      const chevron = header.querySelector('.cl-requests-chevron');
      chevron.style.transform = `rotate(${requestsExpanded ? '0' : '-90'}deg)`;
      header.querySelector('div').style.borderBottom = requestsExpanded ? '1px solid #e5e7eb' : 'none';
    });
  }

  // ── Chats section header ──
  if (conversations.length > 0) {
    const chatsHeader = document.createElement('div');
    chatsHeader.style.cssText = `
      padding:8px 14px;
      font-size:11px;
      font-weight:700;
      color:#6b7280;
      text-transform:uppercase;
      letter-spacing:.5px;
      border-bottom:1px solid #e5e7eb;
      background:#fff;
    `;
    chatsHeader.textContent = 'Chats';
    clientListEl.appendChild(chatsHeader);
  }

  // ── Conversations ──
  conversations.forEach(chat => clientListEl.appendChild(buildClientItem(chat)));
}

function buildClientItem(chat) {
  const item = document.createElement('div');
  item.className = 'client-item';
  item.dataset.chatId = chat.id;
  if (chat.id === state.activeChatId) item.classList.add('active');
  if ((chat.unread || 0) > 0)         item.classList.add('has-unread');

  const initials  = getInitials(chat.clientName || '?');
  const preview   = chat.lastMessage || 'No messages yet';
  const time      = chat.lastUpdated ? formatTime(chat.lastUpdated.toDate()) : '';
  const statusCls = statusClass(chat.status);

  const avatarHTML = chat.clientPhoto
    ? `<img src="${escHtml(chat.clientPhoto)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
    : `<div class="ci-av">${initials}</div>`;

  item.innerHTML = `
    ${avatarHTML}
    <div class="ci-meta">
      <div class="ci-name">${escHtml(chat.clientName || 'Unknown')}</div>
      <div class="ci-preview">${escHtml(preview)}</div>
    </div>
    <div class="ci-right">
      <span class="ci-time">${time}</span>
      <div style="display:flex;align-items:center;gap:4px;">
        <div class="status-dot ${statusCls}"></div>
        ${(chat.unread || 0) > 0 ? '<div class="ci-unread"></div>' : ''}
      </div>
    </div>
  `;
  item.addEventListener('click', () => openChat(chat));
  return item;
}

function updateUnreadBadge(chats) {
  const total = chats
    .filter(c => c.adminReplied)   // ← only count conversation unreads
    .reduce((s, c) => s + (c.unread || 0), 0);
  const badge = $('chats-badge');
  if (badge) {
    badge.textContent   = total > 0 ? total : '';
    badge.style.display = total > 0 ? 'inline' : 'none';
  }
}

/* ── Search ─────────────────────────────────────────────── */
export function initSearch() {
  $('cp-search-input')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderClientList(state.allChats.filter(c =>
      !c.archivedByAdmin &&
      ((c.clientName  || '').toLowerCase().includes(q) ||
       (c.clientEmail || '').toLowerCase().includes(q))
    ));
  });
}

/* ── Open chat ──────────────────────────────────────────── */
export async function openChat(chat) {
  state.activeChatId = chat.id;

  startListeningToOrders(chat.id);

  $('client-panel').classList.add('hidden-mobile');
  $('chat-panel').classList.remove('hidden-mobile');
  $('back-to-list').style.display = 'flex';

  $('no-chat').style.display = 'none';
  $('chat-header').classList.add('visible');
  $('order-panel').classList.add('visible');
  $('reply-bar').classList.add('visible');

  const chatAvEl = $('chat-av');
  if (chat.clientPhoto) {
    chatAvEl.style.cssText = 'padding:0;overflow:hidden;background:none;';
    chatAvEl.innerHTML = `<img src="${escHtml(chat.clientPhoto)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" />`;
  } else {
    chatAvEl.style.cssText = '';
    chatAvEl.textContent = getInitials(chat.clientName || '?');
  }

  $('chat-name').textContent  = chat.clientName  || 'Unknown';
  $('chat-email').textContent = chat.clientEmail || '—';
  $('notes-textarea').value   = chat.adminNotes  || '';
  $('notes-panel').classList.remove('open');
  $('notes-btn').classList.remove('active');
  $('messages-area').innerHTML = '';

  updateDoc(doc(db, 'chats', chat.id), { unread: 0 }).catch(console.error);

  document.querySelectorAll('.client-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatId === chat.id);
  });

  startListeningToClientTyping(chat.id);

  if (state.unsubMessages) state.unsubMessages();
  const msgsQ = query(collection(db, 'chats', chat.id, 'messages'), orderBy('timestamp', 'asc'));
  state.unsubMessages = onSnapshot(msgsQ, snap => {
    let hasNewMessage = false; // track if any new messages were added

    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        renderMessage(change.doc.data(), change.doc.id);
        hasNewMessage = true; // only scroll for new messages
      } else if (change.type === 'modified') {
        const msgId = change.doc.id;
        const data  = change.doc.data();
        const existing = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (existing) {
          // Update reactions (your existing code)
          const reactionsContainer = existing.querySelector('.msg-reactions');
          const newReactionsHTML = (data.reactions && Object.keys(data.reactions).length)
            ? Object.entries(data.reactions)
                .filter(([, voters]) => Object.keys(voters).length > 0)
                .map(([emoji, voters]) =>
                  `<span class="msg-reaction" data-emoji="${emoji}">${emoji} ${Object.keys(voters).length}</span>`)
                .join('')
            : '';

          if (reactionsContainer) {
            reactionsContainer.innerHTML = newReactionsHTML;
            reactionsContainer.style.display = newReactionsHTML ? '' : 'none';
          } else if (newReactionsHTML) {
            const timeEl = existing.querySelector('.msg-time');
            const div = document.createElement('div');
            div.className = 'msg-reactions';
            div.innerHTML = newReactionsHTML;
            timeEl?.parentNode?.insertBefore(div, timeEl);
          }

          // Update seen/delivered status live
          if (data.sender === 'admin') {
            const seenEl = existing.querySelector('.msg-seen, .msg-delivered');
            if (seenEl) {
              if (data.seenByClient) {
                seenEl.className = 'msg-seen';
                seenEl.innerHTML = `
                  <svg viewBox="0 0 16 12" fill="none" width="14" height="14">
                    <path d="M1 6l4 4L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M6 10L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  Seen`;
              } else {
                seenEl.className = 'msg-delivered';
                seenEl.innerHTML = `
                  <svg viewBox="0 0 16 12" fill="none" width="14" height="14">
                    <path d="M1 6l4 4L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  Delivered`;
              }
            }
          }
        }
      }
    });

    // Only scroll when new messages arrive, not on reactions/edits
    if (hasNewMessage) {
      scrollMessages();
      applyMessageGrouping();
    }

    snap.docs.forEach(d => {
      const data = d.data();
      if (data.sender === 'client' && !data.seenByAdmin)
        updateDoc(d.ref, { seenByAdmin: true }).catch(console.error);
    });
  });
}

/* ── Close chat ─────────────────────────────────────────── */
export function closeChat() {
  $('client-panel').classList.remove('hidden-mobile');
  $('chat-panel').classList.add('hidden-mobile');
  $('back-to-list').style.display = 'none';

  // Clear admin typing flag
  if (state.activeChatId) {
    setAdminTyping(false);
  }
  clearTimeout(adminTypingTimeout); 
  stopListeningToClientTyping();

  state.activeChatId = null;
  $('chat-header').classList.remove('visible');
  $('reply-bar').classList.remove('visible');
  $('no-chat').style.display = 'flex';
  $('messages-area').innerHTML = '';
  if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
  $('order-panel').classList.remove('visible');
  $('order-list').innerHTML = '';
  if (state.unsubOrders) { state.unsubOrders(); state.unsubOrders = null; }
}

/* ── Delete chat (admin-side only — client keeps full history) ── */
export async function deleteActiveChat() {
  if (!state.activeChatId) return;
  try {
  await updateDoc(doc(db, 'chats', state.activeChatId), {
    archivedByAdmin: true,
    archivedAt:      serverTimestamp(),
    adminReplied:    false,
    lastMessage:     '',
    unread:          0,
    deletedAt:       serverTimestamp(),
  });
    showToast('Conversation removed from your inbox');
    closeChat();
  } catch (err) {
    console.error(err);
    showToast('Error removing conversation');
  }
}
/* ── Render message ─────────────────────────────────────── */
/* ── Render message ─────────────────────────────────────── */
const REACTIONS = ['❤️', '😆', '😮', '😢', '😡', '👍'];
let replyingTo   = null; // { msgId, text, sender }
let pastedImages = []; // [{ file, objectUrl }, ...] — images pasted into reply bar (max 10)

function renderMessage(data, msgId) {
  const messagesAreaEl = $('messages-area');
  const wrap           = document.createElement('div');
  const senderLabel = data.sender === 'admin' ? (data.senderName || 'You (Admin)') : (data.senderName || 'Client');
  const ts             = data.timestamp ? formatFull(data.timestamp.toDate()) : 'Just now';

  const seenHTML = data.sender === 'admin'
    ? data.seenByClient
      ? `<span class="msg-seen">
          <svg viewBox="0 0 16 12" fill="none" width="14" height="14">
            <path d="M1 6l4 4L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 10L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Seen
        </span>`
      : `<span class="msg-delivered">
          <svg viewBox="0 0 16 12" fill="none" width="14" height="14">
            <path d="M1 6l4 4L14 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Delivered
        </span>`
    : '';
  const replyHTML = data.replyTo
    ? `<div class="msg-reply-preview" data-jump-to="${escHtml(data.replyTo.msgId || '')}">
        <span class="msg-reply-name">${escHtml(data.replyTo.sender === 'admin' ? 'You' : data.replyTo.senderName || 'Client')}</span>
        <span class="msg-reply-text">${escHtml(data.replyTo.text || '📎 Attachment')}</span>
       </div>`
    : '';

  const reactionsHTML = (() => {
    if (!data.reactions || !Object.keys(data.reactions).length) return '';
    const parts = [];
    Object.entries(data.reactions).forEach(([key, val]) => {
      if (typeof val === 'string') {
        // Client format: { "client": "❤️" }
        parts.push(`<span class="msg-reaction" data-emoji="${val}">${val} 1</span>`);
      } else if (typeof val === 'object') {
        // Admin format: { "❤️": { "admin": true } }
        const count = Object.keys(val).length;
        if (count > 0) parts.push(`<span class="msg-reaction" data-emoji="${key}">${key} ${count}</span>`);
      }
    });
    return parts.length ? `<div class="msg-reactions">${parts.join('')}</div>` : '';
  })();

  const actionsHTML = `
    <div class="msg-actions">
      <button class="msg-action-btn msg-react-btn" title="React">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/>
        </svg>
      </button>
      <button class="msg-reply-btn msg-action-btn" title="Reply">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <polyline points="9 17 4 12 9 7"/>
          <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      </button>
    </div>`;

  const chatData   = state.allChats.find(c => c.id === state.activeChatId) || {};
  const avatarHTML = data.sender === 'client'
    ? (chatData.clientPhoto
        ? `<img class="msg-avatar" src="${escHtml(chatData.clientPhoto)}" alt="" />`
        : `<div class="msg-avatar-placeholder">${getInitials(chatData.clientName || data.senderName || 'C')}</div>`)
    : '';

  wrap.className     = `msg-wrap ${data.sender}`;
  wrap.dataset.msgId = msgId;

  if (data.type === 'track') {
    wrap.innerHTML = `
      ${avatarHTML}
      <div class="msg-bubble-col">
        <div class="msg-sender">${escHtml(senderLabel)}</div>
        ${replyHTML}
        <div class="track-bubble admin-track">
          <div class="track-name">
            <svg viewBox="0 0 16 16" fill="none" style="width:13px;height:13px;flex-shrink:0;">
              <path d="M5 13V5.5l8-2V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="4" cy="13" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="11" r="1.5" fill="currentColor"/>
            </svg>
            ${escHtml(data.trackName || 'Track')}
            <span class="track-version">${escHtml(data.version || 'v1')}</span>
          </div>
          <div class="track-meta">${escHtml(data.fileName || '')} · Tap to preview</div>
          <div class="track-player">
            <button class="track-play-btn" data-url="${escHtml(data.fileUrl)}">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>
            </button>
            <div class="track-progress"><div class="track-progress-fill"></div></div>
            <span class="track-time">0:00</span>
          </div>
          <a class="track-download-btn" href="${escHtml(data.fileUrl)}" download="${escHtml(data.fileName || 'track')}">
            <svg viewBox="0 0 16 16" fill="none" style="width:12px;height:12px;">
              <path d="M8 2v9M5 8l3 3 3-3M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Download
          </a>
        </div>
        ${reactionsHTML}
        <div class="msg-time">${ts} ${seenHTML}</div>
        ${actionsHTML}
      </div>`;
    initPlayer(wrap);

  } else if (data.type === 'order_form') {
    wrap.innerHTML = `
      ${avatarHTML}
      <div class="msg-bubble-col">
        <div class="msg-sender">${escHtml(senderLabel)}</div>
        ${replyHTML}
        <div class="msg-bubble" style="background:var(--sb-bg);color:#EEF4F7;border-bottom-right-radius:4px;padding:14px 16px;max-width:320px;">
          <div style="font-size:11px;font-weight:700;color:var(--teal);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">
            Order Form · Mix ${data.orderNumber} · ${data.orderType}
          </div>
          <div style="font-size:12px;color:var(--sb-muted);">Form sent to client. Waiting for them to fill it out.</div>
        </div>
        ${reactionsHTML}
        <div class="msg-time">${ts}</div>
        ${actionsHTML}
      </div>`;

  } else if (data.type === 'payment-details') {
    const type        = data.paymentType || 'both';
    const methodLabel = { gcash: 'GCash', paypal: 'PayPal', both: 'GCash & PayPal' }[type];
    let bodyHTML = '';
    if (type === 'gcash') {
      bodyHTML = `
        <div class="payment-bubble-row"><span class="payment-bubble-label">Account Name</span><span class="payment-bubble-value">Kurt Russel Añora</span></div>
        <div class="payment-bubble-row"><span class="payment-bubble-label">Account Number</span><span class="payment-bubble-value">0969 912 9277</span></div>`;
    } else if (type === 'paypal') {
      bodyHTML = `<div class="payment-bubble-row"><span class="payment-bubble-label">PayPal Link</span><span class="payment-bubble-value">paypal.me/iamkurtme</span></div>`;
    } else {
      bodyHTML = `
        <div class="payment-bubble-row"><span class="payment-bubble-label">GCash Name</span><span class="payment-bubble-value">Kurt Russel Añora</span></div>
        <div class="payment-bubble-row"><span class="payment-bubble-label">GCash Number</span><span class="payment-bubble-value">0969 912 9277</span></div>
        <div class="payment-bubble-divider"></div>
        <div class="payment-bubble-row"><span class="payment-bubble-label">PayPal</span><span class="payment-bubble-value">paypal.me/iamkurtme</span></div>`;
    }
    wrap.innerHTML = `
      <div class="msg-bubble-col">
        <div class="msg-sender">You (Admin)</div>
        ${replyHTML}
        <div class="payment-bubble">
          <div class="payment-bubble-header">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
            <span>Payment Details — ${escHtml(methodLabel)}</span>
          </div>
          <div class="payment-bubble-body">${bodyHTML}
            <p class="payment-bubble-note">Please send your payment and reply with a screenshot of your receipt to confirm.</p>
          </div>
        </div>
        ${reactionsHTML}
        <div class="msg-time">${ts} ${seenHTML}</div>
        ${actionsHTML}
      </div>`;

  } else if (data.type === 'payment_proof') {
    wrap.innerHTML = `
      ${avatarHTML}
      <div class="msg-bubble-col">
        <div class="msg-sender">${escHtml(senderLabel)}</div>
        ${replyHTML}
        <img src="${escHtml(data.imageUrl)}" alt="Image" class="payment-proof-img"
          style="max-width:240px;border-radius:12px;border:1px solid rgba(0,229,195,0.2);cursor:zoom-in;display:block;" />
        ${reactionsHTML}
        <div class="msg-time">${ts} ${seenHTML}</div>
        ${actionsHTML}
      </div>`;
    wrap.querySelector('.payment-proof-img')?.addEventListener('click', () => openImageLightbox(data.imageUrl));

  } else if (data.type === 'image') {
    wrap.innerHTML = `
      ${avatarHTML}
      <div class="msg-bubble-col">
        <div class="msg-sender">${escHtml(senderLabel)}</div>
        ${replyHTML}
        <div style="display:flex;flex-direction:column;gap:6px;">
          <img src="${escHtml(data.imageUrl)}" alt="Image" class="chat-sent-img"
            style="max-width:280px;border-radius:12px;cursor:zoom-in;display:block;border:1px solid var(--ct-border);" />
          ${data.text ? `<div class="msg-bubble" style="margin-top:2px;">${escHtml(data.text)}</div>` : ''}
        </div>
        ${reactionsHTML}
        <div class="msg-time">${ts} ${seenHTML}</div>
        ${actionsHTML}
      </div>`;
    wrap.querySelector('.chat-sent-img')?.addEventListener('click', () => openImageLightbox(data.imageUrl));

  } else {
    wrap.innerHTML = `
      ${avatarHTML}
      <div class="msg-bubble-col">
        <div class="msg-sender">${escHtml(senderLabel)}</div>
        ${replyHTML}
        <div class="msg-bubble">${escHtml(data.text || '')}</div>
        ${reactionsHTML}
        <div class="msg-time">${ts} ${seenHTML}</div>
        ${actionsHTML}
      </div>`;
  }

  // ── Click reply preview → scroll to original message ──
  wrap.querySelector('.msg-reply-preview')?.addEventListener('click', () => {
    const msgId = wrap.querySelector('.msg-reply-preview')?.dataset.jumpTo;
    if (!msgId) return;
    const target = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash highlight on the bubble only, not the whole wrap
    const bubble = target.querySelector('.msg-bubble');
    if (bubble) {
      bubble.classList.add('msg-highlight');
      setTimeout(() => bubble.classList.remove('msg-highlight'), 1800);
    } else {
      // fallback for track/image messages
      target.classList.add('msg-highlight');
      setTimeout(() => target.classList.remove('msg-highlight'), 1800);
    }
  });

  wrap.querySelector('.msg-reply-btn')?.addEventListener('click', () => {
    setReplyingTo(msgId, data);
  });

  wrap.querySelector('.msg-react-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(e.currentTarget, msgId, data);
  });

  messagesAreaEl.appendChild(wrap);
  applyMessageGrouping();
}

/* ── Reply UI ───────────────────────────────────────────── */
function setReplyingTo(msgId, data) {
  replyingTo = {
    msgId,
    text: data.text || '📎 Attachment',
    sender: data.sender,
    senderName: data.senderName
  };

  let bar = document.getElementById('reply-preview-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'reply-preview-bar';
    bar.innerHTML = `
      <div class="rp-accent"></div>
      <div class="rp-body">
        <div class="rp-name" id="rp-name"></div>
        <div class="rp-text" id="rp-text"></div>
      </div>
      <button id="reply-cancel-btn">×</button>
    `;
    $('reply-bar').insertBefore(bar, $('reply-bar').firstChild);
    document.getElementById('reply-cancel-btn').addEventListener('click', cancelReply);
  }

  bar.style.display = 'flex';
  document.getElementById('rp-name').textContent =
    replyingTo.sender === 'admin' ? 'You (Admin)' : (replyingTo.senderName || 'Client');
  document.getElementById('rp-text').textContent = replyingTo.text;
  $('reply-input')?.focus();
}

function cancelReply() {
  replyingTo = null;
  const bar = $('reply-preview-bar');
  if (bar) bar.style.display = 'none';
}

/* ── Reaction picker ────────────────────────────────────── */
function showReactionPicker(btn, msgId, data) {
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';

  REACTIONS.forEach(emoji => {
    const btn2 = document.createElement('button');
    btn2.textContent = emoji;
    btn2.addEventListener('mouseenter', () => btn2.style.transform = 'scale(1.4) translateY(-4px)');
    btn2.addEventListener('mouseleave', () => btn2.style.transform = 'scale(1)');
    btn2.addEventListener('click', () => {
      sendReaction(msgId, emoji).then(() => { 
        picker.remove();
      });
    });
    picker.appendChild(btn2);
  });

  // Position above the react button
  const rect = btn.getBoundingClientRect();
  const pickerWidth = REACTIONS.length * 38 + 20; 

  let left = rect.left - pickerWidth / 2;
// Clamp so it never goes off screen
  left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8));
  picker.style.position = 'fixed';
  picker.style.left = left + 'px';
  picker.style.top  = (rect.top - 56) + 'px';
  document.body.appendChild(picker);

  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0);
}

async function sendReaction(msgId, emoji) {
  if (!state.activeChatId) return;
  const myId  = 'admin';
  const msgRef = doc(db, 'chats', state.activeChatId, 'messages', msgId);

  try {
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) return;

    const currentReactions = msgSnap.data().reactions || {};
    const updated = {};

    // Check if admin already reacted with this same emoji (toggle off)
    const alreadyReacted = currentReactions[emoji]?.[myId];

    if (alreadyReacted) {
      // Toggle off — remove just this admin's vote on this emoji
      await updateDoc(msgRef, {
        [`reactions.${emoji}.${myId}`]: deleteField()
      });
    } else {
      // Add reaction without touching others
      await updateDoc(msgRef, {
        [`reactions.${emoji}.${myId}`]: true
      });
    }
  } catch (err) { console.error('Reaction error:', err); }
}

function scrollMessages() {
  const el = $('messages-area');
  el.scrollTop = el.scrollHeight;
}

/* ── Scroll-to-latest button ────────────────────────────── */
function ensureScrollToLatestBtn() {
  let btn = document.getElementById('scroll-to-latest-btn');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.id = 'scroll-to-latest-btn';
  btn.title = 'Jump to latest';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
      <polyline points="6 9 12 15 18 9"/>
    </svg>`;
  btn.style.cssText = `
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:20px;
    width:36px; height:36px; border-radius:50%;
    background:var(--teal,#00E5C3); border:none; cursor:pointer;
    display:none; align-items:center; justify-content:center;
    color:#0C1117; box-shadow:0 4px 16px rgba(0,0,0,0.25);
    z-index:20; transition:opacity .2s;
  `;
  btn.addEventListener('click', () => {
    const area = $('messages-area');
    area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
  });

  // Attach to reply-bar so it floats centered above it
  const messagesArea = $('messages-area');
  if (messagesArea) {
    messagesArea.style.position = 'relative';
    messagesArea.appendChild(btn);
  }
  // Center button on chat panel, stays fixed on scroll
  function repositionBtn() {
    const panel = $('chat-panel');
    if (!panel || !btn) return;
    const rect = panel.getBoundingClientRect();
    btn.style.left = (rect.left + rect.width / 2) + 'px';
  }
  repositionBtn();
  window.addEventListener('resize', repositionBtn);

  return btn;
}
function initScrollToLatest() {
  const area = $('messages-area');
  if (!area) return;
  const btn = ensureScrollToLatestBtn();

  area.addEventListener('scroll', () => {
    const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
    const shouldShow = distFromBottom > 120;
    if (shouldShow) {
      const panel = $('chat-panel');
      if (panel) {
        const rect = panel.getBoundingClientRect();
        btn.style.left = (rect.left + rect.width / 2) + 'px';
      }
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  });
}

/* ── Typing indicator ───────────────────────────────────── */
let typingTimeout = null;
let unsubTyping   = null;

function startListeningToClientTyping(chatId) {
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }

  unsubTyping = onSnapshot(doc(db, 'chats', chatId), snap => {
    const data   = snap.data() || {};
    const typing = !!data.typingClient;
    renderTypingIndicator(typing);
  });
}

function stopListeningToClientTyping() {
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
  renderTypingIndicator(false);
}

let _clientIsTyping = false; // track state to avoid unnecessary DOM changes

function renderTypingIndicator(show) {
  if (show === _clientIsTyping) return;
  _clientIsTyping = show;

  let indicator = document.getElementById('typing-indicator');

  if (!show) {
    if (indicator) indicator.remove();
    return;
  }

  if (indicator) return;

  const chatData   = state.allChats.find(c => c.id === state.activeChatId) || {};
  const avatarHTML = chatData.clientPhoto
    ? `<img class="msg-avatar" src="${escHtml(chatData.clientPhoto)}" alt="" />`
    : `<div class="msg-avatar-placeholder">${getInitials(chatData.clientName || 'C')}</div>`;

  indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  indicator.className = 'msg-wrap client';
  indicator.innerHTML = `
    ${avatarHTML}
    <div class="msg-bubble-col">
      <div class="typing-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>`;
  $('messages-area')?.appendChild(indicator);

  const area = $('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
}


function initPlayer(wrap) {
  const btn    = wrap.querySelector('.track-play-btn');
  const fill   = wrap.querySelector('.track-progress-fill');
  const timeEl = wrap.querySelector('.track-time');
  const url    = btn.dataset.url;
  let audio    = null;

  btn.addEventListener('click', () => {
    if (!audio) {
      if (state.activeAudio) { state.activeAudio.pause(); state.activeAudio = null; }
      audio = new Audio(url);
      state.activeAudio = audio;
      audio.addEventListener('timeupdate', () => {
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        fill.style.width = pct + '%';
        timeEl.textContent = fmtDuration(audio.currentTime);
      });
      audio.addEventListener('ended', () => {
        fill.style.width = '0%';
        timeEl.textContent = '0:00';
        btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>`;
        btn.classList.remove('playing');
        audio = null; state.activeAudio = null;
      });
      audio.play();
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#0C1117"/></svg>`;
      btn.classList.add('playing');
    } else if (audio.paused) {
      audio.play();
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#0C1117"/></svg>`;
    } else {
      audio.pause();
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>`;
    }
  });
}

/* ── Reply bar ──────────────────────────────────────────── */
export function initReplyBar() {
  const replyInputEl = $('reply-input');
  const replySendEl  = $('reply-send');

  replySendEl?.addEventListener('click', sendReply);
  replyInputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  });
  replyInputEl?.addEventListener('input', () => {
    replyInputEl.style.height = 'auto';
    replyInputEl.style.height = Math.min(replyInputEl.scrollHeight, 120) + 'px';
  });

  initPaymentPicker();
  initScrollToLatest();

  // ── Paste images into reply bar (up to 10) ─────────────
  replyInputEl?.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    imageItems.forEach(item => {
      if (pastedImages.length >= 10) return;
      const file = item.getAsFile();
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      pastedImages.push({ file, objectUrl });
    });
    renderPasteStrip();
  });
  
  replyInputEl.addEventListener('input', () => {
    if (state.activeChatId) {
      setAdminTyping(true);
      clearTimeout(adminTypingTimeout);
      adminTypingTimeout = setTimeout(() => setAdminTyping(false), 2000);
    }
  });
}

function renderPasteStrip() {
  let strip = document.getElementById('paste-image-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'paste-image-strip';
    strip.style.cssText = `
      display:flex; align-items:center; gap:10px;
      padding:10px 14px; overflow-x:auto;
      background:var(--ct-subtle); border-top:1px solid var(--ct-border);
      flex-shrink:0; scrollbar-width:thin;
    `;
    const replyBar = $('reply-bar');
    replyBar.insertBefore(strip, replyBar.firstChild);
  }
  strip.innerHTML = '';
  pastedImages.forEach((img, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;flex-shrink:0;';
    wrap.innerHTML = `
      <img src="${img.objectUrl}" style="
        width:80px;height:80px;object-fit:cover;border-radius:10px;
        border:1.5px solid var(--ct-border);display:block;background:#e5e7eb;
      " />
      <button data-idx="${idx}" style="
        position:absolute;top:-6px;right:-6px;
        width:20px;height:20px;border-radius:50%;
        background:#1f2937;border:1.5px solid var(--ct-border);
        color:#fff;font-size:13px;line-height:1;
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        padding:0;
      ">×</button>
    `;
    wrap.querySelector('button').addEventListener('click', () => removePastedImage(idx));
    strip.appendChild(wrap);
  });
}

function removePastedImage(idx) {
  URL.revokeObjectURL(pastedImages[idx].objectUrl);
  pastedImages.splice(idx, 1);
  if (pastedImages.length === 0) {
    clearAllPastedImages();
  } else {
    renderPasteStrip();
  }
}

function clearAllPastedImages() {
  pastedImages.forEach(img => URL.revokeObjectURL(img.objectUrl));
  pastedImages = [];
  const strip = document.getElementById('paste-image-strip');
  if (strip) strip.remove();
}

function initPaymentPicker() {
  const payBtn   = $('payment-details-btn');
  const modal    = $('payment-picker-modal');
  const closeBtn = $('payment-picker-close');

  if (!payBtn) { console.warn('[PaymentPicker] payment-details-btn not found'); return; }
  if (!modal)  { console.warn('[PaymentPicker] payment-picker-modal not found'); return; }

  payBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.activeChatId) { showToast('Open a client chat first'); return; }
    modal.classList.add('open');
    modal.style.display = 'flex';
  });
  closeBtn?.addEventListener('click', () => {
    modal.classList.remove('open');
    modal.style.display = '';
  });
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.classList.remove('open');
      modal.style.display = '';
    }
  });

  $('send-gcash')?.addEventListener('click',  () => sendPaymentMessage('gcash'));
  $('send-paypal')?.addEventListener('click', () => sendPaymentMessage('paypal'));
  $('send-both')?.addEventListener('click',   () => sendPaymentMessage('both'));
}

async function sendPaymentMessage(type) {
  if (!state.activeChatId) return;
  const modal = $('payment-picker-modal');
  modal.classList.remove('open');
  modal.style.display = '';

  const labels = { gcash: 'GCash', paypal: 'PayPal', both: 'GCash & PayPal' };
  try {
    await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), {
      type: 'payment-details',
      paymentType: type,
      sender: 'admin',
      senderName: state.adminName,
      timestamp: serverTimestamp(),
      seenByClient: false
    });
    await updateDoc(doc(db, 'chats', state.activeChatId), {
      lastMessage: `Payment details sent (${labels[type]})`,
      lastUpdated: serverTimestamp(), adminReplied: true
    });
    showToast(`${labels[type]} payment details sent`);
  } catch(err) { console.error(err); showToast('Error sending payment details'); }
}

async function sendReply() {

  clearTimeout(adminTypingTimeout);
  setAdminTyping(false);
  const replyInputEl = $('reply-input');
  const text = replyInputEl.value.trim();

  // Must have either text or a pasted image
  if (!text && pastedImages.length === 0) return;
  if (!state.activeChatId) return;

  replyInputEl.value = '';
  replyInputEl.style.height = 'auto';

  // ── Handle pasted images ────────────────────────────────
  if (pastedImages.length > 0) {
    const filesToSend = [...pastedImages];
    clearAllPastedImages();
    const sendBtn = $('reply-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '0.5'; }
    const count = filesToSend.length;
    showToast(`Uploading ${count} image${count > 1 ? 's' : ''}…`);
    try {
      const replyContext = replyingTo ? { msgId: replyingTo.msgId, text: replyingTo.text, sender: replyingTo.sender, senderName: replyingTo.senderName || 'Client' } : null;
      if (replyingTo) cancelReply();

      // Upload all images in parallel
      const urls = await Promise.all(filesToSend.map(async ({ file }) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', CLOUDINARY_PRESET);
        fd.append('folder', 'chat-images');
        const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.secure_url) throw new Error('No URL returned');
        return data.secure_url;
      }));

      // Send each image as its own message (only first gets caption + replyTo)
      for (let i = 0; i < urls.length; i++) {
        const imgPayload = {
          type: 'image', sender: 'admin', senderName: state.adminName,
          imageUrl: urls[i], timestamp: serverTimestamp(), seenByClient: false
        };
        if (i === 0 && text)         imgPayload.text    = text;
        if (i === 0 && replyContext) imgPayload.replyTo = replyContext;
        await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), imgPayload);
      }
      await updateDoc(doc(db, 'chats', state.activeChatId), {
        lastMessage: count > 1 ? `📷 ${count} images` : (text || '📷 Image'),
        lastUpdated: serverTimestamp(), adminReplied: true
      });
      showToast(count > 1 ? `${count} images sent!` : 'Image sent!');
    } catch (err) {
      console.error('Image upload failed:', err);
      showToast('Failed to upload image(s). Try again.');
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = ''; }
    }
    return;
  }

  // ── Handle text only ─────────────────────────────────────
  const payload = {
    text, sender: 'admin', senderName: state.adminName,
    type: 'text', timestamp: serverTimestamp(), seenByClient: false
  };

  if (replyingTo) {
    payload.replyTo = {
      msgId:      replyingTo.msgId,
      text:       replyingTo.text,
      sender:     replyingTo.sender,
      senderName: replyingTo.senderName || 'Client'
    };
    cancelReply();
  }

  try {
    await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), payload);
    await updateDoc(doc(db, 'chats', state.activeChatId), {
      lastMessage: text, lastUpdated: serverTimestamp(), adminReplied: true
    });
  } catch (err) { console.error(err); }
}

/* ── Notes ──────────────────────────────────────────────── */
export function initNotes() {
  $('notes-btn')?.addEventListener('click', () => {
    const open = $('notes-panel').classList.toggle('open');
    $('notes-btn').classList.toggle('active', open);
  });
  $('notes-save-btn')?.addEventListener('click', async () => {
    if (!state.activeChatId) return;
    await updateDoc(doc(db, 'chats', state.activeChatId), {
      adminNotes: $('notes-textarea').value.trim()
    });
    showToast('Notes saved');
  });
}

/* ── Upload / deliver track (Cloudinary) ────────────────── */
let selectedFile = null;

export function initUpload() {
  const uploadBtnEl    = $('upload-trigger');
  const uploadModal    = $('upload-modal');
  const dropZone       = $('drop-zone');
  const fileInput      = $('upload-file-input');
  const fileNameEl     = $('upload-file-name');
  const uploadProgress = $('upload-progress');
  const progressFill   = $('upload-progress-fill');
  const uploadSendBtn  = $('upload-send-btn');
  const cancelUpload   = $('cancel-upload');

  uploadBtnEl?.addEventListener('click', () => {
    if (!state.activeChatId) return showToast('Open a client chat first');
    openUploadModal();
  });

  function openUploadModal() {
    selectedFile = null;
    fileInput.value = '';
    fileNameEl.style.display = 'none';
    uploadProgress.style.display = 'none';
    progressFill.style.width = '0%';
    uploadSendBtn.disabled = true;
    uploadModal.classList.add('open');
  }

  cancelUpload?.addEventListener('click', () => uploadModal.classList.remove('open'));
  uploadModal?.addEventListener('click', e => { if (e.target === uploadModal) uploadModal.classList.remove('open'); });

  dropZone?.addEventListener('click', () => fileInput.click());
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) setUploadFile(f);
  });
  fileInput?.addEventListener('change', () => {
    if (fileInput.files[0]) setUploadFile(fileInput.files[0]);
  });

  function setUploadFile(file) {
    selectedFile = file;
    fileNameEl.style.display = 'flex';
    fileNameEl.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" style="width:13px;height:13px;flex-shrink:0;color:var(--teal-dim);">
        <path d="M3 8V5.5l5-2.5 5 2.5V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="8" cy="10" r="3" stroke="currentColor" stroke-width="1.4"/>
      </svg>
      <span>${escHtml(file.name)}</span>
      <small style="margin-left:auto;color:var(--ct-muted)">${(file.size / 1024 / 1024).toFixed(1)} MB</small>`;
    uploadSendBtn.disabled = false;
  }

  uploadSendBtn?.addEventListener('click', async () => {
    if (!selectedFile || !state.activeChatId) return;
    uploadSendBtn.disabled = true;
    uploadProgress.style.display = 'block';
    progressFill.style.width = '0%';

    const chatData   = state.allChats.find(c => c.id === state.activeChatId) || {};
    const versionNum = (chatData.trackVersionCount || 0) + 1;
    const version    = `v${versionNum}`;
    const trackName  = selectedFile.name.replace(/\.[^/.]+$/, '');

    try {
      // Upload to Cloudinary with XHR so we can track progress
      const fileUrl = await uploadToCloudinary(selectedFile, progressFill);

      await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), {
        type: 'track', sender: 'admin', senderName: state.adminName,
        trackName, fileName: selectedFile.name, fileUrl, version,
        timestamp: serverTimestamp(), seenByClient: false
      });
      await updateDoc(doc(db, 'chats', state.activeChatId), {
        lastMessage: `Track delivered: ${trackName} (${version})`,
        lastUpdated: serverTimestamp(),
        trackVersionCount: versionNum,
        status: 'delivered',
        adminReplied: true
      });
      await addDoc(collection(db, 'deliveries'), {
        chatId: state.activeChatId,
        clientName: chatData.clientName || 'Unknown',
        trackName, fileName: selectedFile.name, fileUrl, version,
        deliveredAt: serverTimestamp()
      });

      uploadModal.classList.remove('open');
      showToast(`${trackName} (${version}) delivered!`);
      loadDeliveries();

      showReceipt({
        clientName: chatData.clientName || 'Unknown',
        amount: null,
        description: `Track delivery: ${trackName} (${version})`,
        date: new Date().toLocaleDateString(),
        status: 'delivered',
        currency: '',
        isTrack: true,
        trackName,
        version
      });
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed — please try again');
      uploadSendBtn.disabled = false;
    }
  });
}

// Replace the old uploadToCloudinary function with this:
async function uploadToCloudinary(file, progressFill) {
  const res = await fetch("/.netlify/functions/cloudinary-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadType: "track" })
  });
  const { signature, timestamp, api_key, cloud_name, folder } = await res.json();

  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", api_key);
  formData.append("timestamp", timestamp);
  formData.append("signature", signature);
  formData.append("folder", folder);
  formData.append("resource_type", "auto");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud_name}/auto/upload`);

    xhr.upload.addEventListener("progress", e => {
      if (e.lengthComputable && progressFill) {
        progressFill.style.width = ((e.loaded / e.total) * 100) + "%";
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const json = JSON.parse(xhr.responseText);
        if (json.secure_url) resolve(json.secure_url);
        else reject(new Error("No URL in response"));
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.send(formData);
  });
}
/* ── Image lightbox (zoomable) ──────────────────────────── */
let lightboxEl = null;

function ensureLightbox() {
  if (lightboxEl) return lightboxEl;

  lightboxEl = document.createElement('div');
  lightboxEl.id = 'img-lightbox';
  lightboxEl.style.cssText = `
    position:fixed; inset:0; z-index:9999; display:none;
    align-items:center; justify-content:center;
    background:rgba(0,0,0,0.85); cursor:zoom-out;
  `;
  lightboxEl.innerHTML = `
    <button id="lightbox-close" style="
      position:absolute; top:16px; right:20px; width:36px; height:36px;
      border-radius:50%; background:rgba(255,255,255,0.1); border:none;
      color:#fff; font-size:20px; cursor:pointer; z-index:2;">&times;</button>
    <img id="lightbox-img" style="
      max-width:90vw; max-height:90vh; transform-origin:center center;
      transition:transform .15s ease-out; cursor:zoom-in; user-select:none;"
      draggable="false" />
  `;
  document.body.appendChild(lightboxEl);

  const imgEl      = lightboxEl.querySelector('#lightbox-img');
  const closeBtnEl = lightboxEl.querySelector('#lightbox-close');
  let scale = 1, originX = 0, originY = 0, isPanning = false, startX = 0, startY = 0;

  function applyTransform() {
    imgEl.style.transform = `translate(${originX}px, ${originY}px) scale(${scale})`;
    imgEl.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  }
  function resetZoom() { scale = 1; originX = 0; originY = 0; applyTransform(); }
  function closeLightbox() { lightboxEl.style.display = 'none'; resetZoom(); }

  closeBtnEl.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
  lightboxEl.addEventListener('click', e => { if (e.target === lightboxEl) closeLightbox(); });

  // Click image: toggle zoom in/out
  imgEl.addEventListener('click', e => {
    e.stopPropagation();
    scale === 1 ? (scale = 2, applyTransform()) : resetZoom();
  });

  // Scroll wheel zoom
  imgEl.addEventListener('wheel', e => {
    e.preventDefault();
    scale = Math.min(4, Math.max(1, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
    if (scale === 1) { originX = 0; originY = 0; }
    applyTransform();
  }, { passive: false });

  // Drag to pan when zoomed in
  imgEl.addEventListener('mousedown', e => {
    if (scale === 1) return;
    isPanning = true;
    startX = e.clientX - originX;
    startY = e.clientY - originY;
    imgEl.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    originX = e.clientX - startX;
    originY = e.clientY - startY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    if (scale > 1) imgEl.style.cursor = 'grab';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lightboxEl.style.display === 'flex') closeLightbox();
  });

  lightboxEl._imgEl = imgEl;
  lightboxEl._reset = resetZoom;
  return lightboxEl;
}

function openImageLightbox(url) {
  const lb = ensureLightbox();
  lb._reset();
  lb._imgEl.src = url;
  lb.style.display = 'flex';
}
function applyGroupedTimestamps() {
  const wraps = [...document.querySelectorAll('#messages-area .msg-wrap')];
  wraps.forEach((wrap, i) => {
    const timeEl = wrap.querySelector('.msg-time');
    if (!timeEl) return;
    const sender = wrap.classList.contains('admin') ? 'admin' : 'client';
    const nextWrap = wraps[i + 1];
    const nextSender = nextWrap
      ? (nextWrap.classList.contains('admin') ? 'admin' : 'client')
      : null;
    // Show timestamp only if next message is from a different sender (or this is the last message)
    timeEl.style.display = sender !== nextSender ? '' : 'none';
  });
}

function applyMessageGrouping() {
  const wraps = [...document.querySelectorAll('#messages-area .msg-wrap')];

  // Find the last admin message first
  let lastAdminWrap = null;
  wraps.forEach(wrap => {
    if (wrap.classList.contains('admin')) lastAdminWrap = wrap;
  });

  wraps.forEach((wrap, i) => {
    const sender = wrap.classList.contains('admin') ? 'admin' : 'client';
    const prevSender = i > 0
      ? (wraps[i-1].classList.contains('admin') ? 'admin' : 'client')
      : null;
    const nextSender = i < wraps.length - 1
      ? (wraps[i+1].classList.contains('admin') ? 'admin' : 'client')
      : null;

    const isFirst = sender !== prevSender;
    const isLast  = sender !== nextSender;

    wrap.classList.remove('group-first', 'group-last', 'group-middle', 'group-start', 'group-solo');

    if (isFirst && isLast)   wrap.classList.add('group-solo');
    else if (isFirst)        wrap.classList.add('group-first');
    else if (isLast)         wrap.classList.add('group-last');
    else                     wrap.classList.add('group-middle');

    if (isFirst) wrap.classList.add('group-start');

    const senderEl = wrap.querySelector('.msg-sender');
    if (senderEl) senderEl.style.display = isFirst ? '' : 'none';

    const avatarEl = wrap.querySelector('.msg-avatar, .msg-avatar-placeholder');
    if (avatarEl) avatarEl.style.visibility = isLast ? 'visible' : 'hidden';

    const timeEl = wrap.querySelector('.msg-time');
    if (timeEl) timeEl.style.display = isLast ? '' : 'none';

    const actionsEl = wrap.querySelector('.msg-actions');
    if (actionsEl) actionsEl.style.display = '';

    // ── Only show Seen/Delivered on the very last admin message ──
    if (wrap.classList.contains('admin')) {
      const seenEl = wrap.querySelector('.msg-seen, .msg-delivered');
      if (seenEl) seenEl.style.display = wrap === lastAdminWrap ? '' : 'none';
    }
  });
}
// ── Typing indicator — admin side ────────────────────
function setAdminTyping(isTyping) {
  if (!state.activeChatId) return;
  setDoc(doc(db, 'chats', state.activeChatId), { typingAdmin: isTyping }, { merge: true }).catch(() => {});
}

function showClientTypingBubble(visible) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  if (visible) {
    if (adminTypingBubble) return;
    adminTypingBubble = document.createElement('div');
    adminTypingBubble.id = 'client-typing-bubble';
    adminTypingBubble.className = 'msg-wrap client';// left-aligned
    adminTypingBubble.innerHTML = `
      <div class="chat-typing-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
    area.appendChild(adminTypingBubble);
    area.scrollTop = area.scrollHeight;
  } else {
    if (adminTypingBubble) { adminTypingBubble.remove(); adminTypingBubble = null; }
  }
}
export function clearAdminTyping() {
  if (unsubAdminTyping) { unsubAdminTyping(); unsubAdminTyping = null; }
  showClientTypingBubble(false);
  setAdminTyping(false);
}