import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import SearchBar from "../WatchList/SearchBar";
import { useMarketData } from "../../contexts/MarketDataContext.jsx";
import { CheckCircle, XCircle } from "lucide-react"; // Agar lucide-react nahi hai to ise hata kar simple text use kar sakte hain

// --- Memoized List Item Component ---
const WatchlistItem = React.memo(({ name, exchange, underlyingName, onClick, ltp, percentChange }) => {
  const priceColor = percentChange == null ? "text-[var(--text-secondary)]" : percentChange >= 0 ? "text-green-400" : "text-red-400";
  const formattedLtp = ltp != null ? `₹${ltp.toFixed(2)}` : "—";
  const formattedPercent = percentChange != null ? `${percentChange >= 0 ? "▲" : "▼"} ${Math.abs(percentChange).toFixed(2)}%` : "—";

  return (
    <li
      onClick={onClick}
      className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-3 rounded-lg hover:bg-[var(--bg-hover)] transition duration-150 cursor-pointer"
    >
      <div className="flex justify-between items-center w-full">
        <div>
          <span className="font-medium text-[var(--text-primary)] opacity-90 block">{name}</span>
          <span className="text-xs text-[var(--text-secondary)] block mt-0.5">{exchange}{underlyingName ? ` - ${underlyingName}` : ''}</span>
        </div>
        <div className="text-right">
          <span className={`block text-sm font-semibold ${priceColor}`}>{formattedLtp}</span>
          <span className={`block text-xs ${priceColor}`}>{formattedPercent}</span>
        </div>
      </div>
    </li>
  );
}, (prevProps, nextProps) => {
  // Only re-render if these props actually changed
  return (
    prevProps.name === nextProps.name &&
    prevProps.exchange === nextProps.exchange &&
    prevProps.underlyingName === nextProps.underlyingName &&
    prevProps.ltp === nextProps.ltp &&
    prevProps.percentChange === nextProps.percentChange
  );
});

