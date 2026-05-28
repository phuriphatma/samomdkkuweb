// ==============================================
// ANNOUNCEMENTS — CRUD for Web Announcements
// Backed by Supabase (public.announcements). Previously hit GAS
// addAnnouncement / editAnnouncement / getAnnouncements actions.
// ==============================================

import { dbRest } from './db.js';
import { convertDriveUrl } from './uploads.js';
import { escHtml } from './utils.js';

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
  // Live char counter under the subhead/excerpt textarea.
  const ex = document.getElementById('creatorExcerpt');
  if (ex) {
    ex.addEventListener('input', updateExcerptCount);
    updateExcerptCount();
  }
}

// --------------------------------------------------
// Cancel / Reset Edit Mode
// --------------------------------------------------

export function cancelEdit() {
  editingAnnouncementId = null;
  const title = document.getElementById('creatorTitle');
  const excerpt = document.getElementById('creatorExcerpt');
  if (title) title.value = '';
  if (excerpt) excerpt.value = '';
  updateExcerptCount();
  if (creatorQuill) creatorQuill.setText('');
  const header = document.getElementById('creatorPageHeader');
  const desc = document.getElementById('creatorPageDesc');
  const btnText = document.getElementById('publishBtnText');
  if (header) header.innerHTML =
    '<i class="bi bi-layout-text-window-reverse me-2 text-pink-custom"></i>เขียนประกาศลงเว็บไซต์';
  if (desc) desc.innerText =
    'กรอกหัวเรื่อง คำโปรย ภาพปก และเนื้อหา — ระบบจะจัดหน้าให้อัตโนมัติ';
  if (btnText) btnText.innerHTML =
    '<i class="bi bi-cloud-arrow-up-fill me-2"></i>เผยแพร่ลงเว็บไซต์';
  document.getElementById('cancelEditBtn')?.classList.add('d-none');
  document.getElementById('creatorAlert')?.classList.add('d-none');
  if (typeof window.clearCreatorThumb === 'function') window.clearCreatorThumb();
  // Always return creator UI to edit mode when starting fresh.
  setCreatorMode('edit');
}

// Live character count under the excerpt textarea.
function updateExcerptCount() {
  const ex = document.getElementById('creatorExcerpt');
  const count = document.getElementById('creatorExcerptCount');
  if (ex && count) count.textContent = String(ex.value.length);
}

// Switch the creator between Edit and Preview panes. Preview reuses the
// same renderArticleView() that the public reader tab uses, so authors
// see exactly what visitors will see.
export function setCreatorMode(mode) {
  const editPane = document.getElementById('creatorEditPane');
  const prevPane = document.getElementById('creatorPreviewPane');
  const editBtn = document.getElementById('creatorModeEditBtn');
  const prevBtn = document.getElementById('creatorModePreviewBtn');
  if (!editPane || !prevPane) return;

  const isPreview = mode === 'preview';
  editPane.classList.toggle('d-none', isPreview);
  prevPane.classList.toggle('d-none', !isPreview);
  editBtn?.classList.toggle('active', !isPreview);
  prevBtn?.classList.toggle('active', isPreview);

  if (isPreview) {
    const mount = document.getElementById('creatorPreviewMount');
    if (mount) mount.innerHTML = renderArticleView(readCreatorForm(), { isPreview: true });
  }
}

// Snapshot the creator form into the same post-shape the renderers expect.
function readCreatorForm() {
  return {
    id: 'preview',
    title:      (document.getElementById('creatorTitle')?.value || '').trim() || '(ยังไม่ได้กรอกหัวเรื่อง)',
    department: document.getElementById('creatorDepartment')?.value || 'สโมสรนักศึกษา',
    excerpt:    (document.getElementById('creatorExcerpt')?.value || '').trim(),
    content:    creatorQuill ? creatorQuill.root.innerHTML : '',
    thumbnail:  document.getElementById('creatorThumbUrl')?.value || '',
    date:       new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
  };
}

// --------------------------------------------------
// Edit an Existing Announcement
// --------------------------------------------------

