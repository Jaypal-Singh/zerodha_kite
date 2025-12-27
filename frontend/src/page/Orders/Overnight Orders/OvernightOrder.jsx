// OvernightOrder.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import { MOCK_ORDERS } from "../mockData";
import { useMarketData } from "../../../contexts/MarketDataContext.jsx";
import OvernightOrderBottomWindow from "./OvernightOrderBottomWindow.jsx";
import { calculatePnLAndBrokerage } from "../../../Utils/calculateBrokerage.jsx";

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

// sirf ENTRY side pe 0.01%
const ENTRY_BROKERAGE_PERCENT = 0.01;

export default function OvernightOrder() {
  const list = MOCK_ORDERS.filter((o) => o.status === "HOLD");

  const [allData, setAllData] = useState([]);
  const [orders, setOrders] = useState({}); // snapshot map/object
  const [instrumentData, setInstrumentData] = useState([]);
  const [loader, setLoader] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrderData, setSelectedOrderData] = useState(null);

  // Add WebSocket connection
  const { ticksRef, subscribe, unsubscribe, isConnected } = useMarketData();

  const activeContextString = localStorage.getItem("activeContext");
  const activeContext = activeContextString
    ? JSON.parse(activeContextString)
    : {};
  const brokerId = activeContext.brokerId;
  const customerId = activeContext.customerId;
  // Normalize status to match backend enum values
  const orderStatus = "HOLD";

  const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";
  const token = localStorage.getItem("token") || null;

  // Segment map no longer needed - using instrument_token directly

  const handleOrderSelect = (orderData) => {
    setSelectedOrderData(orderData);
  };

  const handleCloseWindow = () => {
    setSelectedOrderData(null);
  };

  // get instrumentData (extracted to a reusable function so we can re-run it)
  const fetchInstrumentData = async () => {
    setLoader(true);
    try {
      // Fetch only overnight (NRML) orders from backend
      const endPoint = `${apiBase.replace(
        /\/$/,
        ""
      )}/api/orders/getOrderInstrument?broker_id_str=${brokerId}&customer_id_str=${customerId}&orderStatus=${orderStatus}&product=NRML`;

      const res = await fetch(endPoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });

      if (!res.ok) {
        let text = "<no-body>";
        try {
          text = await res.text();
        } catch (e) { }
        console.error(
          "getOrderInstrument failed:",
          res.status,
          res.statusText,
          text
        );
        setInstrumentData([]);
        setError("Failed to load instruments");
        return;
      }

      const data = await res.json();
      const instruments = Array.isArray(data?.ordersInstrument)
        ? data.ordersInstrument
        : Array.isArray(data)
          ? data
          : [];
      setInstrumentData(instruments);
      setError(null);
    } catch (err) {
      console.error("getOrderInstrument exception:", err);
      setInstrumentData([]);
      setError(String(err));
    } finally {
      setLoader(false);
    }
  };

  useEffect(() => {
    // initial fetch
    fetchInstrumentData();
  }, [brokerId, customerId, apiBase, token]);

  // Listen for 'orders:changed' events
  useEffect(() => {
    const handler = (e) => {
      try {
        console.debug(
          "[OvernightOrder] orders:changed received, refetching orders"
        );
        fetchInstrumentData();
      } catch (err) {
        console.warn("[OvernightOrder] orders:changed handler error", err);
      }
    };

    window.addEventListener("orders:changed", handler);
    return () => window.removeEventListener("orders:changed", handler);
  }, [brokerId, customerId, apiBase, token]);

  // Subscribe to WebSocket and fetch snapshot when instrumentData ready
  useEffect(() => {
    if (!Array.isArray(instrumentData) || instrumentData.length === 0) {
      console.log("[OvernightOrder] instrument is not array or is empty");
      setOrders({});
      return;
    }

    (async () => {
      try {
        // Use instrument_token for Kite WebSocket subscription
        const items = instrumentData
          .map((item) => {
            const token = item.instrument_token;
            if (!token) return null;
            return { instrument_token: String(token) };
          })
          .filter(Boolean);

        if (items.length === 0) {
          console.log("[OvernightOrder] items array empty");
          setOrders({});
          return;
        }

        // 1) subscribe WS
        try {
          console.log(
            `[OvernightOrder] Subscribing to ${items.length} instruments via WebSocket...`
          );
          await subscribe(items, "quote");
          console.log("[OvernightOrder] WebSocket subscription successful");
        } catch (e) {
          console.warn(
            "[OvernightOrder] WebSocket subscribe failed:",
            e?.message || e
          );
        }

        // 2) snapshot
        const url = `${apiBase.replace(/\/$/, "")}/api/quotes/snapshot`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({ items }),
        });

        if (!res.ok) {
          let text = "<no-body>";
          try {
            text = await res.text();
          } catch (e) { }
          console.error(
            "[OvernightOrder] snapshot fetch failed:",
            res.status,
            res.statusText,
            text
          );
          setOrders({});
          return;
        }

        const snapshotData = await res.json();

        let snapshotMap = {};
        if (
          snapshotData &&
          typeof snapshotData === "object" &&
          !Array.isArray(snapshotData)
        ) {
          snapshotMap = snapshotData;
        } else if (Array.isArray(snapshotData)) {
          snapshotData.forEach((it) => {
            const id = String(it.securityId ?? it.security_Id ?? it.id ?? "");
            if (id) snapshotMap[id] = it;
            if (it.segment && id) snapshotMap[`${it.segment}|${id}`] = it;
          });
        }

        setOrders(snapshotMap);
      } catch (err) {
        console.error("[OvernightOrder] snapshot fetch exception:", err);
        setOrders({});
      }
    })();

    // cleanup
    return () => {
      // Unsubscribe using instrument_token
      const items = instrumentData
        .map((item) => ({
          instrument_token: String(item.instrument_token)
        }))
        .filter((i) => i.instrument_token);

      if (items.length > 0) {
        console.log(
          `[OvernightOrder] Unsubscribing from ${items.length} instruments...`
        );
        unsubscribe(items, "quote").catch((e) =>
          console.warn("[OvernightOrder] Unsubscribe failed:", e)
        );
      }
    };
  }, [instrumentData, subscribe, unsubscribe, apiBase, token]);

  // --- HIGH PERF: RAF LOOP for Live Ticks ---
  const [liveTicks, setLiveTicks] = useState({});
  const instrumentDataRef = useRef(instrumentData);
  useEffect(() => { instrumentDataRef.current = instrumentData; }, [instrumentData]);

  useEffect(() => {
    let animationFrameId;
    let lastUpdate = 0;
    const THROTTLE_MS = 200;

    const updateLoop = (timestamp) => {
      if (timestamp - lastUpdate < THROTTLE_MS) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      if (!ticksRef.current || !instrumentDataRef.current || instrumentDataRef.current.length === 0) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      const ticksMap = ticksRef.current;
      const currentData = instrumentDataRef.current;
      const newTicks = {};
      let hasUpdates = false;

      currentData.forEach(inst => {
        // Use instrument_token directly as key (Kite format)
        const tickKey = String(inst.instrument_token);
        const tick = ticksMap.get(tickKey);
        if (tick) {
          newTicks[tickKey] = tick;
          hasUpdates = true;
        }
      });

      if (hasUpdates) {
        setLiveTicks(prev => newTicks);
        lastUpdate = timestamp;
      }
      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  useEffect(() => {
    if (!instrumentData || instrumentData.length === 0) {
      setAllData([]);
      return;
    }

    const merged = instrumentData.map((inst) => {
      // Use instrument_token as the key
      const tickKey = String(inst.instrument_token);
      let snapshot = null;

      if (orders && typeof orders === "object") {
        snapshot = orders[tickKey] ?? null;
      }

      const tick = liveTicks[tickKey] || {};
      const combined = { ...snapshot, ...tick };
      return { ...inst, snapshot: combined };
    });

    setAllData(merged);
  }, [instrumentData, orders, liveTicks]);

  const selectedOrderMarketData = useMemo(() => {
    if (!selectedOrderData) return {};

    const foundItem = allData.find(
      (item) =>
        item._id === selectedOrderData._id ||
        (item.instrument_token &&
          item.instrument_token === selectedOrderData.instrument_token)
    );

    return foundItem?.snapshot ?? {};
  }, [selectedOrderData, allData]);

  const displayList =
    Array.isArray(allData) && allData.length > 0 ? allData : list;

  return (
    <>
      <h3 className="text-gray-400 text-sm mb-2">
        Overnight Orders ({displayList.length})
      </h3>
      <ul className="space-y-2 pb-24 overflow-auto">
        {displayList.map((data, idx) => {
          const tradingsymbolRaw =
            data?.meta?.selectedStock?.tradingSymbol ?? data?.symbol ?? "";
          const tradingsymbol = String(tradingsymbolRaw ?? "");
          const ltp = Number(data.snapshot?.ltp ?? data.ltp ?? 0);

          // avg: prefer average_price if present
          const avg = Number(data.average_price ?? data.price ?? 0);
          const qty = Number(data?.quantity ?? 0);
          const sideUpper = String(data.side ?? "").toUpperCase();

          // helper se brokerage + P&L
          const {
            netPnl,
            pct,
            brokerageEntry,
          } = calculatePnLAndBrokerage({
            side: sideUpper,
            avgPrice: avg,
            ltp,
            qty,
            brokeragePercentPerSide: ENTRY_BROKERAGE_PERCENT,
            mode: "entry-only",
          });

          const profit = netPnl >= 0;
          const pnlColor = profit ? "text-green-400" : "text-red-400";
          const pctText = `${profit ? "+" : ""}${netPnl.toFixed(
            2
          )} (${profit ? "+" : ""}${pct.toFixed(2)}%)`;

          return (
            <li
              key={
                data._id ||
                data.id ||
                `${data.segment}-${data.instrument_token}-${idx}`
              }
              className="relative bg-[#121a2b] rounded-lg p-3 border border-white/10 hover:bg-[#222a41] transition cursor-pointer"
              onClick={() => handleOrderSelect(data)}
            >
              <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-fuchsia-500/90" />
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-white font-bold tracking-wide text-sm whitespace-nowrap overflow-hidden text-ellipsis pr-2 flex-1">
                  {tradingsymbol || "—"}{" "}
                  <span className="text-xs text-gray-400">({sideUpper})</span>
                </h4>

                <div
                  className={`text-xs font-bold ${pnlColor} whitespace-nowrap flex-shrink-0`}
                >
                  {pctText}
                </div>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-y-1 text-[12px]">
                <div className="text-gray-400">
                  Qty: <span className="text-white">{qty}</span>
                </div>
                <div className="text-right text-gray-400">
                  LTP:{" "}
                  <span className="text-white font-semibold">
                    {ltp ? `₹${ltp.toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="text-gray-400">
                  Avg: <span className="text-white">{money(avg)}</span>
                </div>
                <div className="text-right text-gray-400">
                  Net P&L:{" "}
                  <span className={`${pnlColor} font-semibold`}>
                    {money(netPnl)}
                  </span>
                </div>
                <div className="col-span-2 text-[10px] text-right text-gray-500 mt-1">
                  Est. Brokerage (entry): -{money(brokerageEntry)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {selectedOrderData && (
        <OvernightOrderBottomWindow
          selectedOrder={selectedOrderData}
          onClose={handleCloseWindow}
          sheetData={selectedOrderMarketData}
        />
      )}
    </>
  );
}
