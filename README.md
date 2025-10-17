# 🏷️ Souk Inventory Management System

**Developer:** Kehinde Adara  
**Tech Stack:** Node.js, Express, SQLite, TailwindCSS, Chart.js  

---

## 📘 Overview

Souk Inventory Management System is a lightweight full-stack application designed to help businesses efficiently manage products, suppliers, and warehouses.

It provides visibility into stock levels, tracks purchase orders, and automatically triggers restocking when thresholds are reached.

---

## ⚙️ Features

✅ View product stock levels and reorder thresholds  
✅ Monitor purchase orders and suppliers  
✅ Adjust stock levels in real-time  
✅ Automatic reordering logic when inventory is low  
✅ Warehouse capacity check before creating purchase orders  
✅ Modern dashboard built with Tailwind CSS and Chart.js  

---

## 🧠 Technical Stack

| Layer | Technology |
|--------|-------------|
| Backend | Node.js + Express |
| Database | SQLite |
| Frontend | HTML + TailwindCSS + JavaScript |
| Visualization | Chart.js |
| Architecture | RESTful API |

---

## 📦 API Endpoints

| Method | Endpoint | Description |
|--------|-----------|-------------|
| GET | `/products` | Get all products |
| GET | `/orders` | Get all purchase orders |
| POST | `/products/:id/adjust` | Adjust stock quantity |

---

## 🚀 Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/kehinde1809/souk-inventory.git
   cd souk-inventory
