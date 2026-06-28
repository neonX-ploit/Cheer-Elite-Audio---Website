// =====================================================
// chat.js — Firebase chat widget for Cheer Elite Audio
// =====================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc,
  onSnapshot, query, orderBy, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = str => String(str || '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Firebase config ──────────────────────────────────
const firebaseConfig = {
  apiKey:            window.__ENV__?.FIREBASE_API_KEY || '',
  authDomain:        window.__ENV__?.FIREBASE_AUTH_DOMAIN || '',
  projectId:         window.__ENV__?.FIREBASE_PROJECT_ID || '',
  storageBucket:     window.__ENV__?.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: window.__ENV__?.FIREBASE_MESSAGING_SENDER || '',
  appId:             window.__ENV__?.FIREBASE_APP_ID || '',
};

// ── Cloudinary config ─────────────────────────────────
const CLOUDINARY_CLOUD  = 'dz7oewy7z';
const CLOUDINARY_PRESET = 'Cheer Elite Audio - pproofs';

const app      = initializeApp(firebaseConfig, 'client-bubble-app');
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const ADMIN_EMAIL = 'cheereliteaudio.djnight@gmail.com';

// ── DOM refs ─────────────────────────────────────────
const launcher     = document.getElementById('cw-launcher');
const badgeEl      = document.getElementById('cw-badge');
const tooltip      = document.getElementById('cw-tooltip');
const overlay      = document.getElementById('chat-modal-overlay');
const modal        = document.getElementById('chat-modal');
const closeBtn     = document.getElementById('close-chat-modal');
const loadingEl    = document.getElementById('chat-loading');
const loginEl      = document.getElementById('chat-login');
const chatScreenEl = document.getElementById('chat-messages-screen');
const googleBtn    = document.getElementById('chat-google-btn');
const messagesArea = document.getElementById('chat-messages-area');
const emptyEl      = document.getElementById('chat-msg-empty');
const msgInput     = document.getElementById('chat-msg-input');
const sendBtn      = document.getElementById('chat-send-btn');

// ── State ─────────────────────────────────────────────
let chatId        = null;
let unsubMessages = null;
let currentUser   = null;
let isOpen        = false;
let unreadCount   = 0;

// ── Typing indicator state ────────────────────────────
let typingTimeout  = null;
let unsubTyping    = null;
let typingBubbleEl = null;

// ── Reply state ───────────────────────────────────────
let replyingTo = null; // { docId, text, senderName, isClient }
let currentChatDeletedAt = null;

// ── Message doc ID map (docId → DOM wrap element) ─────
// Used for scroll-to-quoted and reaction updates
const msgDomMap = new Map();  // docId → wrap element
const msgDataMap = new Map(); // docId → data snapshot

// ── Emoji picker state ────────────────────────────────
const EMOJI_LIST = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
let activeEmojiPicker = null; // currently open picker element

// ── Scroll-to-bottom button ────────────────────────────
let scrollBtnEl = null;

// ── Order form field styles ───────────────────────────
const fieldStyle = 'width:100%;padding:7px 10px;background:#0D1318;border:1px solid rgba(0,229,195,0.2);border-radius:7px;font-size:12.5px;color:#EEF4F7;font-family:Barlow,sans-serif;outline:none;box-sizing:border-box;';
const labelStyle = 'font-size:10px;color:rgba(238,244,247,0.5);font-weight:600;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:3px;';

// ── Tooltip auto-show ─────────────────────────────────
setTimeout(() => {
  tooltip.classList.add('show');
  setTimeout(() => tooltip.classList.remove('show'), 4000);
}, 3000);

// ── Open / close ──────────────────────────────────────
launcher.addEventListener('click', () => toggleModal(true));
closeBtn.addEventListener('click', () => toggleModal(false));
overlay.addEventListener('click', () => toggleModal(false));

function toggleModal(open) {
  isOpen = open;
  if (open) {
    document.body.style.overflow = 'hidden';
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      modal.classList.add('is-open');
      launcher.classList.add('chat-open');
    });
    if (chatId) {
      const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ getDocs }) => {
        getDocs(q).then(snap => {
          snap.docs.forEach(d => {
            if (d.data().sender === 'admin' && !d.data().seenByClient) {
              updateDoc(d.ref, { seenByClient: true }).catch(console.error);
            }
          });
        });
      });
    }
  } else {
    document.body.style.overflow = '';
    overlay.classList.remove('is-open');
    modal.classList.remove('is-open');
    launcher.classList.remove('chat-open');
    setTimeout(() => {
      if (!isOpen) {
        overlay.classList.add('hidden');
        modal.classList.add('hidden');
      }
    }, 240);
    closeEmojiPicker();
    cancelReply();
  }
  tooltip.classList.remove('show');
  if (open) {
    unreadCount = 0;
    badgeEl.style.display = 'none';
    scrollBottom();
    if (chatId) msgInput.focus();
  }
}

// ── Auth state ────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  loadingEl.classList.add('hidden');
  loadingEl.style.display = 'none';

  if (user) {
    if (user.email === ADMIN_EMAIL) {
      await signOut(auth);
      showAdminNotice();
      return;
    }
    currentUser = user;
    chatId = user.uid;
    showScreen('chat');
    initScrollBtn();
    subscribeMessages();
    initProofUpload();
    subscribeTyping();
  } else {
    currentUser = null;
    chatId = null;
    showScreen('login');
    resetGoogleBtn();
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }
    if (unsubTyping)   { unsubTyping();   unsubTyping   = null; }
    msgDomMap.clear();
    msgDataMap.clear();
  }
});

// ── Screen helpers ────────────────────────────────────
function showScreen(name) {
  loginEl.classList.remove('hidden');
  chatScreenEl.classList.remove('hidden');
  loginEl.style.display      = name === 'login' ? 'flex' : 'none';
  chatScreenEl.style.display = name === 'chat'  ? 'flex' : 'none';
}

function googleBtnMarkup() {
  return `<svg viewBox="0 0 48 48" width="18" height="18">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg> Continue with Google`;
}

function resetGoogleBtn() {
  googleBtn.disabled  = false;
  googleBtn.innerHTML = googleBtnMarkup();
}

function showAdminNotice() {
  showScreen('login');
  if (document.getElementById('chat-admin-notice')) return;
  const notice = document.createElement('p');
  notice.id = 'chat-admin-notice';
  notice.className = 'chat-admin-notice';
  notice.innerHTML = '⚠️ Admin accounts can\'t use this chat widget.';
  googleBtn.after(notice);
}

