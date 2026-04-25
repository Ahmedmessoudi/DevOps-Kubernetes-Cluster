// ==============================================================================
// Form Submission API — Express.js + PostgreSQL
// ==============================================================================
// Endpoints:
//   POST   /api/submissions        — Submit a new form (name, email, message)
//   GET    /api/submissions        — Get all submissions
//   GET    /api/submissions/:id    — Get one submission by ID
//   PUT    /api/submissions/:id    — Update a submission
//   DELETE /api/submissions/:id    — Delete a submission
//   GET    /health                 — Health check
// ==============================================================================

const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// PostgreSQL connection pool
// ---------------------------------------------------------------------------
const pool = new Pool({
  host:     process.env.PG_HOST     || 'postgres-service',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB       || 'formdb',
  user:     process.env.PG_USER     || 'formuser',
  password: process.env.PG_PASSWORD || 'formpassword',
});

// ---------------------------------------------------------------------------
// Auto-create the submissions table on startup
// ---------------------------------------------------------------------------
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        email      VARCHAR(150) NOT NULL,
        message    TEXT         NOT NULL,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );
    `);
    console.log('✅ Database table ready');
  } catch (err) {
    console.error('❌ Failed to initialise database:', err.message);
    // Retry after 5 seconds (Postgres may not be ready yet)
    setTimeout(initDB, 5000);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch {}
  res.json({
    status:   'healthy',
    service:  'fullstack-backend',
    database: dbStatus,
    hostname: require('os').hostname(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/submissions — create a new submission
// ---------------------------------------------------------------------------
app.post('/api/submissions', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email and message are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO submissions (name, email, message) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), email.trim(), message.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/submissions — list all submissions (newest first)
// ---------------------------------------------------------------------------
app.get('/api/submissions', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM submissions ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/submissions/:id — get one submission
// ---------------------------------------------------------------------------
app.get('/api/submissions/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM submissions WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/submissions/:id — update a submission
// ---------------------------------------------------------------------------
app.put('/api/submissions/:id', async (req, res) => {
  const { name, email, message } = req.body;
  try {
    const result = await pool.query(
      `UPDATE submissions
       SET name    = COALESCE($1, name),
           email   = COALESCE($2, email),
           message = COALESCE($3, message)
       WHERE id = $4
       RETURNING *`,
      [name || null, email || null, message || null, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/submissions/:id — delete a submission
// ---------------------------------------------------------------------------
app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM submissions WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
initDB();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Form API running on port ${PORT}`);
});