// --- Main Search Page ---
function SearchPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searchSnapshots, setSearchSnapshots] = useState({});
  const [isSearching, setIsSearching] = useState(false);

  // *** Notification State ***
  const [notification, setNotification] = useState({ show: false, message: "", type: "" });

  const searchSubscriptionsRef = useRef([]);
  const activeAbortControllerRef = useRef(null);

  const token =
    (typeof window !== "undefined" && localStorage.getItem("token")) ||
    null;

  const { ticksRef, subscribe, unsubscribe } = useMarketData();
  const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "http://localhost:8080";

  // *** Helper to show notification ***
  const showToast = (message, type = "success") => {
    setNotification({ show: true, message, type });
    // 3 seconds baad apne aap gayab ho jayega
    setTimeout(() => {
      setNotification({ show: false, message: "", type: "" });
    }, 3000);
  };

  const searchApi = useMemo(
    () => ({
      search: async (q, signal) => {
        // ==================== FRONTEND SEARCH CACHE ====================
        const cacheKey = `search_${q.toLowerCase()}`;
        const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

        try {
          const cached = sessionStorage.getItem(cacheKey);
          const cacheTime = sessionStorage.getItem(`${cacheKey}_time`);

          if (cached && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);
            if (age < CACHE_TTL) {
              console.log(`[Search Cache] Using cached results for "${q}" (${Math.round(age / 1000)}s old)`);
              return JSON.parse(cached);
            }
          }
        } catch (e) {
          // Cache read failed, proceed with fetch
        }
        // ==================== END FRONTEND SEARCH CACHE ====================

        const url = `${apiBase}/api/instruments/search?q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { credentials: "include", signal });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(`search failed: ${q} status:${r.status} ${text}`);
        }
        const data = await r.json();
        const results = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];

        // Cache the results
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(results));
          sessionStorage.setItem(`${cacheKey}_time`, Date.now().toString());
        } catch (e) {
          // Cache write failed (probably quota exceeded), continue without caching
          console.warn('[Search Cache] Failed to cache results:', e);
        }

        return results;
      },
    }),
    [apiBase]
  );

  // Helper function to get proper exchange display name based on Kite segment and instrument type
  const getExchangeDisplayName = (segment, instrument_type) => {
    // Kite segments: NFO-FUT, NFO-OPT, BFO-FUT, BFO-OPT, MCX-FUT, MCX-OPT, NSE, BSE, INDICES
    if (segment === 'INDICES') return 'Index';
    if (segment === 'NSE') return 'NSE Equity';
    if (segment === 'BSE') return 'BSE Equity';
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

    // Segments to exclude from search results
    const EXCLUDED_SEGMENTS = ['INDICES', 'CDS-FUT', 'CDS-OPT'];

    return instruments
      .filter(one => !EXCLUDED_SEGMENTS.includes(one.segment))
      .map((one) => ({
        _id: one._id,
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

  // Debounced Search Logic with AbortController
  useEffect(() => {
    // Clear results if search term is empty or too short
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    // Cancel any in-flight request
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    setIsSearching(true);

    const handle = setTimeout(() => {
      (async () => {
        try {
          const raw = await searchApi.search(searchTerm.trim(), abortController.signal);

          // Only update state if this request wasn't aborted
          if (!abortController.signal.aborted) {
            setSearchResults(formatInstruments(raw));
            setIsSearching(false);
          }
        } catch (e) {
          // Ignore abort errors (they're expected)
          if (e.name === 'AbortError') {
            console.log('[Search] Request cancelled:', searchTerm.trim());
            return;
          }

          console.error("Search failed:", e);
          if (!abortController.signal.aborted) {
            setSearchResults([]);
            setIsSearching(false);
          }
        }
      })();
    }, 300); // Balanced debounce time

    return () => {
      clearTimeout(handle);
      abortController.abort();
    };
  }, [searchTerm, searchApi]);

  // Live Data Subscription Logic with Debounce
  useEffect(() => {
    // Don't subscribe if no results or still searching
    if (!searchResults || searchResults.length === 0 || isSearching) {
      return;
    }

    // Debounce subscription to avoid rapid fire on every keystroke
    const handle = setTimeout(() => {
      const subscribeSearchResults = async () => {
        // Unsubscribe from old results
        if (searchSubscriptionsRef.current.length > 0) {
          try {
            await unsubscribe(searchSubscriptionsRef.current, 'quote');
            searchSubscriptionsRef.current = [];
          } catch (e) { console.warn(e); }
        }

        const subs = searchResults.map(r => ({ instrument_token: r.instrument_token }));

        try {
          await subscribe(subs, 'quote');
          searchSubscriptionsRef.current = subs;
        } catch (e) { console.warn(e); }

        try {
          const r = await fetch(`${apiBase}/api/quotes/snapshot`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            credentials: "include",
            body: JSON.stringify({ items: subs }),
          });
          const map = r.ok ? await r.json() : {};
          setSearchSnapshots(map || {});
        } catch (e) { console.warn(e); }
      };
      subscribeSearchResults();
    }, 500); // Wait 500ms after results arrive before subscribing

    return () => clearTimeout(handle);
  }, [searchResults, isSearching, subscribe, unsubscribe, apiBase, token]);

  useEffect(() => {
    return () => {
      if (searchSubscriptionsRef.current.length > 0) {
        unsubscribe(searchSubscriptionsRef.current, 'quote').catch(() => { });
      }
    };
  }, [unsubscribe]);

  // Use a state for live prices to decouple from high-freq ticks
  const [livePrices, setLivePrices] = useState({});
  const searchResultsRef = useRef(searchResults);

  useEffect(() => { searchResultsRef.current = searchResults; }, [searchResults]);

  useEffect(() => {
    let animationFrameId;
    let lastUpdate = 0;
    const THROTTLE_MS = 200; // 5 FPS is enough for search results

    const updateLoop = (timestamp) => {
      if (timestamp - lastUpdate < THROTTLE_MS) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      if (!ticksRef.current || !searchResultsRef.current) {
        animationFrameId = requestAnimationFrame(updateLoop);
        return;
      }

      const ticksMap = ticksRef.current;
      const currentResults = searchResultsRef.current;
      const num = (v) => (v == null || v === "" ? null : Number(v));
      const newPrices = {};
      let hasUpdates = false;

      currentResults.forEach(stock => {
        // Kite uses instrument_token as the key
        const tickKey = String(stock.instrument_token);
        const snap = searchSnapshots[tickKey] || {};
        const tick = ticksMap.get(tickKey) || {};

        const combined = { ...snap, ...tick };

        // Just extract what we need for the list item
        const ltp = num(combined.ltp);
        const open = num(combined.open);
        const close = num(combined.close);
        let percentChange = num(combined.percentChange);

        if (percentChange == null && ltp != null) {
          if (close != null && close !== 0) percentChange = ((ltp - close) / close) * 100;
          else if (open != null && open !== 0) percentChange = ((ltp - open) / open) * 100;
        }

        newPrices[stock.id] = { ltp, percentChange };
        hasUpdates = true;
      });

      if (hasUpdates) {
        setLivePrices(newPrices);
        lastUpdate = timestamp;
      }

      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [searchSnapshots]);


  const num = (v) => (v == null || v === "" ? null : Number(v));

  // --- Add to Watchlist Logic ---
  const handleAddToWatchlist = async (stock) => {
    const activeContextString = localStorage.getItem('activeContext');
    const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
    const brokerId = activeContext.brokerId;
    const customerId = activeContext.customerId;

    if (!stock || !stock._id) {
      console.error("Cannot add stock, ID is missing.");
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/watchlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ instrumentId: stock._id, broker_id_str: brokerId, customer_id_str: customerId }),
      });

      if (response.ok) {
        // Invalidate watchlist cache so it reloads fresh data
        sessionStorage.removeItem('watchlist_cache');
        sessionStorage.removeItem('watchlist_cache_time');

        // *** PRE-SUBSCRIBE: Start receiving data BEFORE user navigates to watchlist ***
        // This gives a head start so data is already flowing when they arrive
        try {
          // Use instrument_token for Kite
          if (stock.instrument_token) {
            const subItem = { instrument_token: stock.instrument_token };
            subscribe([subItem], 'quote');
            console.log(`[SearchPage] Pre-subscribed ${stock.tradingSymbol} to quote feed`);
          }
        } catch (subErr) {
          console.warn("[SearchPage] Pre-subscribe failed:", subErr);
          // Non-blocking - order will still work, just might have slight delay
        }

        // *** Show Success Popup ***
        showToast(`${stock.tradingSymbol} added to watchlist!`, "success");
      } else {
        const errorData = await response.json();
        // *** Show Error Popup ***
        showToast(`Failed: ${errorData.message}`, "error");
      }
    } catch (error) {
      console.error("Failed to add to watchlist:", error);
      showToast("Network error. Please try again.", "error");
    }
  };

  return (
    <div className="w-full min-h-screen bg-[var(--bg-primary)] flex flex-col relative p-4 pb-20">

      {/* *** Custom Animation Style *** */}
      <style>{`
        @keyframes slideDown {
          from { transform: translate(-50%, -100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        .animate-toast {
          animation: slideDown 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* *** Notification Popup (Toast) *** */}
      {notification.show && (
        <div
          className={`fixed top-8 left-1/2 z-50 
            px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 
            w-[90%] md:w-auto md:min-w-[400px] max-w-lg
            animate-toast
            ${notification.type === 'success'
              ? 'bg-gradient-to-r from-green-800/90 to-green-600/90 text-white border border-green-500/30'
              : 'bg-gradient-to-r from-red-800/90 to-red-600/90 text-white border border-red-500/30'
            }`}
          style={{ backdropFilter: "blur(8px)" }}
        >
          {/* Icon Section */}
          <div className="flex-shrink-0">
            {notification.type === 'success' ? (
              <svg className="w-6 h-6 text-green-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            ) : (
              <svg className="w-6 h-6 text-red-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            )}
          </div>

          {/* Text Section - One Line Forced */}
          <span className="font-medium text-sm md:text-base whitespace-nowrap overflow-hidden text-ellipsis">
            {notification.message}
          </span>
        </div>
      )}

      <h2 className="text-lg md:text-xl font-semibold text-[var(--text-primary)]">Search Instruments</h2>
      <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />

      {/* Loading Indicator */}
      {isSearching && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--text-primary)]"></div>
          <span className="ml-3 text-[var(--text-secondary)]">Searching...</span>
        </div>
      )}

      {/* Minimum character message */}
      {searchTerm.trim() && searchTerm.trim().length < 2 && !isSearching && (
        <p className="text-center text-[var(--text-secondary)] pt-8">
          Type at least 2 characters to search
        </p>
      )}

      <ul className="space-y-2 text-sm md:text-base p-2 flex-grow overflow-y-auto mt-4">
        {/* Render grouped results with optional section headers */}
        {!isSearching && searchResults && (() => {
          const groups = [];
          let currentType = null;
          searchResults.forEach(stock => {
            const type = stock.instrument_type;
            // Determine display group label
            let label = null;
            if (type === "FUT") label = "Futures";
            else if (["CE", "PE"].includes(type)) label = "Options";
            else label = "Equities"; // includes EQ or any non‑FUT/OPT

            if (label !== currentType) {
              groups.push({ header: label, items: [] });
              currentType = label;
            }
            groups[groups.length - 1].items.push(stock);
          });

          return groups.map((group, gi) => (
            <React.Fragment key={gi}>
              <li className="font-semibold text-[var(--text-primary)] mt-2 mb-1">{group.header}</li>
              {group.items.map(stock => {
                const priceData = livePrices[stock.id] || {};
                const ltp = priceData.ltp;
                const percentChange = priceData.percentChange;
                return (
                  <WatchlistItem
                    key={stock.id}
                    name={stock.tradingSymbol}
                    exchange={stock.exchange || "—"}
                    underlyingName={stock.name}
                    ltp={ltp}
                    percentChange={percentChange}
                    onClick={() => handleAddToWatchlist(stock)}
                  />
                );
              })}
            </React.Fragment>
          ));
        })()}
        {searchResults && searchResults.length === 0 && (
          <p className="text-center text-[var(--text-secondary)] pt-4">No symbols matched your search.</p>
        )}
      </ul>
    </div>
  );
}

export default SearchPage;