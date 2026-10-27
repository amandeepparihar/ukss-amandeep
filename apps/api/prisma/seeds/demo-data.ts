import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Determine which database provider to use
const databaseProvider = process.env.DATABASE_PROVIDER || 'postgresql';

let PrismaClientClass: any;
if (databaseProvider === 'mysql') {
  console.log('[Seed] Using MySQL/MariaDB database provider');
  const mysqlClient = require('.prisma/client-mysql');
  PrismaClientClass = mysqlClient.PrismaClient;
} else {
  console.log('[Seed] Using PostgreSQL database provider');
  const pgClient = require('@prisma/client');
  PrismaClientClass = pgClient.PrismaClient;
}

const prisma = new PrismaClientClass();

// Master data
const categories = [
  { name: 'electronics', description: 'Electronic devices and gadgets', sortOrder: 1 },
  { name: 'accessories', description: 'Phone and computer accessories', sortOrder: 2 },
  { name: 'clothing', description: 'Apparel and fashion items', sortOrder: 3 },
  { name: 'home-garden', description: 'Home and garden products', sortOrder: 4 },
  { name: 'sports', description: 'Sports and fitness equipment', sortOrder: 5 },
  { name: 'books', description: 'Books and publications', sortOrder: 6 },
  { name: 'toys', description: 'Toys and games', sortOrder: 7 },
  { name: 'food-beverage', description: 'Food and beverage items', sortOrder: 8 },
];

const statuses = [
  { name: 'active', label: 'Active', color: 'green', sortOrder: 1 },
  { name: 'draft', label: 'Draft', color: 'yellow', sortOrder: 2 },
  { name: 'archived', label: 'Archived', color: 'gray', sortOrder: 3 },
  { name: 'out-of-stock', label: 'Out of Stock', color: 'red', sortOrder: 4 },
];

const productPrefixes = ['Premium', 'Pro', 'Ultra', 'Classic', 'Modern', 'Vintage', 'Smart', 'Eco', 'Luxury', 'Budget'];
const productTypes: Record<string, string[]> = {
  electronics: ['Laptop', 'Smartphone', 'Tablet', 'Headphones', 'Speaker', 'Camera', 'Monitor', 'Keyboard', 'Mouse', 'Charger'],
  accessories: ['Case', 'Stand', 'Cable', 'Adapter', 'Mount', 'Holder', 'Bag', 'Cover', 'Screen Protector', 'Dock'],
  clothing: ['T-Shirt', 'Jeans', 'Jacket', 'Sweater', 'Dress', 'Shorts', 'Hoodie', 'Socks', 'Hat', 'Scarf'],
  'home-garden': ['Lamp', 'Chair', 'Table', 'Planter', 'Rug', 'Curtains', 'Pillow', 'Vase', 'Clock', 'Mirror'],
  sports: ['Ball', 'Racket', 'Weights', 'Mat', 'Bike', 'Helmet', 'Gloves', 'Shoes', 'Bag', 'Watch'],
  books: ['Novel', 'Textbook', 'Guide', 'Manual', 'Biography', 'Cookbook', 'Journal', 'Magazine', 'Comic', 'Encyclopedia'],
  toys: ['Action Figure', 'Puzzle', 'Board Game', 'Doll', 'Car', 'Building Set', 'Stuffed Animal', 'Robot', 'Drone', 'RC Car'],
  'food-beverage': ['Coffee', 'Tea', 'Snack', 'Chocolate', 'Sauce', 'Spice', 'Drink', 'Cereal', 'Pasta', 'Oil'],
};

export async function seedDemoData(productCount: number = 10000) {
  console.log(`Seeding demo data (${productCount.toLocaleString()} products)...`);

  // 1. Seed categories
  console.log('Creating categories...');
  const categoryMap: Record<string, string> = {};
  for (const cat of categories) {
    const created = await prisma.demoCategory.upsert({
      where: { name: cat.name },
      update: cat,
      create: cat,
    });
    categoryMap[cat.name] = created.id;
  }
  console.log(`Created ${categories.length} categories`);

  // 2. Seed statuses
  console.log('Creating statuses...');
  const statusMap: Record<string, string> = {};
  for (const status of statuses) {
    const created = await prisma.demoStatus.upsert({
      where: { name: status.name },
      update: status,
      create: status,
    });
    statusMap[status.name] = created.id;
  }
  console.log(`Created ${statuses.length} statuses`);

  // 3. Check existing count
  const existingCount = await prisma.demoProduct.count();
  if (existingCount >= productCount) {
    console.log(`Already have ${existingCount.toLocaleString()} products, skipping`);
    return;
  }

  const toCreate = productCount - existingCount;
  console.log(`Creating ${toCreate.toLocaleString()} new products...`);

  // 4. Generate products in batches
  const batchSize = 5000; // Larger batches for speed
  const categoryNames = Object.keys(categoryMap);
  const statusNames = Object.keys(statusMap);

  const startTime = Date.now();
  let created = 0;

  for (let batch = 0; batch < Math.ceil(toCreate / batchSize); batch++) {
    const products = [];
    const start = existingCount + (batch * batchSize);
    const end = Math.min(start + batchSize, productCount);

    for (let i = start; i < end; i++) {
      const categoryName = categoryNames[i % categoryNames.length];
      const types = productTypes[categoryName] || ['Product'];
      const prefix = productPrefixes[Math.floor(Math.random() * productPrefixes.length)];
      const type = types[Math.floor(Math.random() * types.length)];
      const statusName = statusNames[Math.floor(Math.random() * statusNames.length)];

      const price = Math.round((Math.random() * 500 + 10) * 100) / 100;
      const stock = statusName === 'out-of-stock' ? 0 : Math.floor(Math.random() * 1000);
      const daysAgo = Math.floor(Math.random() * 365);

      products.push({
        sku: `SKU-${(i + 1).toString().padStart(8, '0')}`,
        name: `${prefix} ${type} ${i + 1}`,
        description: `High quality ${type.toLowerCase()} from our ${categoryName} collection`,
        price,
        stock,
        categoryId: categoryMap[categoryName],
        statusId: statusMap[statusName],
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });
    }

    await prisma.demoProduct.createMany({
      data: products,
      skipDuplicates: true,
    });

    created += products.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = Math.round(created / parseFloat(elapsed));
    const remaining = toCreate - created;
    const eta = remaining > 0 ? Math.round(remaining / rate) : 0;

    console.log(`Progress: ${created.toLocaleString()}/${toCreate.toLocaleString()} (${elapsed}s, ${rate}/s, ETA: ${eta}s)`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Demo data seeding completed in ${totalTime}s!`);
}

// Allow running directly: npx tsx prisma/seeds/demo-data.ts 10000000
const args = process.argv.slice(2);
if (args.length > 0) {
  const count = parseInt(args[0], 10) || 10000;
  seedDemoData(count)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
