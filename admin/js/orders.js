import { db }                      from './firebase.js';
import { state }                   from './state.js';
import { $, escHtml, formatFull }  from './utils.js';
import { showToast, openConfirmModal } from './ui.js';
import {
  collection, doc, addDoc, getDocs, updateDoc, deleteDoc, getDoc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ── Live "active clients" count ───────────────────────────
   Active = orders with status 'in_production' (accepted, not yet completed).
   Distinct clients only — one client with two active orders counts once. ── */
let unsubActiveClients = null;

export function startListeningToActiveClientsCount() {
  if (unsubActiveClients) unsubActiveClients();

  const activeQ = query(collection(db, 'orders'), where('status', '==', 'in_production'));
  unsubActiveClients = onSnapshot(activeQ, snap => {
    const activeClientIds = new Set(snap.docs.map(d => d.data().chatId));
    const el = $('cp-count');
    if (el) el.textContent = activeClientIds.size;
  }, err => console.error('Active clients listener failed:', err));
}

/* ── Live orders listener ──────────────────────────────── */
export function startListeningToOrders(chatId) {
  if (state.unsubOrders) { state.unsubOrders(); state.unsubOrders = null; }

  const ordersQ = query(
    collection(db, 'orders'),
    where('chatId', '==', chatId),
    orderBy('createdAt', 'asc')
  );

  state.unsubOrders = onSnapshot(ordersQ, snap => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(orders);
  }, err => {
    console.error('Orders listener failed:', err);
    showToast(err.code === 'failed-precondition'
      ? 'Orders index missing — check console for a link to create it.'
      : `Couldn't load orders: ${err.code}`);
    renderOrders([]);
  });
}

