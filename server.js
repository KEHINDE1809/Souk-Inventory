// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const dayjs = require('dayjs');

const DB_FILE = path.join(__dirname, 'souk_inventory.db');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const app = express();
app.use(bodyParser.json());
app.use(cors());

// Initialize DB
const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE);

function runSqlFile(filename) {
  const sql = fs.readFileSync(filename, 'utf8');
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function initDb() {
  if (!dbExists) {
    console.log('Creating DB from schema...');
    await runSqlFile(SCHEMA_FILE);
    console.log('DB initialized.');
  } else {
    console.log('Using existing DB:', DB_FILE);
  }
}

// Utility queries wrapped in promises
function run(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function all(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function get(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/* ---------- Business logic ---------- */

const LEAD_TIME_DAYS = 3; // fixed lead time

async function getWarehouseCurrentStock(warehouse_id) {
  const row = await get(
    `SELECT IFNULL(SUM(quantity_in_stock),0) as total FROM products WHERE warehouse_id = ?`,
    [warehouse_id]
  );
  return row ? row.total : 0;
}

async function ensureReorderForProduct(product) {
  /*
    product: {id, sku, name, quantity_in_stock, reorder_threshold, default_supplier_id, warehouse_id}
  */
  if (!product) return null;
  if (product.quantity_in_stock >= product.reorder_threshold) return null;

  const shortage = product.reorder_threshold - product.quantity_in_stock;
  // For practicality, request to bring stock to (reorder_threshold * 2)
  const desired_qty = product.reorder_threshold * 2 - product.quantity_in_stock;
  const warehouseCurrent = await getWarehouseCurrentStock(product.warehouse_id);
  const warehouseRow = await get(`SELECT * FROM warehouses WHERE id = ?`, [product.warehouse_id]);
  const availableSpace = warehouseRow.capacity - warehouseCurrent;

  if (availableSpace <= 0) {
    // create PO with quantity 0 (flag capacity issue)
    const orderDate = dayjs().format('YYYY-MM-DD');
    const expected = dayjs().add(LEAD_TIME_DAYS, 'day').format('YYYY-MM-DD');
    const res = await run(
      `INSERT INTO purchase_orders (product_id, supplier_id, warehouse_id, quantity_ordered, order_date, expected_arrival_date, status, capacity_issue)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`,
       [product.id, product.default_supplier_id || 1, product.warehouse_id, 0, orderDate, expected]
    );
    return { created: true, orderId: res.lastID, capacity_issue: true, quantity_ordered: 0 };
  } else {
    const qtyToOrder = Math.min(desired_qty, availableSpace);
    const orderDate = dayjs().format('YYYY-MM-DD');
    const expected = dayjs().add(LEAD_TIME_DAYS, 'day').format('YYYY-MM-DD');
    const res = await run(
      `INSERT INTO purchase_orders (product_id, supplier_id, warehouse_id, quantity_ordered, order_date, expected_arrival_date, status, capacity_issue)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [product.id, product.default_supplier_id || 1, product.warehouse_id, qtyToOrder, orderDate, expected]
    );
    return { created: true, orderId: res.lastID, capacity_issue: false, quantity_ordered: qtyToOrder };
  }
}

/* ---------- Routes ---------- */

// GET products (with auto-reorder check each call to ensure low-stock items get POs)
app.get('/products', async (req, res) => {
  try {
    const products = await all(`SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name
                                FROM products p
                                LEFT JOIN suppliers s ON p.default_supplier_id = s.id
                                LEFT JOIN warehouses w ON p.warehouse_id = w.id`);
    // For each product check reorder (but only create PO if not already an outstanding PO)
    for (const product of products) {
      const existingPO = await get(`SELECT * FROM purchase_orders WHERE product_id = ? AND warehouse_id = ? AND status = 'pending'`,
                                   [product.id, product.warehouse_id]);
      if (product.quantity_in_stock < product.reorder_threshold && !existingPO) {
        await ensureReorderForProduct(product);
      }
    }
    const updated = await all(`SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name
                                FROM products p
                                LEFT JOIN suppliers s ON p.default_supplier_id = s.id
                                LEFT JOIN warehouses w ON p.warehouse_id = w.id`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET single product
app.get('/products/:id', async (req, res) => {
  try {
    const p = await get(`SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name
                         FROM products p
                         LEFT JOIN suppliers s ON p.default_supplier_id = s.id
                         LEFT JOIN warehouses w ON p.warehouse_id = w.id
                         WHERE p.id = ?`, [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    // auto-reorder if below threshold and no pending PO
    const existingPO = await get(`SELECT * FROM purchase_orders WHERE product_id = ? AND warehouse_id = ? AND status = 'pending'`,
                                 [p.id, p.warehouse_id]);
    if (p.quantity_in_stock < p.reorder_threshold && !existingPO) {
      await ensureReorderForProduct(p);
    }
    const refreshed = await get(`SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name
                                 FROM products p
                                 LEFT JOIN suppliers s ON p.default_supplier_id = s.id
                                 LEFT JOIN warehouses w ON p.warehouse_id = w.id
                                 WHERE p.id = ?`, [req.params.id]);
    res.json(refreshed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adjust stock: body { delta: integer, reason: string }
// delta can be negative (sale) or positive (manual adjustment)
app.post('/products/:id/adjust-stock', async (req, res) => {
  try {
    const id = req.params.id;
    const { delta, reason } = req.body;
    if (typeof delta !== 'number') return res.status(400).json({ error: 'delta must be a number' });

    const product = await get(`SELECT * FROM products WHERE id = ?`, [id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const newQty = product.quantity_in_stock + delta;
    if (newQty < 0) return res.status(400).json({ error: 'Resulting stock cannot be negative' });

    await run(`UPDATE products SET quantity_in_stock = ? WHERE id = ?`, [newQty, id]);

    // Insert a simple audit (optional table could be added; for now we log)
    console.log(`Stock adjusted for product ${product.sku}: delta=${delta}, reason=${reason || 'N/A'}`);

    // After update, check reorder
    const updatedProduct = await get(`SELECT * FROM products WHERE id = ?`, [id]);
    // If below threshold and no pending PO -> create PO
    const existingPO = await get(`SELECT * FROM purchase_orders WHERE product_id = ? AND warehouse_id = ? AND status = 'pending'`,
                                 [id, updatedProduct.warehouse_id]);
    let reorderInfo = null;
    if (updatedProduct.quantity_in_stock < updatedProduct.reorder_threshold && !existingPO) {
      reorderInfo = await ensureReorderForProduct(updatedProduct);
    }

    res.json({ success: true, product: updatedProduct, reorder: reorderInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get purchase orders
app.get('/orders', async (req, res) => {
  try {
    const orders = await all(`SELECT po.*, p.sku AS product_sku, p.name AS product_name, s.name as supplier_name, w.name as warehouse_name
                              FROM purchase_orders po
                              JOIN products p ON po.product_id = p.id
                              JOIN suppliers s ON po.supplier_id = s.id
                              JOIN warehouses w ON po.warehouse_id = w.id
                              ORDER BY po.id DESC`);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create manual purchase order
// body: { product_id, supplier_id (optional), warehouse_id (optional), quantity_ordered }
app.post('/orders', async (req, res) => {
  try {
    const { product_id, supplier_id, warehouse_id, quantity_ordered } = req.body;
    if (!product_id || typeof quantity_ordered !== 'number') {
      return res.status(400).json({ error: 'product_id and quantity_ordered required' });
    }
    const p = await get(`SELECT * FROM products WHERE id = ?`, [product_id]);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    const supplier = supplier_id || p.default_supplier_id || 1;
    const warehouse = warehouse_id || p.warehouse_id;

    // capacity check
    const warehouseRow = await get(`SELECT * FROM warehouses WHERE id = ?`, [warehouse]);
    const currentStock = await getWarehouseCurrentStock(warehouse);
    const available = warehouseRow.capacity - currentStock;

    let qty = quantity_ordered;
    let capacity_issue = 0;
    if (available <= 0) {
      qty = 0;
      capacity_issue = 1;
    } else if (qty > available) {
      qty = available;
      capacity_issue = 1;
    }

    const orderDate = dayjs().format('YYYY-MM-DD');
    const expected = dayjs().add(LEAD_TIME_DAYS, 'day').format('YYYY-MM-DD');
    const r = await run(
      `INSERT INTO purchase_orders (product_id, supplier_id, warehouse_id, quantity_ordered, order_date, expected_arrival_date, status, capacity_issue)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [product_id, supplier, warehouse, qty, orderDate, expected, capacity_issue]
    );
    res.json({ created: true, id: r.lastID, quantity_ordered: qty, capacity_issue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Receive purchase order: marks as received and updates product stock
app.post('/orders/:id/receive', async (req, res) => {
  try {
    const id = req.params.id;
    const po = await get(`SELECT * FROM purchase_orders WHERE id = ?`, [id]);
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status === 'received') return res.status(400).json({ error: 'Already received' });

    // Re-check capacity before receiving (maybe some stock changed)
    const warehouseRow = await get(`SELECT * FROM warehouses WHERE id = ?`, [po.warehouse_id]);
    const currentStock = await getWarehouseCurrentStock(po.warehouse_id);
    const available = warehouseRow.capacity - currentStock;
    let qtyToAdd = po.quantity_ordered;
    if (qtyToAdd > available) {
      // adjust down (partial receive)
      qtyToAdd = Math.max(0, available);
    }

    if (qtyToAdd > 0) {
      await run(`UPDATE products SET quantity_in_stock = quantity_in_stock + ? WHERE id = ?`, [qtyToAdd, po.product_id]);
    }

    await run(`UPDATE purchase_orders SET status = 'received' WHERE id = ?`, [id]);

    res.json({ received: true, added_quantity: qtyToAdd, capacity_limited: qtyToAdd < po.quantity_ordered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get warehouses
app.get('/warehouses', async (req, res) => {
  try {
    const rows = await all(`SELECT *, (capacity - IFNULL((SELECT SUM(quantity_in_stock) FROM products WHERE warehouse_id = warehouses.id),0)) AS available_space
                            FROM warehouses`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start
const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('Server started on port', PORT);
    console.log(`GET /products for products, GET /orders for purchase orders`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
});
