// ==============================================
// ANNOUNCEMENTS — CRUD for Web Announcements
// Backed by Supabase (public.announcements). Previously hit GAS
// addAnnouncement / editAnnouncement / getAnnouncements actions.
// ==============================================

import { dbRest } from './db.js';
import { convertDriveUrl } from './uploads.js';

/** In-memory cache of loaded announcements */
let globalAnnouncements = [];

/** ID of announcement currently being edited (null = create mode) */
let editingAnnouncementId = null;

/** ID of announcement currently being viewed in modal */
let viewingAnnouncementId = null;

/** Reference to the creator Quill editor (set by main.js) */
let creatorQuill = null;

/**
 * Initialize this module with the Quill editor instance.
 * Called from main.js after Quill is created.
 */
export function initAnnouncements(quillInstance) {
  creatorQuill = quillInstance;
}

// --------------------------------------------------
// Cancel / Reset Edit Mode
// --------------------------------------------------

export function cancelEdit() {
  editingAnnouncementId = null;
  document.getElementById('creatorTitle').value = '';
  if (creatorQuill) creatorQuill.setText('');
  document.getElementById('creatorPageHeader').innerHTML =
    '<i class="bi bi-layout-text-window-reverse me-2 text-pink-custom"></i> เขียนประกาศลงเว็บไซต์';
  document.getElementById('creatorPageDesc').innerText =
    'เขียนเนื้อหา แทรกรูปภาพ แล้ว Publish ขึ้นบอร์ดประกาศได้ทันที';
  document.getElementById('publishBtnText').innerHTML =
    '<i class="bi bi-cloud-arrow-up-fill me-2"></i> Publish (เผยแพร่ลงเว็บไซต์)';
  document.getElementById('cancelEditBtn').classList.add('d-none');
  document.getElementById('creatorAlert').classList.add('d-none');
  // Reset thumbnail
  if (typeof window.clearCreatorThumb === 'function') window.clearCreatorThumb();
}

// --------------------------------------------------
// Edit an Existing Announcement
// --------------------------------------------------

