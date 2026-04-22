import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.sqlite'));

// Wipe and recreate on each start (intentional dev workflow)
db.exec(`DROP TABLE IF EXISTS transactions;`);

db.exec(`
  CREATE TABLE transactions (
    Row_ID       INTEGER PRIMARY KEY AUTOINCREMENT,
    Order_ID     TEXT,
    Order_Date   TEXT,
    Product_Name TEXT,
    Sales        REAL,
    Category     TEXT,
    type         TEXT NOT NULL DEFAULT 'expense'
  );
`);

export default db;
