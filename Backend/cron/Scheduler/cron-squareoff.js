import cron from "node-cron";
import Order from "../../Model/OrdersModel.js";
import { isTradingDay } from "../marketCalendar.js";
import { attemptSquareoff } from "./attemptSquareoff.js";

// Helper to process list of orders
async function processCandidates(query, label) {
  try {
    const candidates = await Order.find(query).limit(1000);
    console.log(`[cron] 🔍 ${label}: Found ${candidates.length} orders`);

    for (const orderDoc of candidates) {
      await attemptSquareoff(orderDoc);
    }
  } catch (err) {
    console.error(`[cron] Error in ${label}:`, err);
  }
}

export function stockSquareoffScheduler() {
  console.log('🚀 Stock Squareoff Scheduler Started...');

  // =========================================================
  // 1. INTRADAY SQUARE OFF (Updated Time: 10:46 PM Mon-Fri)
  // =========================================================
  // Format: "Minute Hour * * DayOfWeek"
  // "46 22 * * 1-5" = 10:46 PM, Monday to Friday

  cron.schedule("15 15 * * 1-5", async () => {
    if (!isTradingDay(new Date())) {
      return console.log("[cron] Market holiday, skipping Intraday.");
    }

    console.log(`[cron] ⏰ Running INTRADAY Auto-Squareoff`);

    await processCandidates(
      {
        order_category: "INTRADAY",
        order_status: { $in: ["OPEN"] }
      },
      "OPEN_INTRADAY"
    );
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });


  // =========================================================
  // 2. MIDNIGHT CLEANUP & EXPIRY CHECK (Daily 12:00 AM)

  cron.schedule("2 0 * * *", async () => {
    console.log(`[cron] 🌙 Running Midnight Maintenance`);

    // A. Intraday Cleanup
    await processCandidates(
      {
        order_category: "INTRADAY",
        order_status: { $in: ["HOLD"] }
      },
      "INTRADAY_CLEANUP"
    );

    // B. OVERNIGHT / HOLD Expiry Check 
    // Sabhi active overnight orders check karo (null included)
    await processCandidates(
      {
        order_category: "OVERNIGHT",
        order_status: { $in: [null, "OPEN", "HOLD"] }
      },
      "OVERNIGHT_EXPIRY_CHECK"
    );

  }, {
    scheduled: true,
    timezone: "Asia/Kolkata" // ✅ Timezone Added Here
  });
}