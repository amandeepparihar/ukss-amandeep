import { prisma } from '../../../lib/prisma';

async function main() {
  const tables = ['orders', 'orders_products', 'new_products', 'product_types', 'orders_products_attributes', 'teams'];

  for (const table of tables) {
    try {
      const cols = await prisma.$queryRawUnsafe<any[]>(`DESCRIBE ${table}`);
      console.log(`\n=== ${table} ===`);
      cols.forEach((c: any) => console.log(`  ${c.Field} (${c.Type})`));
    } catch (e: any) {
      console.log(`\n=== ${table} === ERROR: ${e.message?.slice(0, 100)}`);
    }
  }

  process.exit(0);
}

main();