export function editCurrentAnnouncement() {
  const post = globalAnnouncements.find((p) => p.id === viewingAnnouncementId);
  if (!post) return;

  editingAnnouncementId = post.id;
  document.getElementById('creatorTitle').value = post.title;
  document.getElementById('creatorDepartment').value = post.department;
  const ex = document.getElementById('creatorExcerpt');
  if (ex) ex.value = post.excerpt || '';
  updateExcerptCount();
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
    '<i class="bi bi-pencil-square me-2 text-pink-custom"></i>แก้ไขประกาศ';
  document.getElementById('creatorPageDesc').innerText =
    'ระบบจะทำการบันทึกข้อมูลทับประกาศเดิมของคุณ';
  document.getElementById('publishBtnText').innerHTML =
    '<i class="bi bi-save-fill me-2"></i>บันทึกการแก้ไข';
  document.getElementById('cancelEditBtn').classList.remove('d-none');
  setCreatorMode('edit');
  bootstrap.Tab.getOrCreateInstance(document.getElementById('pills-creator-tab')).show();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --------------------------------------------------
// Publish (Create / Update) Announcement
// --------------------------------------------------

export async function publishAnnouncement() {
  const title = document.getElementById('creatorTitle').value.trim();
  const dept = document.getElementById('creatorDepartment').value;
  const excerpt = (document.getElementById('creatorExcerpt')?.value || '').trim();
  const contentHtml = creatorQuill.root.innerHTML;
  const contentText = creatorQuill.getText().trim();
  const thumbnail = document.getElementById('creatorThumbUrl')?.value || '';
  const alertBox = document.getElementById('creatorAlert');
  const publishBtn = document.getElementById('publishBtn');
  const publishBtnText = document.getElementById('publishBtnText');

  if (!title || contentText.length === 0) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML =
      '<i class="bi bi-exclamation-circle-fill me-2"></i>กรุณากรอกหัวเรื่องและเนื้อหาประกาศให้ครบถ้วน';
    setCreatorMode('edit');
    return;
  }
  if (!thumbnail) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML =
      '<i class="bi bi-image me-2"></i>กรุณาเลือกภาพปกของบทความ — ภาพปกเป็นองค์ประกอบสำคัญของเลย์เอาต์';
    setCreatorMode('edit');
    return;
  }

  publishBtn.disabled = true;
  publishBtnText.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2"></span>กำลังประมวลผล...';

  const isEditing = editingAnnouncementId !== null;
  const row = {
    title,
    department: dept,
    content: contentHtml,
    thumbnail_url: thumbnail,
    status: 'approved',
  };
  // Only include excerpt if we know the column exists. The loader's
  // graceful fallback sets __samoWarnedExcerpt when the SELECT 400s on
  // the missing column — same DB will also reject an INSERT/UPDATE
  // that names that column.
  if (!window.__samoWarnedExcerpt) {
    row.excerpt = excerpt || null;
  }

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
      result = await dbRest('/announcements', {
        method: 'POST',
        body: row,
        prefer: 'return=representation',
      });
    }
    if (result.error) {
      throw new Error(`${result.error.status || ''} ${result.error.message || 'unknown'}`.trim());
    }

    alertBox.className = 'alert alert-success shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>${isEditing ? 'อัปเดตประกาศสำเร็จ!' : 'เผยแพร่ประกาศสำเร็จ!'} กำลังพากลับไปหน้าประกาศ...`;
    // Snapshot the published id BEFORE cancelEdit() resets editingAnnouncementId.
    // For new publishes, the inserted row id comes back via Prefer=representation
    // (we add it below); for edits, reuse the id we were editing.
    const publishedId = isEditing
      ? editingAnnouncementId
      : (Array.isArray(result?.data) && result.data[0]?.id) || null;
    cancelEdit();
    setTimeout(async () => {
      alertBox.classList.add('d-none');
      await loadAnnouncements();
      if (publishedId != null) {
        // Open the new article directly so the author sees the rendered result.
        viewAnnouncement(String(publishedId));
      } else {
        bootstrap.Tab.getOrCreateInstance(document.getElementById('pills-announcements-tab')).show();
      }
    }, 1200);
  } catch (error) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-wifi-off me-2"></i> บันทึกไม่สำเร็จ: ${error.message || error}`;
  } finally {
    publishBtn.disabled = false;
    // Only restore the spinner-replaced label on error; on success
    // cancelEdit() already set it to the create-mode label and we
    // must not stomp it back to "Update" using the stale isEditing flag.
    const stillEditing = editingAnnouncementId !== null;
    if (document.getElementById('publishBtnText')) {
      document.getElementById('publishBtnText').innerHTML = stillEditing
        ? '<i class="bi bi-save-fill me-2"></i>บันทึกการแก้ไข'
        : '<i class="bi bi-cloud-arrow-up-fill me-2"></i>เผยแพร่ลงเว็บไซต์';
    }
  }
}

