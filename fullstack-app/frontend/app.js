// ==============================================================================
// Contact Form — Frontend JavaScript
// ==============================================================================
// Uses /api/submissions endpoint (reverse-proxied by Nginx to backend).
// Supports: POST (submit form), GET (list), DELETE (remove entry).
// ==============================================================================

const API = '/api/submissions';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const submitForm    = document.getElementById('submit-form');
const nameInput     = document.getElementById('name');
const emailInput    = document.getElementById('email');
const messageInput  = document.getElementById('message');
const submitBtn     = document.getElementById('submit-btn');
const formFeedback  = document.getElementById('form-feedback');
const listEl        = document.getElementById('submissions-list');
const refreshBtn    = document.getElementById('refresh-btn');
const healthBadge   = document.getElementById('health-badge');
const healthText    = document.getElementById('health-text');

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiPost(data) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, data: await res.json() };
}

async function apiGet() {
  const res = await fetch(API);
  if (!res.ok) throw new Error('Failed to fetch submissions');
  return res.json();
}

async function apiDelete(id) {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Render submissions
// ---------------------------------------------------------------------------
function renderSubmissions(submissions) {
  if (!submissions.length) {
    listEl.innerHTML = '<p class="empty-state">No submissions yet.</p>';
    return;
  }

  listEl.innerHTML = submissions.map(s => `
    <div class="submission-item" data-id="${s.id}">
      <div class="submission-meta">
        <div>
          <div class="submission-name">${escapeHtml(s.name)}</div>
          <div class="submission-email">${escapeHtml(s.email)}</div>
        </div>
        <div class="submission-date">${formatDate(s.created_at)}</div>
      </div>
      <div class="submission-message">${escapeHtml(s.message)}</div>
      <div class="submission-actions">
        <button class="btn-delete" data-id="${s.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Load all submissions
// ---------------------------------------------------------------------------
async function loadSubmissions() {
  listEl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const submissions = await apiGet();
    renderSubmissions(submissions);
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state" style="color:var(--danger)">Failed to load: ${err.message}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Handle form submit
// ---------------------------------------------------------------------------
submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFeedback('', '');

  const payload = {
    name:    nameInput.value.trim(),
    email:   emailInput.value.trim(),
    message: messageInput.value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  try {
    const { ok, data } = await apiPost(payload);
    if (ok) {
      setFeedback('✅ Message sent successfully!', 'success');
      submitForm.reset();
      loadSubmissions();
    } else {
      setFeedback(`❌ Error: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    setFeedback(`❌ Network error: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Message';
  }
});

// ---------------------------------------------------------------------------
// Handle delete (event delegation)
// ---------------------------------------------------------------------------
listEl.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('btn-delete')) return;
  const id = e.target.dataset.id;
  const ok = await apiDelete(id);
  if (ok) {
    const item = document.querySelector(`.submission-item[data-id="${id}"]`);
    if (item) item.remove();
    // Show empty state if no items left
    if (!document.querySelector('.submission-item')) {
      listEl.innerHTML = '<p class="empty-state">No submissions yet.</p>';
    }
  }
});

// ---------------------------------------------------------------------------
// Refresh button
// ---------------------------------------------------------------------------
refreshBtn.addEventListener('click', loadSubmissions);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
async function checkHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      healthBadge.className = 'health-badge ok';
      healthText.textContent = 'API healthy';
    } else {
      throw new Error();
    }
  } catch {
    healthBadge.className = 'health-badge fail';
    healthText.textContent = 'API offline';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setFeedback(msg, type) {
  formFeedback.textContent = msg;
  formFeedback.className   = `form-feedback${type ? ' ' + type : ''}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(function init() {
  loadSubmissions();
  checkHealth();
  setInterval(checkHealth, 30000);
})();