export function editCurrentAnnouncement() {
  const post = globalAnnouncements.find((p) => p.id === viewingAnnouncementId);
  if (!post) return;

  const modalEl = document.getElementById('viewAnnouncementModal');
  bootstrap.Modal.getInstance(modalEl).hide();

  editingAnnouncementId = post.id;
  document.getElementById('creatorTitle').value = post.title;
  document.getElementById('creatorDepartment').value = post.department;
  creatorQuill.root.innerHTML = post.content;

  // Populate the thumbnail picker if the announcement has one stored.
  const thumbUrl = post.thumbnail || '';
  document.getElementById('creatorThumbUrl').value = thumbUrl;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  if (thumbUrl) {
    if (preview) preview.innerHTML = `<img src="${thumbUrl}" alt="thumbnail">`;
    if (clearBtn) clearBtn.classList.remove('d-none');
  } else if (typeof window.clearCreatorThumb === 'function') {
    window.clearCreatorThumb();
  }

  document.getElementById('creatorPageHeader').innerHTML =
    '<i class="bi bi-pencil-square me-2 text-pink-custom"></i> แก้ไขประกาศ';
  document.getElementById('creatorPageDesc').innerText =
    'ระบบจะทำการบันทึกข้อมูลทับประกาศเดิมของคุณ';
  document.getElementById('publishBtnText').innerHTML =
    '<i class="bi bi-save-fill me-2"></i> Update (บันทึกการแก้ไข)';
  document.getElementById('cancelEditBtn').classList.remove('d-none');
  bootstrap.Tab.getOrCreateInstance(document.getElementById('pills-creator-tab')).show();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --------------------------------------------------
// Publish (Create / Update) Announcement
// --------------------------------------------------

export async function publishAnnouncement() {
  const title = document.getElementById('creatorTitle').value.trim();
  const dept = document.getElementById('creatorDepartment').value;
  const contentHtml = creatorQuill.root.innerHTML;
  const contentText = creatorQuill.getText().trim();
  const alertBox = document.getElementById('creatorAlert');
  const publishBtn = document.querySelector('button[onclick="publishAnnouncement()"]');
  const publishBtnText = document.getElementById('publishBtnText');

  if (!title || contentText.length === 0) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML =
      '<i class="bi bi-exclamation-circle-fill me-2"></i> กรุณากรอกหัวข้อและเนื้อหาประกาศให้ครบถ้วน';
    return;
  }

  publishBtn.disabled = true;
  publishBtnText.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2"></span>กำลังประมวลผล...';

  const isEditing = editingAnnouncementId !== null;
  const thumbnail = document.getElementById('creatorThumbUrl')?.value || '';
  const row = {
    title,
    department: dept,
    content: contentHtml,
    thumbnail_url: thumbnail || null,
    status: 'approved',
  };

  try {
    let result;
    if (isEditing) {
      // Use Prefer: return=representation so PostgREST sends back the
      // updated row(s). If no row matched (RLS or id mismatch), data
      // will be an empty array — we surface that as a clear error
      // rather than the silent no-op the previous code had.
      const idEsc = encodeURIComponent(editingAnnouncementId);
      result = await dbRest(`/announcements?id=eq.${idEsc}`, {
        method: 'PATCH',
        body: row,
        prefer: 'return=representation',
      });
      if (!result.error && (!Array.isArray(result.data) || result.data.length === 0)) {
        throw new Error('อัปเดตไม่สำเร็จ — ไม่พบประกาศ id=' + editingAnnouncementId + ' หรือคุณไม่มีสิทธิ์แก้ไข (ต้องเป็น pr_staff หรือ dev)');
      }
    } else {
      result = await dbRest('/announcements', { method: 'POST', body: row });
    }
    if (result.error) {
      throw new Error(`${result.error.status || ''} ${result.error.message || 'unknown'}`.trim());
    }

    alertBox.className = 'alert alert-success shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> ${isEditing ? 'อัปเดตประกาศสำเร็จ!' : 'เผยแพร่ประกาศสำเร็จ!'} กำลังพากลับไปหน้าประกาศ...`;
    cancelEdit();
    setTimeout(() => {
      alertBox.classList.add('d-none');
      loadAnnouncements();
      bootstrap.Tab.getOrCreateInstance(document.getElementById('pills-announcements-tab')).show();
    }, 1500);
  } catch (error) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-wifi-off me-2"></i> บันทึกไม่สำเร็จ: ${error.message || error}`;
  } finally {
    publishBtn.disabled = false;
    if (document.getElementById('publishBtnText')) {
      document.getElementById('publishBtnText').innerHTML = isEditing
        ? '<i class="bi bi-save-fill me-2"></i> Update (บันทึกการแก้ไข)'
        : '<i class="bi bi-cloud-arrow-up-fill me-2"></i> Publish (เผยแพร่ลงเว็บไซต์)';
    }
  }
}

// --------------------------------------------------
// Load Announcements from Server
// --------------------------------------------------