// ── Google sign-in ────────────────────────────────────
googleBtn.addEventListener('click', async () => {
  googleBtn.disabled    = true;
  googleBtn.textContent = 'Signing in…';
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error('Sign-in error:', err);
    resetGoogleBtn();
  }
});

async function ensureChatDocCreated(user) {
  const ref = doc(db, 'chats', chatId);
  await setDoc(ref, {
    clientName:  user.displayName || 'Client',
    clientEmail: user.email       || '',
    clientPhoto: user.photoURL    || '',
    clientUid:   user.uid,
    createdAt:   serverTimestamp(),
    lastMessage: '',
    lastUpdated: serverTimestamp(),
    unread:      0,
    archivedByAdmin: false,
  }, { merge: true });
}

// ══════════════════════════════════════════════════════
// FEATURE 1 & 2: Emoji reactions + Reply (with Firestore
// snapshot update so reactions render live from any sender)
// ══════════════════════════════════════════════════════

// ── Emoji picker ──────────────────────────────────────
function closeEmojiPicker() {
  if (activeEmojiPicker) {
    activeEmojiPicker.remove();
    activeEmojiPicker = null;
  }
}

function openEmojiPicker(wrap, docId) {
  closeEmojiPicker();

  const picker = document.createElement('div');
  picker.className = 'cw-emoji-picker';
  picker.style.cssText = `
    position:absolute; z-index:500;
    display:flex; gap:4px; padding:6px 8px;
    background:#1A2332; border:1px solid rgba(0,229,195,0.2);
    border-radius:24px; box-shadow:0 4px 20px rgba(0,0,0,0.5);
    animation: cw-pop .15s ease-out;
  `;

  EMOJI_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.style.cssText = 'font-size:18px;background:none;border:none;cursor:pointer;padding:2px 3px;border-radius:8px;transition:transform .1s;line-height:1;';
    btn.addEventListener('pointerover', () => { btn.style.transform = 'scale(1.3)'; });
    btn.addEventListener('pointerout',  () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleReaction(docId, emoji);
      closeEmojiPicker();
    });
    picker.appendChild(btn);
  });

  activeEmojiPicker = picker;

  // Position: attach to wrap, float above it
  // Client messages sit on the RIGHT → anchor picker to the right so it doesn't overflow
  // Admin messages sit on the LEFT  → anchor picker to the left
  wrap.style.position = 'relative';
  const isClient = wrap.classList.contains('client');
  picker.style.position = 'absolute';
  picker.style.bottom = 'calc(100% + 4px)';
  // Reset both sides first
  picker.style.left = 'auto';
  picker.style.right = 'auto';
  if (isClient) {
    picker.style.right = '0';
  } else {
    picker.style.left = '0';
  }
  wrap.appendChild(picker);

  // Close on outside click — hide bar too since mouse left the area
  setTimeout(() => {
    document.addEventListener('pointerdown', function handler(e) {
      if (!picker.contains(e.target) && !wrap.contains(e.target)) {
        closeEmojiPicker();
        // Also hide the action bar since the user clicked away
        const bar = wrap.querySelector('.cw-msg-actions');
        if (bar) bar.style.display = 'none';
        document.removeEventListener('pointerdown', handler);
      }
    });
  }, 10);
}

async function toggleReaction(docId, emoji) {
  if (!chatId || !docId) return;
  const msgRef = doc(db, 'chats', chatId, 'messages', docId);
  const snap   = await getDoc(msgRef);
  if (!snap.exists()) return;

  const reactions = snap.data().reactions || {};
  const who = 'client'; // client always reacts as 'client'

  // Toggle: if same emoji already set by client, remove it
  if (reactions[who] === emoji) {
    const updated = { ...reactions };
    delete updated[who];
    await updateDoc(msgRef, { reactions: updated });
  } else {
    await updateDoc(msgRef, { [`reactions.${who}`]: emoji });
  }
}

function renderReactions(reactionsObj, wrap, docId) {
  // Remove existing reaction row
  wrap.querySelector('.cw-reactions')?.remove();
  if (!reactionsObj || !Object.keys(reactionsObj).length) return;

  // Two possible formats from Firestore:
  //
  // CLIENT format: { "client": "❤️" }
  //   → key is a role name, value is an emoji string
  //
  // ADMIN format:  { "❤️": { "uid123": true } }
  //   → key IS the emoji, value is a map of voter UIDs
  //
  // Detect which format: emoji chars have codePoint > 127; role names are ASCII
  const firstKey = Object.keys(reactionsObj)[0] || '';
  const isAdminFormat = !!firstKey && firstKey.codePointAt(0) > 127;

  const counts = {};
  let clientEmoji = null;

  if (isAdminFormat) {
    // Admin format: { "❤️": { uid: true, ... } }
    Object.entries(reactionsObj).forEach(([emoji, voters]) => {
      if (!emoji || typeof voters !== 'object') return;
      const n = Object.keys(voters).length;
      if (n > 0) counts[emoji] = (counts[emoji] || 0) + n;
    });
  } else {
    // Client format: { "client": "❤️" }
    Object.entries(reactionsObj).forEach(([who, val]) => {
      if (!val) return;
      const emoji = (typeof val === 'object') ? (val.emoji || val.value || '') : String(val);
      if (!emoji) return;
      counts[emoji] = (counts[emoji] || 0) + 1;
      if (who === 'client') clientEmoji = emoji;
    });
  }

  if (!Object.keys(counts).length) return;

  const row = document.createElement('div');
  row.className = 'cw-reactions';
  row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;';

  const isClient = wrap.classList.contains('client');
  if (isClient) row.style.justifyContent = 'flex-end';

  Object.entries(counts).forEach(([emoji, count]) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.style.cssText = `
      display:flex;align-items:center;gap:3px;
      padding:2px 7px;border-radius:12px;font-size:12px;line-height:1.4;
      background:rgba(0,229,195,0.1);border:1px solid rgba(0,229,195,0.2);
      cursor:pointer;color:#EEF4F7;transition:background .15s;
    `;
    const myReaction = (clientEmoji === emoji);
    if (myReaction) {
      pill.style.background = 'rgba(0,229,195,0.2)';
      pill.style.borderColor = 'rgba(0,229,195,0.5)';
    }
    pill.innerHTML = `${emoji} <span style="font-size:11px;opacity:.8;">${count}</span>`;
    pill.addEventListener('click', () => toggleReaction(docId, emoji));
    row.appendChild(pill);
  });

  // Insert before the timestamp
  const ts = wrap.querySelector('.chat-msg-time');
  if (ts) wrap.insertBefore(row, ts);
  else wrap.appendChild(row);
}

