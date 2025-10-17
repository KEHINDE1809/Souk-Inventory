PRAGMA foreign_keys = ON;

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_info TEXT
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  capacity INTEGER NOT NULL -- capacity in units
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  reorder_threshold INTEGER NOT NULL DEFAULT 10,
  quantity_in_stock INTEGER NOT NULL DEFAULT 0,
  default_supplier_id INTEGER,
  warehouse_id INTEGER NOT NULL,
  FOREIGN KEY (default_supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  quantity_ordered INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  expected_arrival_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'received' | 'cancelled'
  capacity_issue INTEGER DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- SAMPLE DATA
INSERT INTO suppliers (name, contact_info) VALUES ('Alpha Supplies', 'alpha@example.com');
INSERT INTO suppliers (name, contact_info) VALUES ('Beta Traders', 'beta@example.com');

INSERT INTO warehouses (name, location, capacity) VALUES ('Lekki Warehouse', 'Lekki, Lagos', 100);
INSERT INTO warehouses (name, location, capacity) VALUES ('Ikeja Warehouse', 'Ikeja, Lagos', 200);

-- Products: assign to warehouses (warehouse_id)
INSERT INTO products (sku, name, description, reorder_threshold, quantity_in_stock, default_supplier_id, warehouse_id)
VALUES ('SKU-001', 'LED Bulb 9W', 'Energy-saving LED bulb', 10, 8, 1, 1);

INSERT INTO products (sku, name, description, reorder_threshold, quantity_in_stock, default_supplier_id, warehouse_id)
VALUES ('SKU-002', 'Extension Cord', '3m extension cord', 20, 25, 2, 1);

INSERT INTO products (sku, name, description, reorder_threshold, quantity_in_stock, default_supplier_id, warehouse_id)
VALUES ('SKU-003', 'USB Cable', 'Type-C cable', 50, 40, 1, 2);
