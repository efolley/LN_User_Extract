const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');

function open() {
  const db = new sqlite3.Database(DB_PATH);
  db.serialize();
  return db;
}

function run(sql, params = []) {
  const db = open();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      db.close();
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  const db = open();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  const db = open();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { run, get, all, DB_PATH };
