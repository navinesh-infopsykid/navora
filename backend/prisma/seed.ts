/**
 * Sample data: business settings + KRIVA PATISSERIE menu items.
 * Safe to run more than once (products are matched by SKU and not duplicated).
 *
 *   npm run db:seed
 */
import { prisma } from "../src/lib/db";

/**
 * Opening stock given to every item when it is first created.
 * Change these numbers before seeding, or adjust stock later from the
 * Stock adjustment page (every change is recorded in the history).
 */
const OPENING_STOCK = 20;
const LOW_STOCK_ALERT = 5;

// SKU prefixes: PD = Pastries & Desserts, SF = Sugarfree, EG = Eggless,
// SV = Savouries (Veg), SN = Savouries (Non-Veg). Type a prefix on the billing screen to filter.
const products = [
  // Pastries & Desserts
  { sku: "PD-CHOC-CARAMEL-SANDWICH", name: "Chocolate Caramel Sandwich", price: 149 },
  { sku: "PD-BLUEBERRY-CHEESECAKE", name: "Blueberry Cheesecake", price: 149 },
  { sku: "PD-BASQUE-CHEESECAKE", name: "Basque Cheesecake", price: 129 },
  { sku: "PD-CHOC-ECLAIR", name: "Chocolate Eclair", price: 189 },
  { sku: "PD-BLUEBERRY-ECLAIR", name: "Blueberry Eclair", price: 189 },
  { sku: "PD-CLASSIC-OPERA", name: "Classic Opera", price: 199 },
  { sku: "PD-CHOC-FUDGE", name: "Chocolate Fudge", price: 199 },
  { sku: "PD-HONEY-MEDOVIK", name: "Honey Medovik", price: 75 },
  { sku: "PD-CHOC-CUPCAKE", name: "Chocolate Cupcake", price: 29 },
  { sku: "PD-REDVELVET-CUPCAKE", name: "Red Velvet Cupcake", price: 29 },
  { sku: "PD-COFFEE-TART", name: "Coffee Tart", price: 29 },
  { sku: "PD-TIRAMISU-CHOUX-BUN", name: "Tiramisu Choux Bun", price: 129 },
  { sku: "PD-CREME-BRULEE", name: "Creme Brulee", price: 139 },
  { sku: "PD-WHITE-CHOC-MOUSSE", name: "White Chocolate Mousse", price: 119 },

  // Sugarfree Desserts
  { sku: "SF-DARK-CHOC-MOUSSE", name: "Dark Chocolate Mousse (Sugar Free)", price: 149 },

  // Eggless Desserts
  { sku: "EG-TIRAMISU", name: "Tiramisu (Eggless)", price: 199 },
  { sku: "EG-BANOFEE", name: "Banofee (Eggless)", price: 199 },
  { sku: "EG-MIDNIGHT-BALLAD", name: "Midnight Ballad (Eggless)", price: 169 },
  { sku: "EG-VANILLA-BLUEBERRY-DELICE", name: "Vanilla Blueberry Delice (Eggless)", price: 179 },

  // Savouries (Veg)
  { sku: "SV-PEPPER-MUSHROOM-BUN", name: "Pepper Mushroom Bun", price: 49 },
  { sku: "SV-HAWAIIAN-PANEER-SLIDER", name: "Hawaiian Paneer Slider", price: 59 },

  // Savouries (Non-Veg)
  { sku: "SN-CHETTINAD-CHICKEN-BUN", name: "Chettinad Chicken Bun", price: 69 },
  { sku: "SN-HAWAIIAN-CHICKEN-SLIDER", name: "Hawaiian Chicken Slider", price: 69 },
  { sku: "SN-CHILLI-FISH-SLIDER", name: "Chilli Fish Slider", price: 89 },
];

/** Converts rupees with up to 2 decimals to integer paise without float errors. */
const toPaise = (rupees: number) => Math.round(rupees * 100);

async function main() {
  await prisma.businessSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      businessName: "KRIVA PATISSERIE",
      businessAddress: "61, Redfields Road, Coimbatore-641045",
      businessPhone: "+91 8270570052",
      currency: "INR",
      invoiceFooter: "Thank you for shopping with us! Goods once sold can be exchanged within 7 days with the bill.",
    },
  });

  let created = 0;
  for (const p of products) {
    const existing = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (existing) continue;
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku: p.sku,
          name: p.name,
          pricePaise: toPaise(p.price),
          stock: OPENING_STOCK,
          lowStockThreshold: LOW_STOCK_ALERT,
          description: null,
        },
      });
      if (OPENING_STOCK > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "ADJUSTMENT",
            previousStock: 0,
            change: OPENING_STOCK,
            newStock: OPENING_STOCK,
            reason: "Opening stock (seed)",
          },
        });
      }
    });
    created++;
  }
  console.log(`Seed complete: ${created} new products (${products.length - created} already existed).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());