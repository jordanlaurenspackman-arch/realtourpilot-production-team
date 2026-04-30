require('dotenv').config();
const { getDb } = require('../src/db/database');

const db = getDb();

const editors = [
  { name: 'Kim', slack_user_id: 'U0ASP9C1WRK', email: 'kim@realtourpilot.com' },
];

const insert = db.prepare(`
  INSERT INTO editors (name, slack_user_id, email)
  VALUES (@name, @slack_user_id, @email)
  ON CONFLICT (slack_user_id) DO UPDATE SET
    name  = excluded.name,
    email = excluded.email
`);

editors.forEach(e => {
  insert.run(e);
  console.log(`✓ Editor seeded: ${e.name} (${e.slack_user_id})`);
});

console.log('Seed complete.');
process.exit(0);
