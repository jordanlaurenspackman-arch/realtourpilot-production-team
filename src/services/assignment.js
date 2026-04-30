const { getDb } = require('../db/database');

// Returns the editor to assign, using the configured strategy.
// round-robin cycles through all active editors in order.
// least-busy picks the editor with the fewest open (non-delivered) jobs.
function pickEditor() {
  const db = getDb();
  const strategy = process.env.ASSIGNMENT_STRATEGY || 'round-robin';

  const editors = db
    .prepare(`SELECT * FROM editors WHERE active = 1 ORDER BY id`)
    .all();

  if (!editors.length) return null;

  if (strategy === 'least-busy') {
    const counts = db
      .prepare(`
        SELECT assigned_editor_id, COUNT(*) as cnt
        FROM jobs
        WHERE assigned_editor_id IS NOT NULL
          AND status NOT IN ('delivered', 'new')
        GROUP BY assigned_editor_id
      `)
      .all();

    const countMap = {};
    counts.forEach(r => { countMap[r.assigned_editor_id] = r.cnt; });

    editors.sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0));
    return editors[0];
  }

  // round-robin
  const cursor = db.prepare(`SELECT editor_idx FROM assignment_cursor WHERE id = 1`).get();
  const idx = cursor.editor_idx % editors.length;
  const editor = editors[idx];

  db.prepare(`UPDATE assignment_cursor SET editor_idx = ? WHERE id = 1`).run(idx + 1);
  return editor;
}

function assignJob(jobId) {
  const db = getDb();
  const editor = pickEditor();
  if (!editor) return null;

  db.prepare(`
    UPDATE jobs
    SET assigned_editor_id = ?, status = 'assigned', updated_at = datetime('now')
    WHERE id = ?
  `).run(editor.id, jobId);

  db.prepare(`
    INSERT INTO job_assignments (job_id, editor_id) VALUES (?, ?)
  `).run(jobId, editor.id);

  return editor;
}

module.exports = { assignJob, pickEditor };