/* ── Render all orders for active chat ─────────────────── */
export function renderOrders(orders) {
  const orderListEl = $('order-list');
  orderListEl.innerHTML = '';

  // 4 buckets
  const awaitingForm = orders.filter(o => ['pending_form', 'awaiting_info'].includes(o.status));
  const pending      = orders.filter(o => o.status === 'submitted');
  const active       = orders.filter(o => o.status === 'in_production');
  const completed    = orders.filter(o => ['completed', 'declined'].includes(o.status));

  /* ──────────────── SECTION 0: AWAITING FORM ──────────────── */
  const awaitingHeader = document.createElement('div');
  awaitingHeader.style.cssText = 'font-size:10px;font-weight:700;color:#818CF8;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
  awaitingHeader.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#818CF8;display:inline-block;"></span> Awaiting Form`;
  orderListEl.appendChild(awaitingHeader);

  if (awaitingForm.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--ct-muted);padding:10px 4px 14px;';
    empty.textContent = 'No forms sent yet.';
    orderListEl.appendChild(empty);
  } else {
    awaitingForm.forEach(order => {
      const statusLabel = order.status === 'pending_form' ? 'Form sent — waiting on client' : 'Awaiting additional info';
      const card = document.createElement('div');
      card.className = 'order-card';
      card.style.borderColor = '#818CF8';
      card.innerHTML = `
        <div class="order-card-top">
          <span class="order-card-title">Mix ${order.orderNumber}${order.type ? ' · ' + order.type : ''}</span>
          <svg class="order-card-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none">
            <path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="order-card-status" style="color:#818CF8;">📋 ${statusLabel}</div>
        <div class="order-card-details">
          ${renderOrderDetails(order.formData)}
          <div style="margin-top:10px;display:flex;gap:6px;">
            <button class="awaiting-info-btn btn btn-ghost" data-id="${order.id}" style="flex:1;justify-content:center;font-size:11px;padding:6px;">
              Mark Awaiting Info
            </button>
            <button class="delete-order-btn" data-id="${order.id}" style="padding:6px 10px;border:1.5px solid var(--red);background:none;color:var(--red);border-radius:7px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;">
              🗑
            </button>
          </div>
        </div>
      `;
      card.querySelector('.order-card-top').addEventListener('click', () => card.classList.toggle('open'));
      orderListEl.appendChild(card);
    });
  }

  // Divider
  const div0 = document.createElement('div');
  div0.style.cssText = 'height:1px;background:var(--ct-border);margin:10px 0;';
  orderListEl.appendChild(div0);

  /* ──────────────── SECTION 1: PENDING ORDERS ──────────────── */
  const pendingHeader = document.createElement('div');
  pendingHeader.style.cssText = 'font-size:10px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
  pendingHeader.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:var(--amber);display:inline-block;"></span> Pending Orders`;
  orderListEl.appendChild(pendingHeader);

  if (pending.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--ct-muted);padding:10px 4px 14px;';
    empty.textContent = 'No pending orders awaiting review.';
    orderListEl.appendChild(empty);
  } else {
    pending.forEach(order => {
      const card = document.createElement('div');
      card.className = 'order-card';
      card.style.borderColor = 'var(--amber)';
      const submittedAt = order.submittedAt ? formatFull(order.submittedAt.toDate()) : '—';
      card.innerHTML = `
        <div class="order-card-top">
          <span class="order-card-title">Mix ${order.orderNumber}${order.type ? ' · ' + order.type : ''}</span>
          <svg class="order-card-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none">
            <path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="order-card-status" style="color:var(--amber);">⏳ Awaiting your approval</div>
        <div class="order-card-details">
          <div style="font-size:10.5px;color:var(--ct-muted);margin-bottom:6px;">Submitted: ${submittedAt}</div>
          ${renderOrderDetails(order.formData)}
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:10.5px;font-weight:600;color:var(--ct-muted);white-space:nowrap;">Price (${order.type === 'PH' ? '₱' : '$'})</label>
              <input type="number" class="order-price-input" data-id="${order.id}" value="${order.price || ''}" placeholder="Enter price"
                style="flex:1;padding:5px 8px;border:1.5px solid var(--ct-border);border-radius:6px;font-size:12px;font-family:inherit;outline:none;" />
            </div>
            <div style="display:flex;gap:6px;">
              <button class="accept-order-btn btn btn-dark" data-id="${order.id}" data-type="${order.type || 'PH'}" style="flex:1;justify-content:center;font-size:12px;padding:7px;">
                ✓ Accept
              </button>
              <button class="decline-order-btn" data-id="${order.id}" style="padding:5px 10px;border:1.5px solid var(--red);background:none;color:var(--red);border-radius:7px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s;white-space:nowrap;">
                ✕ Decline
              </button>
            </div>
          </div>
        </div>
      `;
      card.querySelector('.order-card-top').addEventListener('click', () => card.classList.toggle('open'));
      orderListEl.appendChild(card);
    });
  }

  // Divider
  const div1 = document.createElement('div');
  div1.style.cssText = 'height:1px;background:var(--ct-border);margin:10px 0;';
  orderListEl.appendChild(div1);

  /* ──────────────── SECTION 2: ACTIVE ORDERS ──────────────── */
  const activeHeader = document.createElement('div');
  activeHeader.style.cssText = 'font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
  activeHeader.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;"></span> Active Orders`;
  orderListEl.appendChild(activeHeader);

  if (active.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--ct-muted);padding:10px 4px 14px;';
    empty.textContent = 'No active orders.';
    orderListEl.appendChild(empty);
  } else {
    active.forEach(order => {
      const statusLabel = {
        pending_form:  'Form sent — awaiting client',
        awaiting_info: 'Awaiting info',
        in_production: 'In production',
      }[order.status] || 'Awaiting info';

      const statusColor = order.status === 'in_production' ? 'var(--green)' : 'var(--ct-muted)';

      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div class="order-card-top">
          <span class="order-card-title">Mix ${order.orderNumber}${order.type ? ' · ' + order.type : ''}</span>
          <svg class="order-card-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none">
            <path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="order-card-status" style="color:${statusColor};">${statusLabel}</div>
        <div class="order-card-details">
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--ct-subtle);">
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="font-size:10px;font-weight:600;color:var(--ct-muted);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;min-width:60px;">Status</label>
              <select class="order-status-select" data-id="${order.id}" style="flex:1;padding:4px 8px;border:1.5px solid var(--ct-border);border-radius:6px;font-size:11.5px;font-family:inherit;outline:none;background:var(--ct-surface);color:var(--ct-text);">
                <option value="in_production" ${order.status === 'in_production' ? 'selected' : ''}>In Production</option>
                <option value="completed"     ${order.status === 'completed'     ? 'selected' : ''}>Completed ✓</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="font-size:10px;font-weight:600;color:var(--ct-muted);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;min-width:60px;">Deadline</label>
              <input type="date" class="order-deadline-input" data-id="${order.id}" value="${order.deadline || ''}"
                style="flex:1;padding:4px 8px;border:1.5px solid var(--ct-border);border-radius:6px;font-size:11.5px;font-family:inherit;outline:none;background:var(--ct-surface);color:var(--ct-text);" />
            </div>
          </div>
          ${renderOrderDetails(order.formData)}
          ${order.price != null ? `<div style="margin-top:8px;font-size:12px;font-weight:600;color:var(--teal-dim);">${order.type === 'PH' ? '₱' : '$'}${order.price}</div>` : ''}
          <div style="margin-top:10px;">
            <button class="delete-order-btn" data-id="${order.id}" style="padding:6px 12px;border:1.5px solid var(--red);background:none;color:var(--red);border-radius:7px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s;width:100%;">
              🗑 Delete Order
            </button>
          </div>
        </div>
      `;
      card.querySelector('.order-card-top').addEventListener('click', () => card.classList.toggle('open'));
      orderListEl.appendChild(card);
    });
  }

  // Divider
  const div2 = document.createElement('div');
  div2.style.cssText = 'height:1px;background:var(--ct-border);margin:10px 0;';
  orderListEl.appendChild(div2);

  /* ──────────────── SECTION 3: COMPLETED ORDERS ──────────────── */
  const completedHeader = document.createElement('div');
  completedHeader.style.cssText = 'font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
  completedHeader.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#64748B;display:inline-block;"></span> Completed Orders`;
  orderListEl.appendChild(completedHeader);

  if (completed.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--ct-muted);padding:10px 4px;';
    empty.textContent = 'No completed orders yet.';
    orderListEl.appendChild(empty);
  } else {
    completed.forEach(order => {
      const isDeclined = order.status === 'declined';
      const statusLabel = isDeclined ? '✕ Declined' : '✓ Completed';
      const statusColor = isDeclined ? 'var(--red)' : 'var(--teal-dim)';
      const completedAt = order.completedAt ? formatFull(order.completedAt.toDate())
        : order.declinedAt ? formatFull(order.declinedAt.toDate()) : '—';

      const card = document.createElement('div');
      card.className = 'order-card';
      card.style.opacity = '0.75';
      card.innerHTML = `
        <div class="order-card-top">
          <span class="order-card-title">Mix ${order.orderNumber}${order.type ? ' · ' + order.type : ''}</span>
          <svg class="order-card-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none">
            <path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="order-card-status" style="color:${statusColor};">${statusLabel}</div>
        <div class="order-card-details">
          <div style="font-size:10.5px;color:var(--ct-muted);margin-bottom:6px;">${isDeclined ? 'Declined' : 'Completed'}: ${completedAt}</div>
          ${renderOrderDetails(order.formData)}
          ${order.price != null ? `<div style="margin-top:8px;font-size:12px;font-weight:600;color:var(--teal-dim);">${order.type === 'PH' ? '₱' : '$'}${order.price}</div>` : ''}
          <div style="margin-top:10px;">
            <button class="delete-order-btn" data-id="${order.id}" style="padding:6px 12px;border:1.5px solid var(--red);background:none;color:var(--red);border-radius:7px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s;width:100%;">
              🗑 Delete Order
            </button>
          </div>
        </div>
      `;
      card.querySelector('.order-card-top').addEventListener('click', () => card.classList.toggle('open'));
      orderListEl.appendChild(card);
    });
  }

  /* ──────────────── EVENT LISTENERS ──────────────── */

  // Awaiting info toggle (awaiting form section)
  orderListEl.querySelectorAll('.awaiting-info-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentStatus = orders.find(o => o.id === id)?.status;
      const newStatus = currentStatus === 'awaiting_info' ? 'pending_form' : 'awaiting_info';
      await updateDoc(doc(db, 'orders', id), { status: newStatus });
      showToast(newStatus === 'awaiting_info' ? 'Marked as awaiting info.' : 'Marked as form sent.');
    });
  });

  // Accept buttons
  orderListEl.querySelectorAll('.accept-order-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id         = btn.dataset.id;
      const type       = btn.dataset.type;
      const priceInput = orderListEl.querySelector(`.order-price-input[data-id="${id}"]`);
      const price      = priceInput ? parseFloat(priceInput.value) || null : null;

      const orderSnap = await getDocs(query(collection(db, 'orders'), where('chatId', '==', state.activeChatId)));
      const order     = orderSnap.docs.find(d => d.id === id);
      const duration  = order?.data()?.formData?.['Music Duration'];
      let finalPrice  = price;
      if (type === 'PH' && !finalPrice) {
        if (duration === '5:00') finalPrice = 2700;
        else if (duration === '4:00') finalPrice = 2500;
      }

      await updateDoc(doc(db, 'orders', id), { status: 'in_production', price: finalPrice, acceptedAt: serverTimestamp() });
      await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), {
        type: 'text', sender: 'admin', senderName: 'Support',
        text: `Your order has been accepted and is now in production!${finalPrice ? ` Price: ${type === 'PH' ? '₱' : '$'}${finalPrice}` : ''}`,
        timestamp: serverTimestamp(), seenByClient: false
      });
      await updateDoc(doc(db, 'chats', state.activeChatId), {
        lastMessage: 'Order accepted — In production', lastUpdated: serverTimestamp()
      });
      showToast('Order accepted!');
    });
  });

  // Decline buttons (pending section)
  orderListEl.querySelectorAll('.decline-order-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openConfirmModal({
        title: 'Decline this order?',
        message: 'The client will be notified that their order was declined.',
        actionLabel: 'Decline',
        danger: true,
        onConfirm: async () => {
          await updateDoc(doc(db, 'orders', id), { status: 'declined', declinedAt: serverTimestamp() });
          await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), {
            type: 'text', sender: 'admin', senderName: 'Support',
            text: `❌ Unfortunately, we're unable to accept your order at this time. Please feel free to reach out if you have any questions.`,
            timestamp: serverTimestamp(), seenByClient: false
          });
          await updateDoc(doc(db, 'chats', state.activeChatId), {
            lastMessage: '❌ Order declined', lastUpdated: serverTimestamp()
          });
          showToast('Order declined.');
        }
      });
    });
  });

  // Status change (active orders)
  orderListEl.querySelectorAll('.order-status-select').forEach(sel => {
    sel.addEventListener('change', async e => {
      e.stopPropagation();
      const newStatus = sel.value;
      const updateData = { status: newStatus };
      if (newStatus === 'completed') updateData.completedAt = serverTimestamp();
      await updateDoc(doc(db, 'orders', sel.dataset.id), updateData);
      showToast('Order status updated');
    });
  });

  // Deadline change
  orderListEl.querySelectorAll('.order-deadline-input').forEach(inp => {
    inp.addEventListener('change', async e => {
      e.stopPropagation();
      await updateDoc(doc(db, 'orders', inp.dataset.id), { deadline: inp.value });
      showToast('Deadline saved');
    });
  });

  // Delete order
  orderListEl.querySelectorAll('.delete-order-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openConfirmModal({
        title: 'Delete this order?',
        message: 'This will permanently remove the order. This cannot be undone.',
        actionLabel: 'Delete',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'orders', id));
            showToast('Order deleted.');
          } catch (err) {
            console.error(err);
            showToast('Error deleting order.');
          }
        }
      });
    });
  });
}

