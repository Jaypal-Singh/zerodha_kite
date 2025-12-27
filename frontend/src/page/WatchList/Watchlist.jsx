import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, Trash2 } from "lucide-react";
import BottomWindow from "./BottomWindow/BottomWindow";
import { useMarketData } from "../../contexts/MarketDataContext.jsx";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import Toast from '../../Utils/Toast.jsx'
import { logMarketStatus } from '../../Utils/marketStatus';


// --- Index Card (Same as before) ---
const IndexCard = ({ name, price, change, isPositive }) => {
  const [flashColor, setFlashColor] = useState("");
  const prevPriceRef = useRef(price);

  useEffect(() => {
    // Basic validation check
    if (!price || price === "—") return;

    // Convert string/number to float for comparison
    const currentP = parseFloat(price);
    const prevP = parseFloat(prevPriceRef.current);

    // Check if numbers are valid and price has actually changed
    if (!isNaN(currentP) && !isNaN(prevP) && currentP !== prevP) {
      if (currentP > prevP) {
        // Price Badha -> Green Flash
        setFlashColor("text-green-500 scale-105"); // scale-105 thoda pop effect dega
      } else {
        // Price Ghata -> Red Flash
        setFlashColor("text-red-500 scale-105");
      }

      // 300ms baad flash hata do
      const timer = setTimeout(() => {
        setFlashColor("");
      }, 300);

      // Ref update karo current price ke sath
      prevPriceRef.current = price;

      return () => clearTimeout(timer);
    } else {
      // First render ya same price par ref update
      prevPriceRef.current = price;
    }
  }, [price]);


  const defaultColor = isPositive ? "text-green-400" : "text-red-400";

  const priceColor = flashColor || defaultColor;

  // Arrow icon logic    
  const arrow = isPositive ? "▲" : "▼";

  return (
    <div className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] p-3 rounded-lg mx-1">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-[var(--text-primary)] font-semibold text-sm md:text-base">{name}</p>
          <p className="text-[var(--text-secondary)] text-[10px] md:text-xs">Index</p>
        </div>
        <div className="text-right">
          {/* Price with Flash Effect */}
          <p
            className={`font-bold text-sm md:text-base transition-all duration-200 ${priceColor}`}
          >
            {price}
          </p>

          {/* Percentage Change */}
          <p className={`text-[10px] md:text-xs font-medium ${defaultColor}`}>
            {arrow} {change}%
          </p>
        </div>
      </div>
    </div>
  );
};

// --- Swipeable Watchlist Item ---
const SwipeableWatchlistItem = ({
  item, priceData, onClick, onRemove
}) => {
  // Destructure price data
  const { ltp, netChange, percentChange, isPositive, volume, close } = priceData;

  const priceColor = isPositive === true ? "text-green-400" : isPositive === false ? "text-red-400" : "text-gray-400";
  const formattedPrice = ltp == null ? "—" : `₹${Number(ltp).toFixed(2)}`;
  const formattedNetChange = netChange == null ? "—" : `${netChange > 0 ? "+" : ""}${Number(netChange).toFixed(2)}`;
  const formattedPercentChange = percentChange == null ? "—" : `(${percentChange > 0 ? "+" : ""}${Number(percentChange).toFixed(2)}%)`;
  const formattedVolume = volume ? `${(Number(volume) / 100000).toFixed(2)}L` : "—";
  const formattedClose = close ? `Close: ₹${Number(close).toFixed(2)}` : "";

  // Motion values for swipe effect
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-100, -50], [1, 0]); // Fade icon based on drag
  const bgOpacity = useTransform(x, [-100, 0], [1, 0]); // Background redness

  return (
    <div className="relative overflow-hidden rounded-lg mb-2">
      {/* Background Layer (Red with Delete Icon) */}
      <motion.div
        style={{ opacity: bgOpacity }}
        className="absolute inset-y-0 right-0 w-full bg-red-600/20 rounded-lg flex items-center justify-end pr-6 z-0"
      >
        <Trash2 className="text-red-500 w-6 h-6" />
      </motion.div>

      {/* Foreground Layer (The Actual Item) */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }} // Only allows dragging left
        dragElastic={{ left: 0.5, right: 0 }} // Elastic feel
        onDragEnd={(e, { offset, velocity }) => {
          // Trigger delete if swiped left more than 100px
          if (offset.x < -100) {
            onRemove(item);
          }
        }}
        whileTap={{ cursor: "grabbing" }}
        style={{ x, backgroundColor: "var(--bg-secondary)" }}
        className="relative z-10 border border-[var(--border-color)] p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        onClick={() => {
          // Prevent click if user was dragging
          if (x.get() === 0) onClick();
        }}
      >
        <div className="flex justify-between items-center w-full pointer-events-none"> {/* pointer-events-none helps drag work smoothly on text */}
          <div>
            <span className="font-medium text-[var(--text-primary)] opacity-90 block">{item.tradingSymbol}</span>
            <span className="text-xs text-[var(--text-secondary)] block mt-0.5">{item.exchange}{item.name ? ` - ${item.name}` : ''}</span>
          </div>
          <div className="text-right">
            <span className={`font-semibold text-lg block ${priceColor}`}>{formattedPrice}</span>
            <span className={`text-xs block ${priceColor}`}>{formattedNetChange} {formattedPercentChange}</span>
            <div className="flex justify-end space-x-2">
              <span className="text-xs text-[var(--text-secondary)] block">Vol: {formattedVolume}</span>
              <span className="text-xs text-[var(--text-secondary)] block">{formattedClose}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};


