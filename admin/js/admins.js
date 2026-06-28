import { db, storage, auth } from './firebase.js';
import { $, getInitials }    from './utils.js';
import { showToast }         from './ui.js';
import { state } from './state.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ── Load admin profile & populate sidebar + settings ── */
export async function loadAdminProfile(user) {
  const docRef  = doc(db, 'admins', user.uid);
  const docSnap = await getDoc(docRef);

  const profile = docSnap.exists() ? docSnap.data() : {};
  const name    = profile.name  || user.displayName || user.email.split('@')[0];

  state.adminName = name;

  const photo   = profile.photo || '';
  const role    = profile.role  || 'admin';

  // Sidebar
  const sbName = $('sb-user-name');
  const sbAv   = $('sb-user-av');
  const sbRole = $('sb-user-role');
  if (sbName) sbName.textContent = name;
  if (sbRole) sbRole.textContent = role === 'owner' ? 'Owner' : 'Admin';
  if (sbAv) {
    if (photo) {
      sbAv.innerHTML = `<img src="${photo}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />`;
    } else {
      sbAv.textContent = name[0].toUpperCase();
    }
  }

  // Settings page
  const setName  = $('settings-display-name');
  const setEmail = $('settings-email');
  const setAv    = $('settings-av');
  const setRole  = $('settings-role-badge');
  const nameInp  = $('settings-name-input');

  if (setName)  setName.textContent  = name;
  if (setEmail) setEmail.textContent = user.email;
  if (setRole)  setRole.textContent  = role === 'owner' ? '👑 Owner' : '🛡 Admin';
  if (nameInp)  nameInp.value        = name;

  if (setAv) {
    if (photo) {
      setAv.innerHTML = `<img src="${photo}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`;
    } else {
      setAv.textContent = name[0].toUpperCase();
    }
  }
}

/* ── Save display name ── */
export function initProfileEditor(user) {
  $('settings-save-name')?.addEventListener('click', async () => {
    const newName = $('settings-name-input')?.value.trim();
    if (!newName) return showToast('Name cannot be empty');

    await setDoc(doc(db, 'admins', user.uid), { name: newName }, { merge: true });
    showToast('Name updated!');
    loadAdminProfile(user);
  });

  /* ── Photo upload ── */
  $('settings-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return showToast('Only JPG, PNG or WebP allowed');
    if (file.size > 2 * 1024 * 1024)  return showToast('Image must be under 2MB');

    showToast('Uploading photo…');
    const storageRef = ref(storage, `admin-photos/${user.uid}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    await setDoc(doc(db, 'admins', user.uid), { photo: url }, { merge: true });
    showToast('Photo updated!');
    loadAdminProfile(user);
  });
}