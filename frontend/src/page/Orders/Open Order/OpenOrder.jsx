import React, { useEffect, useState, useMemo, useRef } from "react";
import { useMarketData } from "../../../contexts/MarketDataContext.jsx";
import { AlertTriangle } from "lucide-react";
import OpenOrderBottomWindow from "./OpenOderBottomWindow.jsx";
import { calculatePnLAndBrokerage } from "../../../Utils/calculateBrokerage.jsx";

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

// Brokerage ONLY on executed entry side (Buy ya Sell) = 0.01%
const BROKERAGE_PERCENT_ON_ENTRY = 0.01; // 0.01%

export default function OpenOrder() {
  const [allData, setAllData] = useState([]);
  const [orders, setOrders] = useState({});
  const [instrumentData, setInstrumentData] = useState([]);
  const [loader, setLoader] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrderData, setSelectedOrderData] = useState(null);

  // Exit All
  const [showExitModal, setShowExitModal] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const { ticksRef, subscribe, unsubscribe } = useMarketData();

  const activeContextString = localStorage.getItem("activeContext");
  const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
  const brokerId = activeContext.brokerId;
  const customerId = activeContext.customerId;
  const orderStatus = "OPEN";

  const userString = localStorage.getItem('loggedInUser');
  const userObject = userString ? JSON.parse(userString) : {};
  const userRole = userObject.role;

  const apiBase =
    import.meta.env.VITE_REACT_APP_API_URL || "http://localhost:8080";
  const token = localStorage.getItem("token") || null;

  // Segment map no longer needed - using instrument_token directly

  const handleOrderSelect = (orderData) => {
    setSelectedOrderData(orderData);
  };

  const handleCloseWindow = () => {
    setSelectedOrderData(null);
  };

  // ---------- 1) FETCH ORDERS ----------
  const fetchInstrumentData = async () => {
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
  };

  // ---------- 2) EXIT ALL HANDLER ----------
  const handleExitAll = async () => {
    setIsExiting(true);
    try {
      const ltpData = {};
      displayList.forEach((order) => {
        const currentLtp = Number(order.snapshot?.ltp ?? order.ltp ?? 0);
        if (order._id) {
          ltpData[order._id] = currentLtp;
        }
      });

      const currentTime = new Date();

      const payload = {
        closed_ltp_map: ltpData,
        closed_at: currentTime,
      };

      const endPoint = `${apiBase.replace(
        /\/$/,
        ""
      )}/api/orders/exitAllOpenOrder?broker_id_str=${brokerId}&customer_id_str=${customerId}`;

      const res = await fetch(endPoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        console.log("Response:", data);
        fetchInstrumentData();
        setShowExitModal(false);
      } else {
        console.error("Failed to exit:", data.message);
        alert(data.message || "Failed to exit orders.");
      }
    } catch (err) {
      console.error("Exit All API Error:", err);
      alert("Network error while exiting orders.");
    } finally {
      setIsExiting(false);
    }
  };

  // initial fetch
  useEffect(() => {
    fetchInstrumentData();
  }, [brokerId, customerId, apiBase, token]);

  // refresh on custom event
  // refresh on custom event
  useEffect(() => {
    const handler = (event) => {
      try {
        fetchInstrumentData();

        // Instant update for selected order if it matches
        const updatedOrder = event.detail?.order;
        if (updatedOrder && selectedOrderData && (selectedOrderData._id === updatedOrder._id || selectedOrderData.order_id === updatedOrder.order_id)) {
          setSelectedOrderData(prev => ({ ...prev, ...updatedOrder }));
        }
      } catch { }
    };
    window.addEventListener("orders:changed", handler);
    return () => window.removeEventListener("orders:changed", handler);
  }, [brokerId, customerId, apiBase, token, selectedOrderData]);

  // ---------- 3) WEBSOCKET SUBSCRIPTION ----------
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
          await subscribe(items, "quote");
        } catch (e) {
          console.warn(e);
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
      if (items.length > 0)
        unsubscribe(items, "quote").catch((e) => { });
    };
  }, [instrumentData, subscribe, unsubscribe, apiBase, token]);

  // ---------- 4.1) RAF Loop for Live Ticks ----------
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

  // ---------- 4.2) MERGE SNAPSHOT + LIVE TICKS ----------
  useEffect(() => {
    if (!instrumentData || instrumentData.length === 0) {
      setAllData([]);
      return;
    }
    const merged = instrumentData.map((inst) => {
      // Use instrument_token as the key for tick lookup
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

  // ---------- 5) selectedOrderMarketData ----------
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

  const displayList = allData;

  // ---------- 6) LOADER / ERROR ----------
  if (loader) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-xs">Loading open orders...</p>
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

  // ---------- 7) RENDER ----------
  return (
    <>
      {/* HEADER + EXIT ALL */}
      <div className="flex justify-between items-center mb-2 px-1">
        <h3 className="text-gray-400 text-sm font-medium">
          Open Orders ({displayList.length})
        </h3>

        {displayList.length > 0 && userRole === 'broker' && (
          <button
            onClick={() => setShowExitModal(true)}
            className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/50 
                        px-3 py-1.5 rounded text-xs font-semibold transition-all duration-200 
                        flex items-center gap-1.5 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
          >
            <span>All Exit</span>
          </button>
        )}
      </div>

      {/* LIST */}
      <ul className="space-y-2 pb-24 overflow-auto">
        {displayList.map((data, idx) => {
          const tradingsymbolRaw =
            data?.meta?.selectedStock?.tradingSymbol ?? data?.symbol ?? "";
          const tradingsymbol = String(tradingsymbolRaw ?? "");

          // For option chain orders, the security_Id may be the parent's ID (not the option's)
          // So live ticks will show the parent's LTP instead of the option's LTP
          // In this case, use the saved order price as fallback
          const isOptionChainOrder = data?.meta?.from === 'ui_option_chain';
          const snapshotLtp = Number(data.snapshot?.ltp ?? 0);

          // If it's an option chain order and snapshot LTP seems to be parent's LTP (very different from avg),
          // or if snapshot LTP is 0, use the saved order price
          const ltp = (isOptionChainOrder && (snapshotLtp === 0 || !data.snapshot?.ltp))
            ? Number(data.price ?? 0)
            : (snapshotLtp || Number(data.ltp ?? data.price ?? 0));

          const avg = Number(data.price ?? 0);
          const qty = Number(data?.quantity ?? 0);

          const sideUpper = String(data.side ?? "").toUpperCase();

          // ---------- BROKERAGE + P&L USING HELPER (ENTRY ONLY) ----------
          const {
            entryValue,
            totalBrokerage,
            netPnl,
            pct,
          } = calculatePnLAndBrokerage({
            side: sideUpper,
            avgPrice: avg,
            ltp,
            qty,
            brokeragePercentPerSide: BROKERAGE_PERCENT_ON_ENTRY, // 0.01%
            mode: "entry-only", // open order: sirf entry brokerage
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
                `${data.segment}-${data.security_Id}-${idx}`
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
                  Est. Brokerage (entry): -{money(totalBrokerage)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* BOTTOM SHEET */}
      {selectedOrderData && (
        <OpenOrderBottomWindow
          selectedOrder={selectedOrderData}
          onClose={handleCloseWindow}
          sheetData={selectedOrderMarketData}
        />
      )}

      {/* EXIT ALL MODAL */}
      {showExitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => !isExiting && setShowExitModal(false)}
          />
          <div className="relative bg-[#1e293b] border border-white/10 rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-100">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="text-red-500 w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                Exit All Orders?
              </h3>
              <p className="text-gray-400 text-sm mb-6">
                Are you sure you want to exit all {displayList.length} open
                orders? This action cannot be undone.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowExitModal(false)}
                  disabled={isExiting}
                  className="flex-1 px-4 py-2.5 bg-[#0f172a] hover:bg-[#1a253a] border border-white/10 text-gray-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExitAll}
                  disabled={isExiting}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-70 flex justify-center items-center gap-2"
                >
                  {isExiting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Exiting...
                    </>
                  ) : (
                    "Yes, Exit All"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
