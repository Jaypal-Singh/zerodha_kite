// HoldOrder.jsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import HoldOrderBottomWindow from "./holdOrderBottomWindow.jsx";
import { calculatePnLAndBrokerage } from "../../../Utils/calculateBrokerage.jsx";
import { useMarketData } from "../../../contexts/MarketDataContext.jsx";

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

// Brokerage config – 0.01% per side
const ENTRY_BROKERAGE_PERCENT = 0.01; // 0.01% (ENTRY ONLY for holdings)

export default function HoldOrder() {
  const list = [];

  const [orders, setOrders] = useState({});
  const [instrumentData, setInstrumentData] = useState([]);
  const [loader, setLoader] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrderData, setSelectedOrderData] = useState(null);

  const { ticksRef, subscribe, unsubscribe } = useMarketData();
  const subscribeRef = useRef(subscribe);
  const unsubscribeRef = useRef(unsubscribe);

  useEffect(() => {
    subscribeRef.current = subscribe;
    unsubscribeRef.current = unsubscribe;
  }, [subscribe, unsubscribe]);

  const activeContextString = localStorage.getItem("activeContext");
  const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
  const brokerId = activeContext.brokerId;
  const customerId = activeContext.customerId;
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

  // ---- FETCH HOLD ORDERS ----
  const fetchInstrumentData = useCallback(async () => {
    if (!brokerId || !customerId) {
      setLoader(false);
      return;
    }

    setLoader(true);
    try {
      const endPoint = `${apiBase.replace(
        /\/$/,
        ""
      )}/api/orders/getOrderInstrument?broker_id_str=${brokerId}&customer_id_str=${customerId}&orderStatus=${orderStatus}&product=MIS`;

      const res = await fetch(endPoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });

      if (!res.ok) {
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
  }, [brokerId, customerId, apiBase, token, orderStatus]);

  useEffect(() => {
    fetchInstrumentData();
  }, [fetchInstrumentData]);

  useEffect(() => {
    const handler = () => {
      try {
        fetchInstrumentData();
      } catch { }
    };
    window.addEventListener("orders:changed", handler);
    return () => window.removeEventListener("orders:changed", handler);
  }, [fetchInstrumentData]);

  // ---- SNAPSHOT + WEBSOCKET ----
  useEffect(() => {
    if (!Array.isArray(instrumentData) || instrumentData.length === 0) {
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
          setOrders({});
          return;
        }

        try {
          await (subscribeRef.current
            ? subscribeRef.current(items, "quote")
            : subscribe(items, "quote"));
        } catch (e) {
          console.warn("[HoldOrder] subscribe failed:", e);
        }

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
        console.error("[HoldOrder] snapshot fetch exception:", err);
        setOrders({});
      }
    })();

    return () => {
      // Unsubscribe using instrument_token
      const items = instrumentData
        .map((item) => ({
          instrument_token: String(item.instrument_token)
        }))
        .filter((i) => i.instrument_token);

      if (items.length > 0) {
        const fn = unsubscribeRef.current || unsubscribe;
        fn(items, "quote").catch((e) =>
          console.warn("[HoldOrder] Unsubscribe failed:", e)
        );
      }
    };
  }, [instrumentData, subscribe, unsubscribe, apiBase, token]);

  // --- HIGH PERF: RAF LOOP for Live Ticks ---
  const [liveTicks, setLiveTicks] = useState({});
  const instrumentDataRef = useRef(instrumentData);

  useEffect(() => {
    instrumentDataRef.current = instrumentData;
  }, [instrumentData]);

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

  // ---- MERGE instruments + snapshots + liveTicks ----
  const displayList = useMemo(() => {
    if (!instrumentData || instrumentData.length === 0) {
      return list;
    }

    return instrumentData.map((inst) => {
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
  }, [instrumentData, orders, liveTicks, list]);

  const selectedOrderMarketData = useMemo(() => {
    if (!selectedOrderData) return {};
    const foundItem = displayList.find(
      (item) =>
        item._id === selectedOrderData._id ||
        (item.instrument_token &&
          item.instrument_token === selectedOrderData.instrument_token)
    );
    return foundItem?.snapshot ?? {};
  }, [selectedOrderData, displayList]);

  // ---- UI ----
  if (loader) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-xs">Loading holdings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-400 text-xs mb-2">{error}</p>
          <button
            onClick={fetchInstrumentData}
            className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <h3 className="text-gray-400 text-sm mb-2">
        Holdings ({displayList.length})
      </h3>
      <ul className="space-y-2 pb-24 overflow-auto">
        {displayList.map((data, idx) => {
          const tradingsymbolRaw =
            data?.meta?.selectedStock?.tradingSymbol ?? data?.symbol ?? "";
          const tradingsymbol = String(tradingsymbolRaw ?? "");

          const ltp = Number(data.snapshot?.ltp ?? data.ltp ?? 0);
          const avg = Number(
            data.average_price ?? data.price ?? 0 // 🔴 IMPORTANT: use average_price first
          );
          const qty = Number(data?.quantity ?? 0);
          const sideUpper = String(data.side ?? "").toUpperCase();

          // 🔹 Use shared helper for P&L + entry brokerage (0.01%, entry-only)
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
        <HoldOrderBottomWindow
          selectedOrder={selectedOrderData}
          onClose={handleCloseWindow}
          sheetData={selectedOrderMarketData}
        />
      )}
    </>
  );
}
