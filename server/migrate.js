/* Simple migration runner: executes server/migrations/init.sql against server/data/db.sqlite */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');
const SQL_PATH = path.join(__dirname, 'migrations', 'init.sql');

function run() {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const db = new sqlite3.Database(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql, (err) => {
    if (err) {
      console.error('Migration failed:', err);
      process.exit(1);
    } else {
      console.log('Migrations applied successfully');
      db.close();
    }
  });
}

if (require.main === module) run();

module.exports = { run };
