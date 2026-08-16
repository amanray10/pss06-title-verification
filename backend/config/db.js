/**
 * PSS06 - MySQL connection pool.
 *
 * A pool rather than a single connection: verification requests are short and
 * bursty, and 160,000-row lookups should never queue behind one another.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'prgi',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
};

export const pool = mysql.createPool(dbConfig);

let connected = null;

/** Verify the database is reachable. Cached after the first successful check. */
export async function checkConnection() {
  if (connected === true) return true;
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    connected = true;
    console.log(`[db] connected to mysql://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
    return true;
  } catch (err) {
    connected = false;
    console.error(`[db] NOT connected: ${err.message}`);
    return false;
  }
}

export function isConnected() {
  return connected === true;
}

/** Convenience wrapper - returns rows only. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export default pool;
