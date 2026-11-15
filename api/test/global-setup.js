// Dựng CSDL kiểm thử thật từ db/schema.sql + migrations (không mock). Yêu cầu PostgreSQL >= 15 và Redis đang chạy.
//   TEST_DATABASE_ADMIN_URL  (mặc định postgres://mta_test:mta_test@localhost:5432/postgres) — role có quyền tạo DB/extension
//   TEST_REDIS_URL           (mặc định redis://localhost:6379/15) — DB 15 bị FLUSH trong test
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const DB_NAME = 'mta_api_test';
const FILES = ['schema.sql', 'migrations/002_policy_alignment.sql', 'migrations/003_auth_support.sql'];

module.exports = async () => {
  const admin = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://mta_test:mta_test@localhost:5432/postgres';
  const a = new Client({ connectionString: admin });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${DB_NAME}`);
  await a.end();

  const url = new URL(admin);
  url.pathname = `/${DB_NAME}`;
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  for (const f of FILES) await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', f), 'utf8'));
  await c.end();
};