export async function loadAnnouncements() {
  const container = document.getElementById('announcementsGrid');
  const emptyState = document.getElementById('emptyState');

  container.innerHTML =
    '<div class="col-12 text-center text-muted py-5"><div class="spinner-border text-pink-custom mb-3" role="status"></div><p>กำลังดึงข้อมูลประกาศล่าสุด...</p></div>';
  emptyState.classList.add('d-none');

  try {
    const { data, error } = await dbRest(
      '/announcements?select=id,title,content,department,thumbnail_url,created_at&status=eq.approved&order=created_at.desc'
    );
    if (error) throw new Error(`${error.status || ''} ${error.message || 'unknown'}`.trim());

    // Map DB rows to the shape the existing renderer uses (matches the
    // legacy GAS getAnnouncements response so we don't have to touch
    // every callsite).
    globalAnnouncements = (data || []).map((row) => ({
      id: row.id.toString(),
      date: row.created_at
        ? new Date(row.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
        : '',
      title: row.title,
      department: row.department,
      content: row.content,
      thumbnail: row.thumbnail_url || '',
    }));
    container.innerHTML = '';

    if (globalAnnouncements.length === 0) {
      emptyState.classList.remove('d-none');
    } else {
      emptyState.classList.add('d-none');
      globalAnnouncements.forEach((post) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = post.content;
        const firstImg = tempDiv.querySelector('img');
        // Prefer explicit thumbnail; fall back to first image in content; finally placeholder.
        // Run through convertDriveUrl so any legacy /uc?id= URLs still render.
        const coverSrc = convertDriveUrl(post.thumbnail)
          || convertDriveUrl(firstImg?.src)
          || 'https://images.unsplash.com/photo-1576091160550-2173ff9e5ee5?w=600&h=400&fit=crop';
        let snippet = tempDiv.textContent || tempDiv.innerText || '';
        snippet = snippet.length > 80 ? snippet.substring(0, 80) + '...' : snippet;

        container.insertAdjacentHTML('beforeend', `
          <div class="col-md-6 col-lg-4">
            <div class="card announce-card" onclick="viewAnnouncement('${post.id}')">
              <div class="announce-img-wrapper"><img src="${coverSrc}" alt="cover"></div>
              <div class="card-body d-flex flex-column">
                <div>
                  <span class="badge mb-2" style="background-color: var(--pink-500);">${post.department}</span>
                  <h5 class="card-title fw-bold" style="color: var(--pink-900);">${post.title}</h5>
                  <p class="card-text text-muted small">${snippet}</p>
                </div>
                <div class="mt-auto pt-3 border-top text-muted small"><i class="bi bi-clock me-1"></i> ${post.date}</div>
              </div>
            </div>
          </div>
        `);
      });
    }
    renderHomeAnnouncements();
  } catch (error) {
    container.innerHTML =
      '<div class="col-12 text-center text-danger py-5"><i class="bi bi-exclamation-triangle fs-1"></i><p class="mt-3">เกิดข้อผิดพลาดในการโหลดข้อมูลประกาศ กรุณาลองใหม่อีกครั้ง</p></div>';
    renderHomeAnnouncements({ error: true });
  }
}

/**
 * Render announcements into the home carousel. Called by loadAnnouncements
 * after fetch resolves so the home page reflects the same data that the
 * announcements tab shows. Cards are flat children of the scroll container
 * (no row/col wrapping) because the layout uses flex + scroll-snap.
 */
function renderHomeAnnouncements({ error = false } = {}) {
  const homeGrid = document.getElementById('homeAnnouncementsGrid');
  if (!homeGrid) return;

  if (error) {
    homeGrid.innerHTML =
      '<div class="home-announce-loading">โหลดประกาศไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</div>';
    return;
  }

  if (globalAnnouncements.length === 0) {
    homeGrid.innerHTML =
      '<div class="home-announce-loading">ยังไม่มีประกาศในขณะนี้</div>';
    return;
  }

  homeGrid.innerHTML = '';
  globalAnnouncements.slice(0, 10).forEach((post) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = post.content;
    const firstImg = tempDiv.querySelector('img');
    const coverSrc = convertDriveUrl(post.thumbnail)
      || convertDriveUrl(firstImg?.src)
      || 'https://images.unsplash.com/photo-1576091160550-2173ff9e5ee5?w=600&h=400&fit=crop';

    homeGrid.insertAdjacentHTML('beforeend', `
      <a class="home-announce-card" onclick="viewAnnouncement('${post.id}')">
        <div class="home-announce-img"><img src="${coverSrc}" alt="cover" loading="lazy"></div>
        <div class="home-announce-body">
          <span class="home-announce-badge">${post.department}</span>
          <h5 class="home-announce-title">${post.title}</h5>
          <span class="home-announce-date"><i class="bi bi-clock"></i> ${post.date}</span>
        </div>
      </a>
    `);
  });
}

// --------------------------------------------------
// View Announcement in Modal
// --------------------------------------------------

export function viewAnnouncement(id) {
  const post = globalAnnouncements.find((p) => p.id === id);
  if (post) {
    viewingAnnouncementId = post.id;
    document.getElementById('modalTitle').innerText = post.title;
    document.getElementById('modalDeptBadge').innerText = post.department;
    document.getElementById('modalDate').innerHTML = `<i class="bi bi-clock me-1"></i> ${post.date}`;
    // Rewrite any legacy Drive img URLs inside the content so they actually render.
    const body = document.getElementById('modalBodyContent');
    body.innerHTML = post.content;
    body.querySelectorAll('img').forEach((img) => {
      const fixed = convertDriveUrl(img.getAttribute('src'));
      if (fixed) img.setAttribute('src', fixed);
    });
    new bootstrap.Modal(document.getElementById('viewAnnouncementModal')).show();
  }
}