/* ── Order detail rows ─────────────────────────────────── */
export function renderOrderDetails(formData) {
  if (!formData || !Object.keys(formData).length)
    return `<p style="font-size:11.5px;color:var(--ct-muted);">Client hasn't submitted details yet.</p>`;
  return Object.entries(formData).map(([k, v]) =>
    `<div class="order-detail-row"><span>${escHtml(k)}</span><span>${escHtml(v)}</span></div>`
  ).join('');
}

/* ── New order button ──────────────────────────────────── */
export function initNewOrderBtn() {
  const newOrderBtn = $('new-order-btn');
  newOrderBtn?.addEventListener('click', () => {
    if (!state.activeChatId) return;
    const existing = document.getElementById('order-type-dropdown');
    if (existing) { existing.remove(); return; }

    const dropdown = document.createElement('div');
    dropdown.id = 'order-type-dropdown';
    dropdown.style.cssText = `
      position:absolute; background:#fff; border:1.5px solid var(--ct-border);
      border-radius:10px; box-shadow:var(--shadow-md); z-index:200;
      padding:6px; display:flex; flex-direction:column; gap:4px; min-width:160px;
    `;

    const makeBtn = (label, type) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.cssText = 'padding:8px 12px;border:none;background:none;text-align:left;font-size:13px;font-family:inherit;cursor:pointer;border-radius:7px;font-weight:500;';
      btn.onmouseenter = () => btn.style.background = 'var(--ct-subtle)';
      btn.onmouseleave = () => btn.style.background = 'none';
      btn.onclick = () => { dropdown.remove(); createOrder(type); };
      return btn;
    };

    dropdown.appendChild(makeBtn('🇺🇸 US Client', 'US'));
    dropdown.appendChild(makeBtn('🇵🇭 PH Client', 'PH'));

    const btnRect    = newOrderBtn.getBoundingClientRect();
    const headerRect = document.getElementById('chat-header').getBoundingClientRect();
    dropdown.style.top  = (btnRect.bottom - headerRect.top + 6) + 'px';
    dropdown.style.left = (btnRect.left - headerRect.left) + 'px';
    document.getElementById('chat-header').style.position = 'relative';
    document.getElementById('chat-header').appendChild(dropdown);

    const closeDropdown = e => {
      if (!dropdown.contains(e.target) && e.target !== newOrderBtn) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };
    setTimeout(() => document.addEventListener('click', closeDropdown), 10);
  });
}