// ── Reply ──────────────────────────────────────────────
function setReply(docId, data) {
  replyingTo = { docId, text: data.text || '', senderName: data.senderName || (data.sender === 'admin' ? 'Support' : 'You'), isClient: data.sender === 'client' };

  let bar = document.getElementById('cw-reply-preview-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'cw-reply-preview-bar';
    bar.style.cssText = `
      display:flex;align-items:center;gap:8px;
      padding:8px 12px;background:#111920;
      border-top:1px solid rgba(0,229,195,0.15);
      border-bottom:1px solid rgba(0,229,195,0.08);
      font-size:12px;color:#EEF4F7;
    `;
    const inputBar = document.getElementById('chat-input-bar');
    if (inputBar) inputBar.parentNode.insertBefore(bar, inputBar);
  }

  const previewText = replyingTo.text.length > 60 ? replyingTo.text.slice(0, 60) + '…' : replyingTo.text;
  bar.innerHTML = `
    <div style="width:3px;height:32px;background:#00E5C3;border-radius:2px;flex-shrink:0;"></div>
    <div style="flex:1;overflow:hidden;">
      <div style="font-size:10px;font-weight:700;color:#00E5C3;margin-bottom:2px;">${esc(replyingTo.senderName)}</div>
      <div style="font-size:12px;color:rgba(238,244,247,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${previewText || '📎 Attachment'}</div>
    </div>
    <button id="cw-reply-cancel" type="button" style="background:none;border:none;color:rgba(238,244,247,0.4);font-size:18px;cursor:pointer;padding:4px;line-height:1;">&times;</button>
  `;
  bar.querySelector('#cw-reply-cancel').addEventListener('click', cancelReply);
  msgInput.focus();
}

function cancelReply() {
  replyingTo = null;
  document.getElementById('cw-reply-preview-bar')?.remove();
}

// ══════════════════════════════════════════════════════
// FEATURE 3: Touch controls — swipe-right to reply,
// long-press to open emoji picker (Android-friendly)
// ══════════════════════════════════════════════════════
function attachTouchControls(wrap, docId, data) {
  // ── Long press → emoji picker ─────────────────────
  let holdTimer = null;
  let holdFired = false;

  const onHoldStart = e => {
    holdFired = false;
    holdTimer = setTimeout(() => {
      holdFired = true;
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(30);
      openEmojiPicker(wrap, docId);
    }, 480);
  };

  const onHoldEnd = () => {
    clearTimeout(holdTimer);
  };

  wrap.addEventListener('touchstart', onHoldStart, { passive: true });
  wrap.addEventListener('touchend',   onHoldEnd);
  wrap.addEventListener('touchmove',  onHoldEnd, { passive: true });

  // ── Swipe right → reply (only on text/simple bubbles) ─
  // Works for all message types — swipe reveals reply
  if (data.type !== 'order_form') {
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swiping = false;
    let swipeTriggered = false;
    const SWIPE_THRESHOLD = 60;
    const ANGLE_LIMIT     = 40; // degrees

    wrap.addEventListener('touchstart', e => {
      if (holdFired) return;
      swipeStartX    = e.touches[0].clientX;
      swipeStartY    = e.touches[0].clientY;
      swiping        = true;
      swipeTriggered = false;
    }, { passive: true });

    wrap.addEventListener('touchmove', e => {
      if (!swiping || holdFired) return;
      const dx    = e.touches[0].clientX - swipeStartX;
      const dy    = e.touches[0].clientY - swipeStartY;
      const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);

      // Only rightward swipes within a ~40° arc
      if (dx < 10 || angle > ANGLE_LIMIT) return;

      const pct = Math.min(dx / SWIPE_THRESHOLD, 1);
      wrap.style.transform = `translateX(${Math.min(dx * 0.4, 24)}px)`;
      wrap.style.transition = 'none';

      if (dx >= SWIPE_THRESHOLD && !swipeTriggered) {
        swipeTriggered = true;
        if (navigator.vibrate) navigator.vibrate(20);
        // Snap back
        wrap.style.transform = '';
        wrap.style.transition = 'transform .25s ease-out';
        // Only reply on text messages
        if (!data.type || data.type === 'text') {
          setReply(docId, data);
        }
      }
    }, { passive: true });

    wrap.addEventListener('touchend', () => {
      swiping = false;
      wrap.style.transform = '';
      wrap.style.transition = 'transform .25s ease-out';
      setTimeout(() => { wrap.style.transition = ''; }, 260);
    }, { passive: true });
  }

  // ── Desktop hover: show reply + react buttons ──────
  // (only visible on non-touch devices via CSS)
  const isClient = wrap.classList.contains('client');

  // ── Invisible hover bridge — fills the gap between bubble and action pill ──
  const bridge = document.createElement('div');
  bridge.style.cssText = `
    position:absolute; top:0; bottom:0; width:14px;
    ${isClient ? 'right:100%;' : 'left:100%;'}
    z-index:9;
  `;

  // ── Pill container — both buttons in one capsule, no gap to cross ──────────
  const actionBar = document.createElement('div');
  actionBar.className = 'cw-msg-actions';
  actionBar.style.cssText = `
    display:none; align-items:center;
    position:absolute; top:50%; transform:translateY(-50%);
    width:max-content;
    background:#1C2A3A;
    border:1px solid rgba(255,255,255,0.08);
    border-radius:20px;
    overflow:hidden;
    box-shadow:0 2px 10px rgba(0,0,0,0.35);
  `;
  // Client → pill sits to the left of bubble; Admin → sits to the right
  actionBar.style[isClient ? 'right' : 'left'] = 'calc(100% + 10px)';

  const btnBase = 'width:32px;height:32px;background:none;border:none;color:rgba(238,244,247,0.7);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;';
  const divider = '<div style="width:1px;height:16px;background:rgba(255,255,255,0.08);flex-shrink:0;"></div>';

  // React button — SVG smiley outline (matching admin style)
  const reactBtn = document.createElement('button');
  reactBtn.type = 'button';
  reactBtn.title = 'React';
  reactBtn.style.cssText = btnBase;
  reactBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" width="15" height="15" stroke="currentColor" stroke-width="1.5">
    <circle cx="10" cy="10" r="7.5"/>
    <path d="M7 11.5s.8 1.5 3 1.5 3-1.5 3-1.5" stroke-linecap="round"/>
    <circle cx="7.8" cy="8.5" r=".6" fill="currentColor" stroke="none"/>
    <circle cx="12.2" cy="8.5" r=".6" fill="currentColor" stroke="none"/>
  </svg>`;
  reactBtn.addEventListener('pointerover', () => { reactBtn.style.background = 'rgba(255,255,255,0.06)'; reactBtn.style.color = '#EEF4F7'; });
  reactBtn.addEventListener('pointerout',  () => { reactBtn.style.background = 'none'; reactBtn.style.color = 'rgba(238,244,247,0.7)'; });
  reactBtn.addEventListener('click', e => { e.stopPropagation(); openEmojiPicker(wrap, docId); });

  // Reply button (only for text messages)
  if (!data.type || data.type === 'text') {
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.title = 'Reply';
    replyBtn.style.cssText = btnBase;
    replyBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" width="14" height="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10l4-4v2.5h4a4 4 0 014 4v.5a4 4 0 01-4-3.5H7V12L3 10z" fill="currentColor" stroke="none"/>
    </svg>`;
    replyBtn.addEventListener('pointerover', () => { replyBtn.style.background = 'rgba(255,255,255,0.06)'; replyBtn.style.color = '#EEF4F7'; });
    replyBtn.addEventListener('pointerout',  () => { replyBtn.style.background = 'none'; replyBtn.style.color = 'rgba(238,244,247,0.7)'; });
    replyBtn.addEventListener('click', e => { e.stopPropagation(); setReply(docId, data); });

    // Order: emoji | divider | reply  (or reply | divider | emoji depending on side)
    if (isClient) {
      actionBar.appendChild(replyBtn);
      actionBar.insertAdjacentHTML('beforeend', divider);
      actionBar.appendChild(reactBtn);
    } else {
      actionBar.appendChild(reactBtn);
      actionBar.insertAdjacentHTML('beforeend', divider);
      actionBar.appendChild(replyBtn);
    }
  } else {
    actionBar.appendChild(reactBtn);
  }

  wrap.style.position = 'relative';
  wrap.appendChild(bridge);
  wrap.appendChild(actionBar);

  const showBar = () => { actionBar.style.display = 'flex'; bridge.style.display = 'block'; };
  const hideBar = (e) => {
    // Don't hide if the mouse is moving into the emoji picker
    if (activeEmojiPicker && activeEmojiPicker.contains(e.relatedTarget)) return;
    // Don't hide if moving between wrap, bridge, and actionBar
    const related = e.relatedTarget;
    if (wrap.contains(related) || actionBar.contains(related) || bridge.contains(related)) return;
    // Don't hide if the emoji picker is currently open (user is interacting with it)
    if (activeEmojiPicker) return;
    actionBar.style.display = 'none';
    bridge.style.display = 'none';
  };

  wrap.addEventListener('mouseenter', showBar);
  wrap.addEventListener('mouseleave', hideBar);
  actionBar.addEventListener('mouseenter', showBar);
  actionBar.addEventListener('mouseleave', hideBar);
  bridge.addEventListener('mouseenter', showBar);
  bridge.addEventListener('mouseleave', hideBar);
}