function Watchlist() {
  // ... (State and Context logic same as before)
  const token = (typeof window !== "undefined" && localStorage.getItem("token")) || null;
  const { ticksRef, subscribe, unsubscribe, isConnected } = useMarketData();
  const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";

  const [stocks, setStocks] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [selectedStock, setSelectedStock] = useState(null);
  const [actionTab, setActionTab] = useState("Buy");
  const [quantity, setQuantity] = useState(1);
  const [orderPrice, setOrderPrice] = useState("");
  const [indexInstruments, setIndexInstruments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = useRef(false);
  const openedInstrumentRef = useRef(null);
  const isUpgradingRef = useRef(false);

  // *** Filter State ***
  const [activeFilter, setActiveFilter] = useState('all');

  // *** Toast State ***
  const [notification, setNotification] = useState({ show: false, message: "", type: "" });

  const showToast = (message, type = "success") => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: "", type: "" }), 2500); // 2.5s fast toast
  };

  useEffect(() => {
    logMarketStatus();
  }, []);

  // Helper function to get proper exchange display name based on Kite segment and instrument type
  const getExchangeDisplayName = (segment, instrument_type) => {
    // Kite segments: NFO-FUT, NFO-OPT, BFO-FUT, BFO-OPT, MCX-FUT, MCX-OPT, NSE, BSE, INDICES
    if (segment === 'INDICES') return 'Index';
    if (segment === 'EQ') return 'NSE Equity';
    if (segment === 'EQ') return 'BSE Equity';
    if (segment === 'NFO-FUT') return 'NSE Futures';
    if (segment === 'NFO-OPT') return 'NSE Options';
    if (segment === 'BFO-FUT') return 'BSE Futures';
    if (segment === 'BFO-OPT') return 'BSE Options';
    if (segment === 'MCX-FUT') return 'MCX Futures';
    if (segment === 'MCX-OPT') return 'MCX Options';
    if (segment === 'CDS-FUT') return 'Currency Futures';
    if (segment === 'CDS-OPT') return 'Currency Options';
    // Fallback based on instrument_type
    if (instrument_type === 'FUT') return 'Futures';
    if (['CE', 'PE'].includes(instrument_type)) return 'Options';
    return segment || 'Unknown';
  };

  // Format instruments using Kite schema
  const formatInstruments = (instruments) => {
    if (!Array.isArray(instruments)) return [];

    // Debug: Log first item to see what fields are coming from backend
    if (instruments.length > 0) {
      console.log('[Watchlist] Raw instrument sample:', JSON.stringify(instruments[0], null, 2));
    }

    return instruments
      .filter(one => one && one.instrument_token) // Filter out items without instrument_token
      .map(one => ({
        id: String(one.instrument_token),
        instrument_token: String(one.instrument_token),
        tradingSymbol: one.tradingsymbol || one.name || "Unknown",
        name: one.name || one.tradingsymbol || "Unknown",
        exchange: getExchangeDisplayName(one.segment, one.instrument_type),
        segment: one.segment,
        instrument_type: one.instrument_type || null,
        expiry: one.expiry || null,
        strike: one.strike || null,
        lot_size: one.lot_size ?? 1,
        tick_size: one.tick_size ?? 0.05,
        canon_key: one.canon_key,
      }));
  };

  // Subscribe and snapshot using Kite instrument_token
  const subscribeAndSnapshot = useCallback(async (instrumentList, subscriptionType = 'full') => {
    if (!instrumentList || instrumentList.length === 0) return;
    const subs = instrumentList.map(p => ({ instrument_token: p.instrument_token }));
    try { await subscribe(subs, subscriptionType); } catch (e) { console.warn(e); }

    // Small delay to allow first WebSocket tick to arrive before snapshot
    await new Promise(r => setTimeout(r, 50));

    try {
      const r = await fetch(`${apiBase}/api/quotes/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
        body: JSON.stringify({ items: subs }),
      });
      const map = r.ok ? await r.json() : {};
      console.log('[Watchlist] Snapshot response keys:', Object.keys(map));
      if (Object.keys(map).length > 0) {
        const firstKey = Object.keys(map).find(k => k !== '__snapshot_info');
        if (firstKey) console.log('[Watchlist] Snapshot sample:', firstKey, map[firstKey]);
      }
      setSnapshots(prev => ({ ...prev, ...map }));
    } catch (e) { console.warn(e); }
  }, [subscribe, apiBase, token]);

  // Upgrade/Downgrade logic removed as per request - Watchlist now defaults to 'full' mode
  // The selectedStock state now just tracks which item is open in bottom window



  // *** REMOVE FUNCTION (Optimistic UI) - Kite format ***
  const handleRemoveFromWatchlist = useCallback(async (stock) => {
    if (!stock || !stock.instrument_token) return;

    // 1. Immediately remove from UI (Optimistic Update)
    setStocks(prev => prev.filter(s => s.id !== stock.id));

    // 2. Show Toast Immediately
    showToast(`Stock removed successfully`, "success");

    // 3. Close bottom window if selected
    if (selectedStock?.id === stock.id) setSelectedStock(null);

    // 4. Invalidate cache
    sessionStorage.removeItem('watchlist_cache');
    sessionStorage.removeItem('watchlist_cache_time');

    // 5. Perform API Call in Background
    try {
      const canonKey = stock.canon_key || `${stock.segment}|${stock.tradingSymbol}`;
      const activeContextString = localStorage.getItem('activeContext');
      const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
      const brokerId = activeContext.brokerId;
      const customerId = activeContext.customerId;

      const response = await fetch(
        `${apiBase}/api/watchlist/${encodeURIComponent(canonKey)}?broker_id_str=${brokerId}&customer_id_str=${customerId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Subscriptions now default to 'full' mode for Watchlist
      const sub = [{ instrument_token: stock.instrument_token }];
      unsubscribe(sub, 'full').catch(console.warn);

      if (!response.ok) {
        console.error("API failed to remove, but UI updated.");
      }
    } catch (error) {
      console.error("Failed to remove from watchlist:", error);
    }
  }, [apiBase, token, unsubscribe, selectedStock]);


  // ... (Initial load useEffect - OPTIMIZED WITH CACHING)
  useEffect(() => {
    if (!isConnected || loadingRef.current) return;
    loadingRef.current = true;

    const loadAllInstruments = async () => {
      const startTime = performance.now();
      console.log('[Watchlist Load] Starting...');

      try {
        setIsLoading(true);

        // Try to get cached data first
        const cachedWatchlist = sessionStorage.getItem('watchlist_cache');
        const cachedIndexes = sessionStorage.getItem('indexes_cache');
        const cacheTime = sessionStorage.getItem('watchlist_cache_time');
        const now = Date.now();
        const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

        // Use cache if available and fresh (< 2 min old)
        if (cachedWatchlist && cachedIndexes && cacheTime && (now - parseInt(cacheTime)) < CACHE_TTL) {
          console.log('[Watchlist Load] Using cached data');
          const formattedIndexes = JSON.parse(cachedIndexes);
          const uniqueWatchlist = JSON.parse(cachedWatchlist);

          setIndexInstruments(formattedIndexes);
          setStocks(uniqueWatchlist);

          // Subscribe in background - Watchlist uses FULL mode
          if (formattedIndexes.length > 0) subscribeAndSnapshot(formattedIndexes, 'full');
          if (uniqueWatchlist.length > 0) subscribeAndSnapshot(uniqueWatchlist, 'full');

          setIsLoading(false);
          const elapsed = performance.now() - startTime;
          console.log(`[Watchlist Load] Completed from cache in ${elapsed.toFixed(0)}ms`);
          return;
        }

        const activeContextString = localStorage.getItem('activeContext');
        const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
        const brokerId = activeContext.brokerId;
        const customerId = activeContext.customerId;

        // OPTIMIZATION: Fetch indexes and watchlist in parallel
        const fetchStart = performance.now();
        const [indexRes, watchlistResponse] = await Promise.all([
          fetch(`${apiBase}/api/instruments/indexes`, { credentials: "include" }).then(res => res.json()),
          fetch(`${apiBase}/api/watchlist/getWatchlist?broker_id_str=${brokerId}&customer_id_str=${customerId}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          }).then(res => {
            if (!res.ok) throw new Error("Failed to fetch watchlist");
            return res.json();
          })
        ]);
        const fetchElapsed = performance.now() - fetchStart;
        console.log(`[Watchlist Load] API calls completed in ${fetchElapsed.toFixed(0)}ms`);

        // Process indexes - Kite format
        const nifty50Inst = indexRes.find(i => i.tradingsymbol === "NIFTY 50" || i.name?.includes('NIFTY 50'));
        const sensexInst = indexRes.find(i => i.tradingsymbol === "SENSEX" || i.name?.includes('SENSEX'));
        const indexInstrumentsRaw = [nifty50Inst, sensexInst].filter(Boolean);
        const formattedIndexes = formatInstruments(indexInstrumentsRaw);
        setIndexInstruments(formattedIndexes);

        // Process watchlist
        const instrumentsArr = Array.isArray(watchlistResponse) ? watchlistResponse : (watchlistResponse?.instruments || []);
        const formattedWatchlist = formatInstruments(instrumentsArr);
        const uniqueWatchlist = Array.from(new Map(formattedWatchlist.map(item => [item.id ?? item._id ?? item.instrument_token, item])).values());
        setStocks(uniqueWatchlist);

        // Cache the results
        sessionStorage.setItem('watchlist_cache', JSON.stringify(uniqueWatchlist));
        sessionStorage.setItem('indexes_cache', JSON.stringify(formattedIndexes));
        sessionStorage.setItem('watchlist_cache_time', now.toString());
        console.log(`[Watchlist Load] Cached ${uniqueWatchlist.length} instruments`);

        // Subscribe to market data - default to FULL mode for watchlist
        const subStart = performance.now();
        if (formattedIndexes.length > 0) await subscribeAndSnapshot(formattedIndexes, 'full');
        if (uniqueWatchlist.length > 0) await subscribeAndSnapshot(uniqueWatchlist, 'full');
        const subElapsed = performance.now() - subStart;
        console.log(`[Watchlist Load] Subscriptions completed in ${subElapsed.toFixed(0)}ms`);

        const totalElapsed = performance.now() - startTime;
        console.log(`[Watchlist Load] Total time: ${totalElapsed.toFixed(0)}ms`);

      } catch (e) {
        console.error("[Watchlist Load] Failed:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadAllInstruments();
  }, [isConnected, apiBase, token, subscribeAndSnapshot]);

  // ... (prices useMemo - SAME AS BEFORE)
  // *** HIGH PERFORMANCE MARKET DATA LOOP ***
  const [prices, setPrices] = useState({});
  const stocksRef = useRef(stocks); // Keep latest stocks in ref to avoid effect dependency re-runs

  useEffect(() => {
    stocksRef.current = stocks;
  }, [stocks]);

  useEffect(() => {
    let animationFrameId;
    let lastUpdate = 0;
    const THROTTLE_MS = 100; // Update Watchlist max 10 times/sec (smooth enough for human eye)

    const updateLoop = (timestamp) => {
      if (timestamp - lastUpdate < THROTTLE_MS) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      if (!ticksRef.current || ticksRef.current.size === 0) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      // Calculate new prices based on current ticksRef and stocks
      const currentStocks = stocksRef.current;
      const ticksMap = ticksRef.current;
      const byId = {};
      const num = (v) => (v == null || v === "" ? null : Number(v));

      let hasUpdates = false;

      currentStocks.forEach((s) => {
        // Kite uses instrument_token as the key
        const tickKey = String(s.instrument_token);
        const snap = snapshots[tickKey] || {};
        const t = ticksMap.get(tickKey) || {}; // Read directly from Mutable Ref

        const combined = { ...snap, ...t };
        const ltp = num(combined.ltp);

        // Calculate changes
        const open = num(combined.open);
        const high = num(combined.dayHigh) ?? num(combined.high);
        const low = num(combined.dayLow) ?? num(combined.low);
        const close = num(combined.close);
        const volume = num(combined.volume);
        const oi = num(combined.oi) ?? num(combined.openInterest);

        let percentChange = num(combined.percentChange);
        if (percentChange == null && ltp != null) {
          if (close != null && close !== 0) percentChange = ((ltp - close) / close) * 100;
          else if (open != null && open !== 0) percentChange = ((ltp - open) / open) * 100;
        }
        let netChange = num(combined.netChange);
        if (netChange == null && ltp != null) {
          if (percentChange != null) netChange = (ltp * (percentChange / 100));
          else if (close != null) netChange = ltp - close;
          else if (open != null) netChange = ltp - open;
        }

        byId[s.id] = {
          ltp, netChange, percentChange,
          isPositive: netChange != null ? netChange >= 0 : (percentChange != null ? percentChange >= 0 : null),
          open, high, low, close, volume, oi,
          bestBidPrice: num(combined.bestBidPrice), bestBidQuantity: num(combined.bestBidQuantity),
          bestAskPrice: num(combined.bestAskPrice), bestAskQuantity: num(combined.bestAskQuantity),
          lastTradeQty: num(combined.lastTradeQty), lastTradeTime: combined.lastTradeTime, depth: combined.depth || null,
        };

        hasUpdates = true;
      });

      if (hasUpdates) {
        setPrices(byId);
        lastUpdate = timestamp;
      }

      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);

    return () => cancelAnimationFrame(animationFrameId);
  }, [snapshots]); // Only restart loop if snapshots changes (rare)

  useEffect(() => {
    if (!selectedStock) return;
    const p = prices[selectedStock.id] || {};
    setOrderPrice(p?.ltp != null ? Number(p.ltp).toFixed(2) : "");
    setQuantity(1);
  }, [selectedStock, prices]);

  // Upgrade/Upgrade effect removed

  const sheetData = selectedStock ? prices[selectedStock.id] || {} : {};

  // ... (indexPrices useMemo and Index vars - SAME AS BEFORE)
  // *** INDEX PRICES RAF LOOP ***
  const [indexPrices, setIndexPrices] = useState({});
  const indexInstrumentsRef = useRef(indexInstruments);
  useEffect(() => { indexInstrumentsRef.current = indexInstruments; }, [indexInstruments]);

  useEffect(() => {
    let animationFrameId;
    let lastUpdate = 0;
    const THROTTLE_MS = 200; // Update Indices slower (5fps is fine)

    const updateLoop = (timestamp) => {
      if (timestamp - lastUpdate < THROTTLE_MS) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      if (!ticksRef.current) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      const currentIndexes = indexInstrumentsRef.current;
      const ticksMap = ticksRef.current;
      const byId = {};
      const num = (v) => (v == null || v === "" ? null : Number(v));
      let hasUpdates = false;

      currentIndexes.forEach((s) => {
        // Kite uses instrument_token as the key
        const tickKey = String(s.instrument_token);
        let snap = snapshots[tickKey] || {};
        let t = ticksMap.get(tickKey) || {};
        const ltp = num(t.ltp) ?? num(snap.ltp);
        const open = num(t.open) ?? num(snap.open);
        const close = num(t.close) ?? num(snap.close);
        let percentChange = (t.percentChange != null ? num(t.percentChange) : snap.percentChange != null ? num(snap.percentChange) : null);
        if (percentChange == null && ltp != null) {
          if (close != null && close !== 0) percentChange = ((ltp - close) / close) * 100;
          else if (open != null && open !== 0) percentChange = ((ltp - open) / open) * 100;
        }
        let netChange = (t.netChange != null ? num(t.netChange) : snap.netChange != null ? num(snap.netChange) : null);
        if (netChange == null && ltp != null) {
          if (percentChange != null) netChange = (ltp * percentChange) / 100;
          else if (close != null) netChange = ltp - close;
          else if (open != null) netChange = ltp - open;
        }
        byId[s.id] = { ltp, netChange, percentChange, isPositive: netChange != null ? netChange >= 0 : (percentChange != null ? percentChange >= 0 : null), };
        hasUpdates = true;
      });

      if (hasUpdates) {
        setIndexPrices(byId);
        lastUpdate = timestamp;
      }
      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [snapshots]);

  // Find index instruments by tradingsymbol (Kite format)
  const sensexInst = indexInstruments.find(i => i.tradingSymbol?.includes('SENSEX') && i.segment === 'INDICES');
  const nifty50Inst = indexInstruments.find(i => i.tradingSymbol?.includes('NIFTY 50') || i.tradingSymbol === 'NIFTY 50');
  const sensexPrice = sensexInst ? indexPrices[sensexInst.id] : {};
  const nifty50Price = nifty50Inst ? indexPrices[nifty50Inst.id] : {};

  // *** Segment Filter Logic - Kite format ***
  const SEGMENT_FILTER_MAP = useMemo(() => ({
    all: null, // null means show all
    index: { segments: ['NFO-FUT', 'NFO-OPT', 'BFO-FUT', 'BFO-OPT'], types: ['FUT', 'CE', 'PE'] },
    futures: { segments: ['NFO-FUT', 'BFO-FUT', 'MCX-FUT', 'CDS-FUT'], types: ['FUT'] },
    options: { segments: ['NFO-OPT', 'BFO-OPT', 'MCX-OPT', 'CDS-OPT'], types: ['CE', 'PE'] }
  }), []);

  const filteredStocks = useMemo(() => {
    if (activeFilter === 'all') return stocks;
    const filterConfig = SEGMENT_FILTER_MAP[activeFilter];
    if (!filterConfig) return stocks;

    // If filterConfig has segments and types (index/futures/options)
    if (filterConfig.segments && filterConfig.types) {
      return stocks.filter(stock =>
        filterConfig.segments.includes(stock.segment) &&
        filterConfig.types.includes(stock.instrument_type)
      );
    }

    // Legacy: just segment filter array (if needed)
    if (Array.isArray(filterConfig)) {
      return stocks.filter(stock => filterConfig.includes(stock.segment));
    }

    return stocks;
  }, [stocks, activeFilter, SEGMENT_FILTER_MAP]);

  // Get count for each filter category
  const getFilterCount = useCallback((filterKey) => {
    if (filterKey === 'all') return stocks.length;
    const filterConfig = SEGMENT_FILTER_MAP[filterKey];
    if (!filterConfig) return 0;

    // If filterConfig has segments and types (index/futures/options)
    if (filterConfig.segments && filterConfig.types) {
      return stocks.filter(stock =>
        filterConfig.segments.includes(stock.segment) &&
        filterConfig.types.includes(stock.instrument_type)
      ).length;
    }

    // Legacy: just segment filter array (if needed)
    if (Array.isArray(filterConfig)) {
      return stocks.filter(stock => filterConfig.includes(stock.segment)).length;
    }

    return 0;
  }, [stocks, SEGMENT_FILTER_MAP]);

  // Filter tabs configuration
  const FILTER_TABS = [
    { key: 'all', label: 'All' },
    { key: 'index', label: 'Index' },
    { key: 'futures', label: 'Futures' },
    { key: 'options', label: 'Options' }
  ];

  return (
    <div className="w-full h-full bg-[var(--bg-primary)] md:w-1/2 lg:w-3/12 md:border-r border-[var(--border-color)] flex flex-col relative min-h-0">

      {/* Toast Notification */}
      <Toast message={notification.message} type={notification.type} show={notification.show} />

      {/* Header */}
      <div className="pt-3 pb-2 px-4 border-b border-[var(--border-color)] bg-[var(--bg-primary)] flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-[var(--border-color)]">
              <span className="text-white font-bold text-lg font-sans">D</span>
            </div>
            <div className="flex flex-col">
              <h3 className="text-lg font-bold text-[var(--text-primary)] tracking-wide leading-none">DEVAKI</h3>
              <span className="text-[10px] text-[var(--text-secondary)] font-medium tracking-widest uppercase mt-0.5">Terminal</span>
            </div>
          </div>
        </div>
      </div>

      {/* Index Cards */}
      <div className="px-2 py-2 flex bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex-shrink-0">
        <IndexCard name="SENSEX" price={sensexPrice?.ltp?.toFixed(2) || "—"} change={sensexPrice?.percentChange?.toFixed(2) || "—"} isPositive={sensexPrice?.isPositive} />
        <IndexCard name="Nifty 50" price={nifty50Price?.ltp?.toFixed(2) || "—"} change={nifty50Price?.percentChange?.toFixed(2) || "—"} isPositive={nifty50Price?.isPositive} />
      </div>

      {/* Search Button + Filter Tabs Combined */}
      <div className="px-2 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex-shrink-0 space-y-2">
        <Link to="/search" className="flex items-center gap-3 w-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] px-3 py-2 rounded-lg transition-all duration-200 group">
          <Search size={16} className="group-hover:text-[var(--text-primary)] transition-colors" />
          <span className="text-sm font-medium group-hover:text-[var(--text-primary)] transition-colors">Search & add instruments...</span>
        </Link>

        {/* Filter Tabs - Auto-sizing to fill available width */}
        <div className="flex w-full">
          {FILTER_TABS.map(({ key, label }) => {
            const count = getFilterCount(key);
            const isActive = activeFilter === key;
            return (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium whitespace-nowrap transition-all duration-150 border-b-2 ${isActive
                  ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500'
                  : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
              >
                {label}
                <span className={`text-[10px] ${isActive
                  ? 'text-indigo-300'
                  : 'text-[var(--text-muted)]'
                  }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Swipeable List */}
      <ul className="space-y-0 p-2 flex-1 overflow-y-auto pb-28 min-h-0 mt-0">
        <AnimatePresence>
          {filteredStocks.map((stock) => {
            const p = prices[stock.id] || {};
            return (
              <motion.div
                key={stock.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0, marginLeft: -100 }} // Slide out animation
                transition={{ duration: 0.2 }}
              >
                <SwipeableWatchlistItem
                  item={stock}
                  priceData={p}
                  onClick={() => { setSelectedStock(stock); setActionTab("Buy"); }}
                  onRemove={handleRemoveFromWatchlist}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Empty State */}
        {filteredStocks.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-8 px-4 text-center">
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-3" />
                <p className="text-[var(--text-secondary)]">Loading instruments…</p>
              </>
            ) : stocks.length === 0 ? (
              <>
                <Search className="w-12 h-12 text-[var(--text-muted)] mb-3" />
                <h3 className="text-[var(--text-primary)] font-semibold text-lg mb-2">Your Watchlist is Empty</h3>
                <p className="text-[var(--text-secondary)] text-sm mb-4">Search above to add stocks</p>
              </>
            ) : (
              <>
                <Search className="w-10 h-10 text-[var(--text-muted)] mb-3" />
                <h3 className="text-[var(--text-primary)] font-semibold text-base mb-1">No {FILTER_TABS.find(t => t.key === activeFilter)?.label} Instruments</h3>
                <p className="text-[var(--text-secondary)] text-sm">Add some from the search or switch filter</p>
              </>
            )}
          </div>
        )}
      </ul>

      <BottomWindow
        selectedStock={selectedStock}
        sheetData={sheetData}
        actionTab={actionTab}
        setActionTab={setActionTab}
        quantity={quantity}
        setQuantity={setQuantity}
        orderPrice={orderPrice}
        setOrderPrice={setOrderPrice}
        setSelectedStock={setSelectedStock}
        onRemoveFromWatchlist={handleRemoveFromWatchlist}
        subscriptionType="full"
        ticksRef={ticksRef}
      />
    </div>
  );
}

export default Watchlist;