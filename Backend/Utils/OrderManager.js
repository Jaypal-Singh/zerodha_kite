import Order from '../Model/OrdersModel.js';

// =========================================================
// 1. GLOBAL MEMORY (RAM) - THE WATCHLIST
// Key   = SecurityID (String)
// Value = Array of Order Objects
// =========================================================
export const activeTriggers = new Map();

/**
 * =========================================================
 * 2. INITIALIZATION (SERVER STARTUP)
 * Server restart hone par DB se wo saare orders load karo jo CLOSED nahi hain.
 * Covers: 'OPEN', 'HOLD', and null (Overnight)
 * =========================================================
 */
export const loadOpenOrders = async () => {
    try {
        console.log("🔄 [OrderManager] Loading active triggers...");

        // LOGIC: Status 'CLOSED' nahi hona chahiye + SL ya Target set hona chahiye
        const activeOrders = await Order.find({
            order_status: { $ne: 'CLOSED' }, // Means: OPEN, HOLD, or null
            $or: [
                { stop_loss: { $exists: true, $ne: null, $gt: 0 } },
                { target: { $exists: true, $ne: null, $gt: 0 } }
            ]
        });

        activeTriggers.clear();

        activeOrders.forEach(order => {
            addToWatchlist(order);
        });

        console.log(`✅ [OrderManager] System Ready. Tracking ${activeOrders.length} active orders.`);
    } catch (error) {
        console.error("❌ [OrderManager] Failed to load orders:", error);
    }
};

/**
 * =========================================================
 * 3. ADD ORDER TO MEMORY
 * Helper function to push order into RAM
 * =========================================================
 */
export const addToWatchlist = (order) => {
    // 1. Agar Order CLOSED hai to ignore karo
    if (order.order_status === 'CLOSED') return;

    // Use instrument_token for Kite (fallback to security_Id for backward compatibility)
    const token = String(order.instrument_token || order.security_Id);
    const sl = Number(order.stop_loss) || 0;
    const target = Number(order.target) || 0;

    // 2. Agar SL aur Target dono 0 hain, to track karne ka fayda nahi
    if (sl === 0 && target === 0) return;

    if (!activeTriggers.has(token)) {
        activeTriggers.set(token, []);
    }

    // 3. Store only necessary data
    const triggerData = {
        orderId: String(order._id),
        side: order.side,          // 'BUY' or 'SELL'
        sl: sl,
        target: target,
        // Status isliye rakh rahe hain taaki debug kar sakein (Open/Hold/null)
        status: order.order_status
    };

    activeTriggers.get(token).push(triggerData);
    // console.log(`➕ Monitoring: ${order.symbol} | SL: ${sl} | TGT: ${target}`);
};

/**
 * =========================================================
 * 4. UPDATE ORDER IN MEMORY
 * Jab user Modify kare (SL change kare) ya Status change ho
 * =========================================================
 */
export const updateTriggerInWatchlist = (order) => {
    // Use instrument_token for Kite (fallback to security_Id for backward compatibility)
    const token = String(order.instrument_token || order.security_Id);
    const orderIdStr = String(order._id);

    // Step 1: Purana entry hatao (taaki duplicate na ho)
    if (activeTriggers.has(token)) {
        const currentList = activeTriggers.get(token);
        const filteredList = currentList.filter(o => o.orderId !== orderIdStr);

        if (filteredList.length === 0) {
            activeTriggers.delete(token);
        } else {
            activeTriggers.set(token, filteredList);
        }
    }

    // Step 2: Agar abhi bhi CLOSED nahi hai, to wapas add karo
    if (order.order_status !== 'CLOSED') {
        addToWatchlist(order);
    }
};

/**
 * =========================================================
 * 5. EXECUTE EXIT (DB UPDATE ONLY)
 * Jab SL ya Target Hit ho jaye
 * =========================================================
 */
const executeExit = async (orderData, exitPrice, reason) => {
    const { orderId, token } = orderData;

    console.log(`⚡ [OrderManager] Trigger Hit! Order: ${orderId}, Reason: ${reason}, Price: ${exitPrice}`);

    try {
        // A. Remove from Memory IMMEDIATELY (Prevent Double Execution)
        if (activeTriggers.has(token)) {
            const updatedList = activeTriggers.get(token).filter(o => o.orderId !== orderId);
            if (updatedList.length === 0) {
                activeTriggers.delete(token);
            } else {
                activeTriggers.set(token, updatedList);
            }
        }

        // B. Update Order Status in Database
        // Hum Fund ko nahi chhed rahe, bas Order Close kar rahe hain.
        // Fund logic agar future me chahiye to 'OrdersController' handle karega alag se
        // ya fir user manual refresh karega tab sync hoga.

        await Order.findByIdAndUpdate(orderId, {
            $set: {
                order_status: "CLOSED",
                closed_ltp: exitPrice,
                closed_at: new Date(),
                exit_reason: reason // "STOPLOSS_HIT" or "TARGET_HIT"
            }
        });

        console.log(`✅ [OrderManager] Order ${orderId} Closed Successfully.`);

    } catch (error) {
        console.error(`❌ [OrderManager] Execution Error for Order ${orderId}:`, error);
    }
};

export const onMarketTick = async ({ token, ltp }) => {
    // 1. Check if we are watching this token
    if (!activeTriggers.has(String(token))) return;

    const orders = activeTriggers.get(String(token));
    const currentLtp = Number(ltp);

    if (!currentLtp || currentLtp <= 0) return;

    // 2. Loop through orders using standard for-loop (Fastest)
    for (let i = 0; i < orders.length; i++) {
        const order = orders[i];

        let hit = false;
        let hitReason = "";
        let hitPrice = 0;

        // BUY Logic
        if (order.side === 'BUY') {
            // SL Hit: Price gira <= SL
            if (order.sl > 0 && currentLtp <= order.sl) {
                hit = true;
                hitReason = "STOPLOSS_HIT";
                hitPrice = order.sl;
            }
            // Target Hit: Price utha >= Target
            else if (order.target > 0 && currentLtp >= order.target) {
                hit = true;
                hitReason = "TARGET_HIT";
                hitPrice = order.target;
            }
        }
        // SELL Logic
        else {
            // SL Hit: Price utha >= SL (Shorting me loss upar jane pe hota hai)
            if (order.sl > 0 && currentLtp >= order.sl) {
                hit = true;
                hitReason = "STOPLOSS_HIT";
                hitPrice = order.sl
            }
            // Target Hit: Price gira <= Target
            else if (order.target > 0 && currentLtp <= order.target) {
                hit = true;
                hitReason = "TARGET_HIT";
                hitPrice = order.target;
            }
        }

        // 3. Execute Exit
        if (hit) {
            await executeExit({ ...order, token: String(token) }, hitPrice, hitReason);
        }
    }
};