// ══════════════════════════════════════════════════════
// FEATURE 4: Scroll-to-bottom button
// ══════════════════════════════════════════════════════
function initScrollBtn() {
  if (scrollBtnEl) return;

  scrollBtnEl = document.createElement('button');
  scrollBtnEl.id = 'cw-scroll-btn';
  scrollBtnEl.type = 'button';
  scrollBtnEl.style.cssText = `
    position:absolute; bottom:72px; right:12px; z-index:50;
    width:34px; height:34px; border-radius:50%;
    background:#1A2332; border:1px solid rgba(0,229,195,0.3);
    color:#00E5C3; cursor:pointer; display:none;
    align-items:center; justify-content:center;
    box-shadow:0 2px 12px rgba(0,0,0,0.4);
    transition:opacity .2s, transform .2s;
  `;
  scrollBtnEl.innerHTML = `<svg viewBox="0 0 20 20" fill="none" width="14" height="14"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  scrollBtnEl.addEventListener('click', scrollBottom);

  // Place inside the chat modal (relative positioned parent)
  const chatScreen = document.getElementById('chat-messages-screen');
  if (chatScreen) {
    chatScreen.style.position = 'relative';
    chatScreen.appendChild(scrollBtnEl);
  }

  // Show/hide based on scroll position
  messagesArea.addEventListener('scroll', () => {
    const distFromBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight;
    const show = distFromBottom > 80;
    scrollBtnEl.style.display = show ? 'flex' : 'none';
    if (show) {
      scrollBtnEl.style.opacity = '1';
      scrollBtnEl.style.transform = 'translateY(0)';
    }
  });
}
function applyClientGrouping() {
  const wraps = [...messagesArea.querySelectorAll('.chat-msg-wrap')];
  wraps.forEach((wrap, i) => {
    const sender = wrap.classList.contains('client') ? 'client' : 'admin';
    const prev = wraps[i - 1];
    const next = wraps[i + 1];
    const prevSender = prev ? (prev.classList.contains('client') ? 'client' : 'admin') : null;
    const nextSender = next ? (next.classList.contains('client') ? 'client' : 'admin') : null;

    const isFirst = sender !== prevSender;
    const isLast  = sender !== nextSender;

    wrap.classList.remove('group-solo', 'group-first', 'group-middle', 'group-last');
    if (isFirst && isLast)  wrap.classList.add('group-solo');
    else if (isFirst)       wrap.classList.add('group-first');
    else if (isLast)        wrap.classList.add('group-last');
    else                    wrap.classList.add('group-middle');
  });
}
// ══════════════════════════════════════════════════════
// FEATURE 5: Real-time messages — now stores docId,
// handles reaction updates via 'modified' changes,
// and handles image rendering fix
// ══════════════════════════════════════════════════════
function subscribeMessages() {
  if (unsubMessages) unsubMessages();
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  unsubMessages = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const docId = ch.doc.id;
      const data  = ch.doc.data();

      // Skip messages sent before admin deleted the conversation
      if (ch.type === 'added' && data.timestamp && currentChatDeletedAt) {
        if (data.timestamp.toMillis() < currentChatDeletedAt) return;
      }

      if (ch.type === 'added') {
        msgDataMap.set(docId, data);
        const wrap = renderBubble(data, docId);
        msgDomMap.set(docId, wrap);

        if (!isOpen && data.sender === 'admin') {
          unreadCount++;
          badgeEl.style.display = 'flex';
          badgeEl.textContent   = unreadCount > 9 ? '9+' : unreadCount;
        }
      }

      if (ch.type === 'modified') {
        const prev = msgDataMap.get(docId);
        msgDataMap.set(docId, data);
        const wrap = msgDomMap.get(docId);
        if (wrap) {
          // Use the incoming reactions if present; fall back to prev so that
          // a seenByClient write (which never touches reactions) doesn't wipe
          // the reaction pills that are already rendered.
          const newReactions  = data.reactions;
          const prevReactions = prev ? prev.reactions : undefined;
          const toRender = (newReactions !== undefined) ? newReactions : prevReactions;
          if (toRender && Object.keys(toRender).length > 0) {
            renderReactions(toRender, wrap, docId);
          } else if (newReactions !== undefined) {
            // Reactions were explicitly cleared — remove the pill row
            wrap.querySelector('.cw-reactions')?.remove();
          }
        }
      }
    });

    if (isOpen) {
      const adminMsgs = snap.docs.filter(d => d.data().sender === 'admin' && !d.data().seenByClient);
      if (adminMsgs.length > 0) {
        adminMsgs.forEach(d => {
          updateDoc(d.ref, { seenByClient: true }).catch(console.error);
        });
      }
    }

    if (snap.docChanges().some(ch => ch.type === 'added')) {
      applyClientGrouping();
      scrollBottom();
    }
  });
}

// ══════════════════════════════════════════════════════
// FEATURE 6 (fix): image_url field fallback so admin-sent
// images (stored as imageUrl OR image_url) always render
// ══════════════════════════════════════════════════════

// ── Image lightbox (zoomable) ──────────────────────────
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
  function resetZoom()    { scale = 1; originX = 0; originY = 0; applyTransform(); }
  function closeLightbox(){ lightboxEl.style.display = 'none'; resetZoom(); }

  closeBtnEl.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
  lightboxEl.addEventListener('click', e => { if (e.target === lightboxEl) closeLightbox(); });

  imgEl.addEventListener('click', e => {
    e.stopPropagation();
    scale === 1 ? (scale = 2, applyTransform()) : resetZoom();
  });

  imgEl.addEventListener('wheel', e => {
    e.preventDefault();
    scale = Math.min(4, Math.max(1, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
    if (scale === 1) { originX = 0; originY = 0; }
    applyTransform();
  }, { passive: false });

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

// ── Render a single message bubble ───────────────────
function renderBubble(data, docId) {
  if (emptyEl && emptyEl.parentNode) emptyEl.remove();

  const isClient = data.sender === 'client';
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg-wrap ' + (isClient ? 'client' : 'admin');
  if (docId) wrap.dataset.msgId = docId;

  // ── FEATURE 5: Reply preview inside bubble ─────────
  if (data.replyTo && data.replyTo.docId) {
    const rp = document.createElement('div');
    rp.className = 'cw-reply-quote';
    rp.style.cssText = `
      display:flex;align-items:stretch;gap:8px;
      background:rgba(0,0,0,0.25);border-radius:8px;
      padding:6px 10px;margin-bottom:6px;cursor:pointer;
      border-left:3px solid #00E5C3;max-width:100%;overflow:hidden;
    `;
    const quotedText = (data.replyTo.text || '').length > 80
      ? data.replyTo.text.slice(0, 80) + '…'
      : (data.replyTo.text || '📎 Attachment');
    rp.innerHTML = `
      <div style="overflow:hidden;">
        <div style="font-size:10px;font-weight:700;color:#00E5C3;margin-bottom:2px;">${esc(data.replyTo.senderName) || 'Message'}</div>
        <div style="font-size:12px;color:rgba(238,244,247,0.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(quotedText)}</div>
      </div>
    `;
    // FEATURE 5b: Tap to scroll to the original message
    rp.addEventListener('click', () => {
      const target = msgDomMap.get(data.replyTo.docId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash highlight
        target.style.transition = 'background .2s';
        target.style.background = 'rgba(0,229,195,0.08)';
        setTimeout(() => { target.style.background = ''; }, 1000);
      }
    });
    wrap.appendChild(rp);
  }

  if (data.type === 'order_form' && !isClient) {
    const formWrap = document.createElement('div');
    formWrap.style.cssText = 'background:#111920;border:1px solid rgba(0,229,195,0.15);border-radius:14px;padding:16px;max-width:300px;';

    const isUS = data.orderType === 'US';
    const alreadySubmitted = data.formSubmitted;

    formWrap.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#00E5C3;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;">
        Order Form · Mix ${esc(data.orderNumber)}
      </div>
      ${alreadySubmitted ? `<div style="font-size:13px;color:#00E5C3;font-weight:600;">Form submitted!</div>` : `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${isUS ? `<div><label style="font-size:10px;color:rgba(238,244,247,0.5);font-weight:600;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:3px;">Organization Name *</label>
          <input data-field="Organization Name" style="${fieldStyle}" placeholder="e.g. Thunder Athletics" /></div>` : ''}
        <div><label style="${labelStyle}">Team Name *</label>
          <input data-field="Team Name" style="${fieldStyle}" placeholder="e.g. Thunder Squad" /></div>
        <div><label style="${labelStyle}">Coach Name *</label>
          <input data-field="Coach Name" style="${fieldStyle}" placeholder="e.g. Coach Sarah" /></div>
        <div><label style="${labelStyle}">Email Address *</label>
          <input data-field="Email Address" type="email" style="${fieldStyle}" placeholder="coach@email.com" /></div>
        <div><label style="${labelStyle}">Country/Location <span style="opacity:.5;">(Optional)</span></label>
          <input data-field="Country/Location" style="${fieldStyle}" placeholder="e.g. Texas, USA" /></div>
        <div><label style="${labelStyle}">${isUS ? 'Music List' : 'Music List / Song Suggestions'} *</label>
          <textarea data-field="${isUS ? 'Music List' : 'Music List / Song Suggestions'}" style="${fieldStyle}min-height:70px;resize:vertical;" placeholder="List your songs here..."></textarea></div>
        <div><label style="${labelStyle}">${isUS ? 'Song Suggestion' : 'Voice Over Suggestions'}</label>
          ${isUS
            ? `<textarea data-field="Song Suggestion" style="${fieldStyle}min-height:60px;resize:vertical;" placeholder="Leave blank if you want a custom track exclusively made for your team ✨"></textarea>`
            : `<textarea data-field="Voice Over Suggestions" style="${fieldStyle}min-height:60px;resize:vertical;" placeholder="Any voice over ideas?"></textarea>`}
        </div>
        ${isUS ? `<div><label style="${labelStyle}">Voice Over Suggestions</label>
          <textarea data-field="Voice Over Suggestions" style="${fieldStyle}min-height:60px;resize:vertical;" placeholder="Any voice over ideas?"></textarea></div>` : ''}
        <div><label style="${labelStyle}">Do you have a theme? ${!isUS ? '<span style="opacity:.5;">(put N/A if none)</span>' : ''}</label>
          <input data-field="Theme" style="${fieldStyle}" placeholder="${isUS ? 'e.g. Dark, Energetic...' : 'e.g. Dark, Energetic... or N/A'}" /></div>
        ${!isUS ? `<div><label style="${labelStyle}">Music Duration *</label>
          <select data-field="Music Duration" style="${fieldStyle}">
            <option value="">Select duration...</option>
            <option value="1:00">1:00</option>
            <option value="2:00">2:00</option>
            <option value="3:00">3:00</option>
            <option value="4:00">4:00</option>
            <option value="5:00">5:00</option>
            <option value="Custom">Custom Duration</option>
          </select></div>` : ''}
        <button class="submit-order-form-btn" data-order-id="${data.orderId}" data-order-type="${data.orderType}"
          style="width:100%;padding:10px;background:linear-gradient(135deg,#00E5C3,#00C2E0);color:#0C1117;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;">
          Submit Order
        </button>
      </div>`}
    `;

    wrap.appendChild(formWrap);

    const ts2 = document.createElement('div');
    ts2.className = 'chat-msg-time';
    ts2.textContent = data.timestamp ? fmtTime(data.timestamp.toDate()) : 'Just now';
    wrap.appendChild(ts2);

    if (!alreadySubmitted) {
      formWrap.querySelector('.submit-order-form-btn')?.addEventListener('click', async () => {
        const inputs = formWrap.querySelectorAll('[data-field]');
        const formData = {};
        let valid = true;
        inputs.forEach(inp => {
          const val   = inp.value.trim();
          const field = inp.dataset.field;
          const required = !['Country/Location','Song Suggestion','Voice Over Suggestions','Theme'].includes(field);
          if (required && !val) { inp.style.borderColor = '#EF4444'; valid = false; }
          else { inp.style.borderColor = 'rgba(0,229,195,0.2)'; }
          formData[field] = val;
        });
        if (!valid) return;

        let autoPrice = null;
        if (data.orderType === 'PH') {
          if (formData['Music Duration'] === '5:00') autoPrice = 2700;
          else if (formData['Music Duration'] === '4:00') autoPrice = 2500;
        }

        await updateDoc(doc(db, 'orders', data.orderId), {
          formData,
          status: 'submitted',
          submittedAt: serverTimestamp(),
          ...(autoPrice ? { price: autoPrice } : {})
        });
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          type: 'text', sender: 'client',
          senderName: currentUser.displayName || 'Client',
          text: 'I\'ve submitted my order form!',
          timestamp: serverTimestamp()
        });
        await updateDoc(doc(db, 'chats', chatId), {
          lastMessage: 'Order form submitted!',
          lastUpdated: serverTimestamp(), unread: 1
        });

        formWrap.innerHTML = `
          <div style="font-size:11px;font-weight:700;color:#00E5C3;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Order Form · Mix ${data.orderNumber}</div>
          <div style="font-size:13px;color:#00E5C3;font-weight:600;">Form submitted! We'll review it shortly.</div>
        `;
      });
    }

  } else if (data.type === 'payment-details' && !isClient) {
    const method = data.paymentType || 'both';
    const card = document.createElement('div');
    card.style.cssText = 'background:#111920;border:1px solid rgba(0,229,195,0.15);border-radius:14px;padding:16px;max-width:300px;display:flex;flex-direction:column;gap:12px;';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;font-weight:700;color:#00E5C3;text-transform:uppercase;letter-spacing:.5px;';
    header.textContent = '💳 Payment Details';
    card.appendChild(header);

    const pRowStyle = 'display:flex;align-items:center;gap:10px;background:#0D1318;border:1px solid rgba(0,229,195,0.12);border-radius:10px;padding:10px 12px;';
    const pLblStyle = 'font-size:10px;color:rgba(238,244,247,0.45);text-transform:uppercase;letter-spacing:.4px;font-weight:600;margin-bottom:2px;';
    const pValStyle = 'font-size:13px;color:#EEF4F7;font-weight:600;';
    const pSubStyle = 'font-size:11px;color:rgba(238,244,247,0.55);margin-top:1px;';

    if (method === 'gcash' || method === 'both') {
      const row = document.createElement('div');
      row.style.cssText = pRowStyle;
      row.innerHTML = `
        <div style="width:32px;height:32px;border-radius:8px;background:#0078FF;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24" fill="#fff" width="16" height="16"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
        </div>
        <div>
          <div style="${pLblStyle}">GCash</div>
          <div style="${pValStyle}">0969 912 9277</div>
          <div style="${pSubStyle}">Kurt Russel Añora</div>
        </div>`;
      card.appendChild(row);
    }

    if (method === 'paypal' || method === 'both') {
      const row = document.createElement('div');
      row.style.cssText = pRowStyle;
      row.innerHTML = `
        <div style="width:32px;height:32px;border-radius:8px;background:#003087;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24" fill="#fff" width="16" height="16"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
        </div>
        <div>
          <div style="${pLblStyle}">PayPal</div>
          <div style="${pValStyle}">paypal.me/iamkurtme</div>
          <div style="${pSubStyle}">Send as Friends & Family</div>
        </div>`;
      card.appendChild(row);
    }

    if (data.amount) {
      const amtRow = document.createElement('div');
      amtRow.style.cssText = 'border-top:1px solid rgba(0,229,195,0.1);padding-top:10px;display:flex;justify-content:space-between;align-items:center;';
      amtRow.innerHTML = `
        <span style="font-size:11px;color:rgba(238,244,247,0.45);font-weight:600;text-transform:uppercase;letter-spacing:.4px;">Amount Due</span>
        <span style="font-size:15px;font-weight:700;color:#00E5C3;">${data.currency === 'PHP' ? '₱' : '$'}${parseFloat(data.amount).toFixed(2)}</span>`;
      card.appendChild(amtRow);
    }

    wrap.appendChild(card);
    const ts = document.createElement('div');
    ts.className = 'chat-msg-time';
    ts.textContent = data.timestamp ? fmtTime(data.timestamp.toDate()) : 'Just now';
    wrap.appendChild(ts);

  } else if (data.type === 'track' && !isClient) {
    const card = document.createElement('div');
    card.style.cssText = 'background:#111920;border:1px solid rgba(0,229,195,0.15);border-radius:14px;padding:14px;max-width:300px;display:flex;flex-direction:column;gap:10px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#00E5C3;';
    header.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" width="13" height="13" style="flex-shrink:0;">
        <path d="M5 13V5.5l8-2V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="4" cy="13" r="1.5" fill="currentColor"/>
        <circle cx="12" cy="11" r="1.5" fill="currentColor"/>
      </svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(data.trackName) || 'Track'}</span>
      <span style="font-size:10px;background:rgba(0,229,195,0.15);color:#00E5C3;padding:2px 6px;border-radius:6px;font-weight:700;flex-shrink:0;">${data.version || 'v1'}</span>
    `;
    card.appendChild(header);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:rgba(238,244,247,0.5);';
    meta.textContent = `${data.fileName || ''} · Tap to preview`;
    card.appendChild(meta);

    const playerRow = document.createElement('div');
    playerRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    playerRow.innerHTML = `
      <button type="button" class="chat-track-play-btn" style="width:32px;height:32px;border-radius:50%;background:#00E5C3;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>
      </button>
      <div style="flex:1;height:4px;background:rgba(0,229,195,0.15);border-radius:2px;overflow:hidden;">
        <div class="chat-track-progress-fill" style="height:100%;width:0%;background:#00E5C3;"></div>
      </div>
      <span class="chat-track-time" style="font-size:11px;color:rgba(238,244,247,0.5);min-width:32px;flex-shrink:0;">0:00</span>
    `;
    card.appendChild(playerRow);

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;width:100%;background:#0D1318;border:1px solid rgba(0,229,195,0.15);border-radius:8px;color:#00E5C3;font-size:11px;font-weight:600;cursor:pointer;';
    dl.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 2v9M5 8l3 3 3-3M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Download`;
    dl.addEventListener('click', () => downloadTrackFile(data.fileUrl, data.fileName || 'track'));
    card.appendChild(dl);

    wrap.appendChild(card);
    const ts4 = document.createElement('div');
    ts4.className = 'chat-msg-time';
    ts4.textContent = data.timestamp ? fmtTime(data.timestamp.toDate()) : 'Just now';
    wrap.appendChild(ts4);

    const playBtn = playerRow.querySelector('.chat-track-play-btn');
    const fill    = playerRow.querySelector('.chat-track-progress-fill');
    const timeEl  = playerRow.querySelector('.chat-track-time');
    let audio = null;
    playBtn.addEventListener('click', () => {
      if (!audio) {
        audio = new Audio(data.fileUrl);
        audio.addEventListener('timeupdate', () => {
          const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
          fill.style.width = pct + '%';
          timeEl.textContent = fmtAudioTime(audio.currentTime);
        });
        audio.addEventListener('ended', () => {
          fill.style.width = '0%';
          timeEl.textContent = '0:00';
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>`;
          audio = null;
        });
        audio.play();
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#0C1117"/></svg>`;
      } else if (audio.paused) {
        audio.play();
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#0C1117"/></svg>`;
      } else {
        audio.pause();
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="#0C1117"/></svg>`;
      }
    });

  } else if (data.type === 'payment_proof') {
    // Supports both imageUrl (client upload) and image_url (admin panel field name)
    const imgUrl = data.imageUrl || data.image_url || '';

    if (imgUrl) {
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'max-width:220px;min-height:80px;border-radius:12px;border:1px solid rgba(0,229,195,0.2);background:#111920;display:flex;align-items:center;justify-content:center;overflow:hidden;';

      const img = document.createElement('img');
      img.alt = 'Payment proof';
      img.style.cssText = 'max-width:220px;width:100%;border-radius:12px;display:block;cursor:zoom-in;';
      img.src = imgUrl;
      img.addEventListener('click', () => openImageLightbox(imgUrl));
      img.addEventListener('contextmenu', e => e.preventDefault()); // ← ADD
      img.setAttribute('draggable', 'false');                        // ← ADD
      img.style.userSelect = 'none';                                 // ← ADD
      img.style.webkitUserSelect = 'none';                           // ← ADD
      img.addEventListener('load',  () => { imgWrap.style.minHeight = ''; imgWrap.style.background = ''; });
      img.addEventListener('error', () => {
        imgWrap.innerHTML = '<span style="font-size:11px;color:rgba(238,244,247,0.4);padding:12px;">⚠️ Image failed to load</span>';
      });

      imgWrap.appendChild(img);
      wrap.appendChild(imgWrap);
    } else {
      // No URL at all — show a placeholder
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'max-width:220px;padding:12px 16px;border-radius:12px;border:1px solid rgba(0,229,195,0.2);background:#111920;font-size:11px;color:rgba(238,244,247,0.4);';
      placeholder.textContent = '📎 Image attachment';
      wrap.appendChild(placeholder);
    }

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:rgba(238,244,247,0.45);margin-top:4px;';
    label.textContent = isClient ? 'Payment proof' : 'Image';
    wrap.appendChild(label);

    const ts = document.createElement('div');
    ts.className = 'chat-msg-time';
    ts.textContent = data.timestamp ? fmtTime(data.timestamp.toDate()) : 'Just now';
    wrap.appendChild(ts);

  } else if (data.type === 'image') {
    // Admin-sent image (type: 'image', stored as imageUrl or image_url)
    const imgUrl = data.imageUrl || data.image_url || data.url || '';

    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = 'max-width:220px;min-height:80px;border-radius:12px;border:1px solid rgba(0,229,195,0.2);background:#111920;display:flex;align-items:center;justify-content:center;overflow:hidden;';

    if (imgUrl) {
      const img = document.createElement('img');
      img.alt = 'Image';
      img.style.cssText = 'max-width:220px;width:100%;border-radius:12px;display:block;cursor:zoom-in;';
      img.src = imgUrl;
      img.addEventListener('click', () => openImageLightbox(imgUrl));
      img.addEventListener('contextmenu', e => e.preventDefault()); // ← ADD
      img.setAttribute('draggable', 'false');                        // ← ADD
      img.style.userSelect = 'none';                                 // ← ADD
      img.style.webkitUserSelect = 'none';                           // ← ADD
      img.addEventListener('load',  () => { imgWrap.style.minHeight = ''; imgWrap.style.background = ''; });
      img.addEventListener('error', () => {
        imgWrap.innerHTML = '<span style="font-size:11px;color:rgba(238,244,247,0.4);padding:12px;">⚠️ Image failed to load</span>';
      });
      imgWrap.appendChild(img);
    } else {
      imgWrap.innerHTML = '<span style="font-size:11px;color:rgba(238,244,247,0.4);padding:12px;">📎 Image attachment</span>';
    }

    wrap.appendChild(imgWrap);

    const ts = document.createElement('div');
    ts.className = 'chat-msg-time';
    ts.textContent = data.timestamp ? fmtTime(data.timestamp.toDate()) : 'Just now';
    wrap.appendChild(ts);

  } else {
      // Default text bubble
      if (!isClient) {
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:10px;font-weight:700;color:#00E5C3;margin-bottom:3px;';
        nameEl.textContent = data.senderName && data.senderName !== 'Support'
          ? data.senderName
          : 'Cheer Elite Audio';
        wrap.appendChild(nameEl);
      }
      const bubble = document.createElement('div');
      bubble.className = 'chat-msg-bubble';
      bubble.textContent = data.text || '';
      wrap.appendChild(bubble);
  }

  // Render any existing reactions
  if (data.reactions && Object.keys(data.reactions).length) {
    renderReactions(data.reactions, wrap, docId);
  }

  // Attach touch + hover controls (emoji + reply)
  if (docId) attachTouchControls(wrap, docId, data);

  messagesArea.appendChild(wrap);
  return wrap;
}

// ── Proof of payment upload ───────────────────────────
function initProofUpload() {
  const inputBar = document.getElementById('chat-input-bar');
  if (!inputBar || document.getElementById('chat-proof-btn')) return;

  const proofBtn = document.createElement('button');
  proofBtn.id = 'chat-proof-btn';
  proofBtn.title = 'Send payment proof';
  proofBtn.style.cssText = 'width:36px;height:36px;background:#111920;border:1px solid rgba(0,229,195,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .2s;';
  proofBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="#00E5C3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="17 8 12 3 7 8" stroke="#00E5C3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="12" y1="3" x2="12" y2="15" stroke="#00E5C3" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.id = 'chat-proof-input';

  inputBar.insertBefore(proofBtn, inputBar.firstChild);
  inputBar.appendChild(fileInput);

  proofBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !chatId || !currentUser) return;
    fileInput.value = '';
    proofBtn.disabled = true;
    proofBtn.style.opacity = '0.5';

    try {
      const credsRes = await fetch("/.netlify/functions/cloudinary-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadType: "proof" })
      });
      const { signature, timestamp, api_key, cloud_name, folder } = await credsRes.json();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", api_key);
      formData.append("timestamp", timestamp);
      formData.append("signature", signature);
      formData.append("folder", folder);

      const res  = await fetch(`https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`, {
        method: "POST",
        body: formData
      });
      const json = await res.json();
      if (!json.secure_url) throw new Error('Upload failed');

      await ensureChatDocCreated(currentUser);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        type:        'payment_proof',
        sender:      'client',
        senderName:  currentUser.displayName || 'Client',
        senderPhoto: currentUser.photoURL    || '',
        imageUrl:    json.secure_url,
        timestamp:   serverTimestamp()
      });
      await updateDoc(doc(db, 'chats', chatId), {
        lastMessage: '📎 Payment proof sent',
        lastUpdated: serverTimestamp(),
        unread: 1
      });
    } catch (err) {
      console.error('Proof upload error:', err);
      alert('Upload failed. Please try again.');
    } finally {
      proofBtn.disabled = false;
      proofBtn.style.opacity = '1';
    }
  });
}

// ── Send message ──────────────────────────────────────
sendBtn.addEventListener('click', sendMsg);
msgInput.addEventListener('keydown', e => {
  // Enter sends, Shift+Enter adds newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
});
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px';

  if (chatId) {
    setClientTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setClientTyping(false), 2000);
  }
});

async function sendMsg() {
  const text = msgInput.value.trim();
  if (!text || !chatId || !currentUser) return;
  msgInput.value = '';
  msgInput.style.height = 'auto';
  clearTimeout(typingTimeout);
  setClientTyping(false);

  // Capture and clear reply state before the async write
  const reply = replyingTo ? { ...replyingTo } : null;
  cancelReply();

  try {
    await ensureChatDocCreated(currentUser);
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text,
      sender:      'client',
      senderName:  currentUser.displayName || 'Client',
      senderPhoto: currentUser.photoURL    || '',
      timestamp:   serverTimestamp(),
      ...(reply ? { replyTo: reply } : {})
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage:     text,
      lastUpdated:     serverTimestamp(),
      unread:          1,
      archivedByAdmin: false,
    });
  } catch (err) { console.error('Send error:', err); }
}

// ── Typing indicator — client side ───────────────────
function setClientTyping(isTyping) {
  if (!chatId) return;
  updateDoc(doc(db, 'chats', chatId), { typingClient: isTyping }).catch(() => {});
}

function showAdminTypingBubble(visible) {
  if (visible) {
    if (typingBubbleEl) return;
    typingBubbleEl = document.createElement('div');
    typingBubbleEl.id = 'admin-typing-bubble';
    typingBubbleEl.className = 'chat-msg-wrap admin';
    typingBubbleEl.innerHTML = `
      <div class="chat-typing-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
    messagesArea.appendChild(typingBubbleEl);
    scrollBottom();
  } else {
    if (typingBubbleEl) { typingBubbleEl.remove(); typingBubbleEl = null; }
  }
}

function subscribeTyping() {
  if (unsubTyping) unsubTyping();
  unsubTyping = onSnapshot(doc(db, 'chats', chatId), snap => {
    if (!snap.exists()) return;
    currentChatDeletedAt = snap.data().deletedAt?.toMillis() || null;
    showAdminTypingBubble(!!snap.data().typingAdmin);
  });
}

// ── Utilities ─────────────────────────────────────────
function scrollBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function fmtTime(d) {
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtAudioTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function downloadTrackFile(url, filename) {
  try {
    const res     = await fetch(url);
    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Download error:', err);
    window.open(url, '_blank');
  }
}

// Styles are defined in chat.css