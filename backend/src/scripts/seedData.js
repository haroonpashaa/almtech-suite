// Shared seeder used by both the standalone CLI script and the server bootstrap.
import User from '../models/User.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Settings from '../models/Settings.js';

export async function seedAll({ force = false } = {}) {
  if (!force) {
    const userCount = await User.countDocuments();
    if (userCount > 0) return { skipped: true, reason: 'users already exist' };
  }

  const settings = await Settings.getSingleton();
  Object.assign(settings, {
    businessName: 'ALMTech',
    address: 'Birmingham, UK',
    email: 'info@almtraders.org',
    phone: '+44 7300 019359',
    currency: 'PKR',
    defaultTaxRate: 0,
  });
  await settings.save();

  const users = [
    { name: 'Admin', email: 'admin@almtech.org', password: 'admin1234', role: 'admin' },
    { name: 'Sales One', email: 'sales@almtech.org', password: 'sales1234', role: 'sales' },
    { name: 'Stock One', email: 'stock@almtech.org', password: 'stock1234', role: 'stock' },
  ];
  for (const u of users) {
    if (!(await User.findOne({ email: u.email }))) await User.create(u);
  }

  const products = [
    { name: 'MacBook Pro 14" M3', sku: 'APL-MBP14-M3', brand: 'Apple', model: 'MBP14-M3', category: 'Laptops', purchasePrice: 1450, sellingPrice: 1799, stock: 12, lowStockThreshold: 3, tracksSerials: true },
    { name: 'Dell XPS 13', sku: 'DEL-XPS13', brand: 'Dell', model: 'XPS13', category: 'Laptops', purchasePrice: 950, sellingPrice: 1199, stock: 20, lowStockThreshold: 5, tracksSerials: true },
    { name: 'HP EliteBook 840', sku: 'HP-EB840', brand: 'HP', model: 'EliteBook 840', category: 'Laptops', purchasePrice: 780, sellingPrice: 999, stock: 8, lowStockThreshold: 4, tracksSerials: true },
    { name: 'Lenovo ThinkPad X1 Carbon', sku: 'LEN-X1C', brand: 'Lenovo', model: 'X1 Carbon', category: 'Laptops', purchasePrice: 1100, sellingPrice: 1399, stock: 6, lowStockThreshold: 3, tracksSerials: true },
    { name: 'Kingston 16GB DDR4', sku: 'KIN-16DDR4', brand: 'Kingston', model: '16DDR4', category: 'RAM', purchasePrice: 30, sellingPrice: 45, stock: 100, lowStockThreshold: 20 },
    { name: 'Samsung 970 EVO 1TB SSD', sku: 'SAM-970-1TB', brand: 'Samsung', model: '970 EVO', category: 'Storage', purchasePrice: 65, sellingPrice: 89, stock: 40, lowStockThreshold: 10 },
    { name: 'LG 27" 4K Monitor', sku: 'LG-27-4K', brand: 'LG', model: '27UL500', category: 'Monitors', purchasePrice: 220, sellingPrice: 299, stock: 14, lowStockThreshold: 5 },
    { name: 'HP LaserJet Pro M404', sku: 'HP-LJM404', brand: 'HP', model: 'LaserJet Pro M404', category: 'Printers', purchasePrice: 180, sellingPrice: 249, stock: 9, lowStockThreshold: 3 },
  ];
  for (const p of products) {
    if (!(await Product.findOne({ sku: p.sku }))) await Product.create(p);
  }

  const customers = [
    { name: 'Bilal Khan', company: 'Khan Electronics', phone: '+92 300 1234567', email: 'bilal@khanelectronics.pk', address: 'Lahore', creditLimit: 50000 },
    { name: 'Ayesha Malik', company: 'Tech World', phone: '+92 321 9876543', email: 'ayesha@techworld.pk', address: 'Karachi', creditLimit: 30000 },
    { name: 'Hamid Stores', company: 'Hamid Computers', phone: '+44 7700 900123', email: 'sales@hamid.uk', address: 'Birmingham', creditLimit: 100000 },
  ];
  for (const c of customers) {
    if (!(await Customer.findOne({ email: c.email }))) await Customer.create(c);
  }

  const suppliers = [
    { name: 'Asia Trading Co.', contactPerson: 'Mr. Tariq', phone: '+971 50 1234567', email: 'tariq@asiatrading.ae', address: 'Sharjah, UAE', taxNumber: 'AE100000001' },
    { name: 'Global IT Distributors', contactPerson: 'Mr. Ali', phone: '+92 42 35000000', email: 'ali@globalitdist.pk', address: 'Lahore, PK' },
  ];
  for (const s of suppliers) {
    if (!(await Supplier.findOne({ email: s.email }))) await Supplier.create(s);
  }

  return { skipped: false };
}