/* ── Create order ──────────────────────────────────────── */
async function createOrder(type) {
  const chatData  = state.allChats.find(c => c.id === state.activeChatId) || {};
  const counterRef = doc(db, 'meta', 'orderCounter');
  const counterSnap = await getDoc(counterRef);
  const nextNumber = (counterSnap.exists() ? counterSnap.data().count : 0) + 1;
  await setDoc(counterRef, { count: nextNumber }, { merge: true });

  const orderId = (await addDoc(collection(db, 'orders'), {
    chatId: state.activeChatId,
    clientName: chatData.clientName || 'Unknown',
    orderNumber: nextNumber,
    type,
    status: 'pending_form',
    formData: {},
    price: null,
    createdAt: serverTimestamp(),
    submittedAt: null
  })).id;

  const formMsg = type === 'US'
    ? `ORDER_FORM_US:${orderId}:${nextNumber}`
    : `ORDER_FORM_PH:${orderId}:${nextNumber}`;

  await addDoc(collection(db, 'chats', state.activeChatId, 'messages'), {
    type: 'order_form', sender: 'admin', senderName: 'Support',
    orderId, orderNumber: nextNumber, orderType: type, formHtml: formMsg,
    timestamp: serverTimestamp(), seenByClient: false
  });
  await updateDoc(doc(db, 'chats', state.activeChatId), {
    lastMessage: `Order form sent (Mix ${nextNumber})`, lastUpdated: serverTimestamp()
  });

  showToast(`Order Mix - ${nextNumber} form sent to client!`);
}