// --------------------------------------------------
// Delete Announcement (staff-only)
// --------------------------------------------------

export async function deleteCurrentAnnouncement() {
  if (!viewingAnnouncementId) return;
  const post = globalAnnouncements.find((p) => p.id === viewingAnnouncementId);
  const titleHint = post ? `"${post.title}"` : '';
  if (!confirm(`ลบประกาศ ${titleHint} ใช่หรือไม่? ไม่สามารถกู้คืนได้`)) return;

  const idEsc = encodeURIComponent(viewingAnnouncementId);
  // return=representation lets us detect RLS no-ops as a real failure
  // instead of the supabase-js silent-success pattern (see mistakes.md).
  const { data, error } = await dbRest(
    `/announcements?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) {
    alert('ลบไม่สำเร็จ: ' + (error.message || 'unknown'));
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    alert('ลบไม่สำเร็จ — ไม่พบประกาศหรือคุณไม่มีสิทธิ์ลบ (ต้องเป็น pr_staff หรือ dev)');
    return;
  }

  // Return to the announcements grid and reload.
  closeArticleView();
  loadAnnouncements();
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
    // Try fetching with `excerpt` (post-migration-0008 column). If the
    // DB hasn't had 0008 applied yet, PostgREST returns 400 because the
    // column is in the select list. Retry without `excerpt` so the site
    // keeps working — renderers already fall back to the extracted
    // snippet when excerpt is empty. Log once so the dev sees the
    // pending migration.
    const baseSelect = 'id,title,content,department,thumbnail_url,created_at';
    let { data, error } = await dbRest(
      `/announcements?select=${baseSelect},excerpt&status=eq.approved&order=created_at.desc`
    );
    if (error && error.status === 400) {
      if (!window.__samoWarnedExcerpt) {
        window.__samoWarnedExcerpt = true;
        console.warn('[announcements] excerpt column missing — apply migration 0008_announcements_excerpt.sql to enable author-written subheads. Falling back to auto-snippet for now.');
      }
      ({ data, error } = await dbRest(
        `/announcements?select=${baseSelect}&status=eq.approved&order=created_at.desc`
      ));
    }
    if (error) throw new Error(`${error.status || ''} ${error.message || 'unknown'}`.trim());

    // Map DB rows to the shape the renderers expect. excerpt is the
    // author-written subhead; cards/article fall back to extracted
    // snippet if null (post-0008 column, see migration for context).
    globalAnnouncements = (data || []).map((row) => ({
      id: row.id.toString(),
      date: row.created_at
        ? new Date(row.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
        : '',
      title: row.title,
      department: row.department,
      excerpt: row.excerpt || '',
      content: row.content,
      thumbnail: row.thumbnail_url || '',
    }));
    container.innerHTML = '';

    if (globalAnnouncements.length === 0) {
      emptyState.classList.remove('d-none');
    } else {
      emptyState.classList.add('d-none');
      const cards = globalAnnouncements.map(renderNewsCard).join('');
      container.innerHTML = `<div class="news-grid news-grid--archive">${cards}</div>`;
    }
    renderHomeAnnouncements();
    // If the page loaded with #article/{id} before data was ready, open it now.
    handleArticleHash();
  } catch (error) {
    container.innerHTML =
      '<div class="col-12 text-center text-danger py-5"><i class="bi bi-exclamation-triangle fs-1"></i><p class="mt-3">เกิดข้อผิดพลาดในการโหลดข้อมูลประกาศ กรุณาลองใหม่อีกครั้ง</p></div>';
    renderHomeAnnouncements({ error: true });
  }
}

/**
 * Render announcements into the home page editorial layout: 1 featured
 * (large, image+excerpt) + up to 6 secondary cards (grid). Triggered after
 * loadAnnouncements() resolves so home and archive reflect the same data.
 */
function renderHomeAnnouncements({ error = false } = {}) {
  const featured = document.getElementById('homeNewsFeatured');
  const grid     = document.getElementById('homeNewsGrid');
  const empty    = document.getElementById('homeNewsEmpty');
  if (!featured || !grid) return;

  if (error) {
    featured.innerHTML = '';
    grid.innerHTML = '';
    if (empty) {
      empty.classList.remove('d-none');
      empty.innerHTML = '<i class="bi bi-exclamation-circle"></i><p>โหลดประกาศไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</p>';
    }
    return;
  }

  if (globalAnnouncements.length === 0) {
    featured.innerHTML = '';
    grid.innerHTML = '';
    if (empty) {
      empty.classList.remove('d-none');
      empty.innerHTML = '<i class="bi bi-inbox"></i><p>ยังไม่มีประกาศในขณะนี้</p>';
    }
    return;
  }

  if (empty) empty.classList.add('d-none');

  const [headPost, ...rest] = globalAnnouncements;
  featured.innerHTML = headPost ? renderNewsFeatured(headPost) : '';
  grid.innerHTML = rest.slice(0, 6).map(renderNewsCard).join('');
}

// --------------------------------------------------
// EDITORIAL CARD RENDERERS — used by home + archive
// --------------------------------------------------

const PLACEHOLDER_IMG =
  'https://images.unsplash.com/photo-1576091160550-2173ff9e5ee5?w=600&h=400&fit=crop';

function pickCover(post) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = post.content || '';
  const firstImg = tempDiv.querySelector('img');
  return convertDriveUrl(post.thumbnail)
    || convertDriveUrl(firstImg?.src)
    || PLACEHOLDER_IMG;
}

function extractSnippet(content, max = 140) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content || '';
  let text = (tempDiv.textContent || tempDiv.innerText || '').replace(/\s+/g, ' ').trim();
  if (text.length > max) text = text.slice(0, max).trim() + '…';
  return text;
}

function formatEditorialDate(post) {
  // post.date is already 'dd/mm/yy HH:MM' from the loader. Reformat to a
  // restrained '28 พ.ค. 2569' string when we can parse it back; otherwise
  // fall through as-is so we never show 'Invalid Date' to users.
  const raw = post.date || '';
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return raw;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthLabel = months[month - 1] || raw;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2500;          // 25 → 2525 (BE short form)
  else if (year < 2400) year += 543;     // 1981 → 2524 (CE → BE)
  return `${day} ${monthLabel} ${year}`;
}

function renderNewsFeatured(post) {
  const cover = pickCover(post);
  // Author-written subhead wins; fall back to extracted snippet for pre-0008 posts.
  const blurb = (post.excerpt || '').trim() || extractSnippet(post.content, 180);
  return `
    <a class="news-featured" onclick="viewAnnouncement('${escHtml(post.id)}')">
      <div class="news-featured-media">
        <img src="${escHtml(cover)}" alt="" loading="eager">
        <span class="news-featured-pin"><i class="bi bi-pin-angle-fill"></i> ฉบับล่าสุด</span>
      </div>
      <div class="news-featured-body">
        <span class="news-eyebrow">${escHtml(post.department || 'ประกาศ')}</span>
        <h3 class="news-featured-title">${escHtml(post.title)}</h3>
        ${blurb ? `<p class="news-featured-excerpt">${escHtml(blurb)}</p>` : ''}
        <div class="news-meta">
          <time>${escHtml(formatEditorialDate(post))}</time>
          <span class="news-meta-cta">อ่านต่อ <i class="bi bi-arrow-right"></i></span>
        </div>
      </div>
    </a>
  `;
}

function renderNewsCard(post) {
  const cover = pickCover(post);
  return `
    <a class="news-card" onclick="viewAnnouncement('${escHtml(post.id)}')">
      <div class="news-card-media"><img src="${escHtml(cover)}" alt="" loading="lazy"></div>
      <div class="news-card-body">
        <span class="news-eyebrow">${escHtml(post.department || 'ประกาศ')}</span>
        <h4 class="news-card-title">${escHtml(post.title)}</h4>
        <div class="news-meta">
          <time>${escHtml(formatEditorialDate(post))}</time>
        </div>
      </div>
    </a>
  `;
}

// --------------------------------------------------
// View Announcement — full-page article tab
// --------------------------------------------------

/**
 * Render the editorial article view HTML for a post (used by both the
 * reader tab and the creator's live preview pane).
 *
 *   options.isPreview — when true, suppresses the staff edit/delete
 *     action row and the loading state (everything is local).
 *
 * Quill-produced post.content is intentionally rendered raw (trusted —
 * only pr_staff / dev can publish). title / department / excerpt are
 * plain text and run through escHtml.
 */
export function renderArticleView(post, { isPreview = false } = {}) {
  if (!post) return '';
  const cover = pickCover(post);
  const dept = post.department || 'ประกาศ';
  const dateLabel = formatEditorialDate(post);
  const blurb = (post.excerpt || '').trim();
  return `
    <header class="article-header">
      <span class="article-eyebrow">${escHtml(dept)}</span>
      <h1 class="article-headline">${escHtml(post.title || '')}</h1>
      ${blurb ? `<p class="article-subhead">${escHtml(blurb)}</p>` : ''}
      <div class="article-byline">
        <span class="article-byline-item"><i class="bi bi-building"></i><span>${escHtml(dept)}</span></span>
        <span class="article-byline-item"><i class="bi bi-calendar3"></i><time>${escHtml(dateLabel)}</time></span>
      </div>
    </header>
    <div class="article-hero">
      <figure>
        <img src="${escHtml(cover)}" alt="" loading="eager">
      </figure>
    </div>
    <div class="article-body">${post.content || ''}</div>
    ${isPreview ? '' : `
      <footer class="article-foot">
        <a class="article-foot-back" href="#" onclick="event.preventDefault(); closeArticleView();">
          <i class="bi bi-arrow-left"></i> ดูประกาศทั้งหมด
        </a>
      </footer>
    `}
  `;
}

/**
 * Open a post in the full-page article tab. Updates the hash so the URL
 * is shareable, sets viewingAnnouncementId for the edit/delete buttons,
 * and rewrites any legacy Drive image URLs inside the rendered content.
 */
export function viewAnnouncement(id) {
  const post = globalAnnouncements.find((p) => p.id === String(id));
  if (!post) return;
  viewingAnnouncementId = post.id;

  // Activate the article tab first so the container is visible/sized.
  const tabBtn = document.getElementById('pills-article-tab');
  if (tabBtn && window.bootstrap) {
    window.bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  }

  const container = document.getElementById('articleContainer');
  if (container) {
    container.innerHTML = renderArticleView(post);
    // Rewrite legacy Drive URLs so embedded images render.
    container.querySelectorAll('img').forEach((img) => {
      const fixed = convertDriveUrl(img.getAttribute('src'));
      if (fixed) img.setAttribute('src', fixed);
    });
  }

  // Reveal staff-only actions (the role gating elsewhere flips d-none
  // based on [data-role-only]; we just have to make them present in DOM).
  // They're already in tab-article.html — nothing to inject here.

  // Sync the path so this view is shareable: /news/{id}.
  // pushState (not replaceState) so the browser back button returns
  // to the previous tab/path naturally.
  const want = `/news/${encodeURIComponent(post.id)}`;
  if (location.pathname !== want) history.pushState(null, '', want);

  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Return from the article reader back to the announcement archive. */
export function closeArticleView() {
  viewingAnnouncementId = null;
  // Prefer browser-back so we don't disturb the rest of the history
  // stack. Falls back to /news if the user landed directly on the
  // article URL (no entry to go back to).
  if (location.pathname.startsWith('/news/')) {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    history.replaceState(null, '', '/news');
  }
  const tabBtn = document.getElementById('pills-announcements-tab');
  if (tabBtn && window.bootstrap) {
    window.bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  }
}

/**
 * Article routing:
 *   /news/{id}    — new path form (used by viewAnnouncement)
 *   #article/{id} — legacy hash form (backward compat for shared links)
 *
 * Runs on initial load (after loadAnnouncements resolves), on hashchange
 * (covers legacy links), and on popstate (covers back/forward). Other
 * hash patterns (e.g. #projects/...) are left to their own modules.
 */
function handleArticleHash() {
  // Legacy hash → redirect to path
  const hashMatch = location.hash.match(/^#article\/(.+)$/);
  if (hashMatch) {
    const id = decodeURIComponent(hashMatch[1]);
    history.replaceState(null, '', `/news/${encodeURIComponent(id)}`);
    if (globalAnnouncements.length === 0) return; // wait for next load
    viewAnnouncement(id);
    return;
  }
  // Path form
  const pathMatch = location.pathname.match(/^\/news\/(.+)/);
  if (pathMatch) {
    const id = decodeURIComponent(pathMatch[1]);
    if (globalAnnouncements.length === 0) return;
    viewAnnouncement(id);
  }
}

// Register once — survives loadAnnouncements calls.
if (typeof window !== 'undefined' && !window.__samoArticleHashBound) {
  window.__samoArticleHashBound = true;
  window.addEventListener('hashchange', handleArticleHash);
}
