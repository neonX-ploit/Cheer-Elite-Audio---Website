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

  state.adminPhoto = profile.photo || '';

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

      // Instant local preview before upload
      const localUrl = URL.createObjectURL(file);
      const setAv = $('settings-av');
      if (setAv) {
        setAv.innerHTML = `<img src="${localUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;opacity:0.6;" />`;
      }

      showToast('Uploading photo…');
        try {
// Step 1 — get signed credentials
      const sigRes  = await fetch('/.netlify/functions/cloudinary-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadType: 'admin_photo' }),
      });
      if (!sigRes.ok) throw new Error(`Signing failed: ${sigRes.status}`);
      const { signature, timestamp, api_key, cloud_name, folder } = await sigRes.json();

      // Step 2 — upload directly to Cloudinary
          const formData = new FormData();
          formData.append('file', file);
          formData.append('api_key', api_key);
          formData.append('timestamp', timestamp);
          formData.append('signature', signature);
          formData.append('folder', 'admin_photos');

          const upRes  = await fetch(`https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`, {
            method: 'POST',
            body: formData,
          });
          if (!upRes.ok) throw new Error(`Cloudinary upload failed: ${upRes.status}`);
          const upJson = await upRes.json();
          if (!upJson.secure_url) throw new Error('No URL returned');

          const json = { url: upJson.secure_url };

          await setDoc(doc(db, 'admins', user.uid), { photo: json.url }, { merge: true });
          showToast('✅ Photo saved!');
          loadAdminProfile(user);
        } catch (err) {
          showToast('❌ Upload failed. Try again.');
          console.error(err);
        }
    });
}