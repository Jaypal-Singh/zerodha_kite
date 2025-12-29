import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, ShoppingCart, DollarSign, Hash } from 'lucide-react';
import { logMarketStatus } from '../../../Utils/marketStatus.js'
import { getFundsData } from '../../../Utils/fetchFund.jsx';
import { useMarketData } from '../../../contexts/MarketDataContext';

const OptionStrikeBottomWindow = ({
    isOpen,
    onClose,
    optionType,          // 'CE' | 'PE'
    strikePrice,         // Number
    instrumentToken,     // String (instrument token)
    underlyingStock,     // Object (Parent Info)
    spotPrice,           // Number
    expiry,              // String
}) => {
    // --- Market Data Context ---
    const { subscribe, unsubscribe, ticksRef } = useMarketData();

    // --- Local States ---
    const [actionTab, setActionTab] = useState('Buy');
    const [productType, setProductType] = useState('Intraday');
    const [localLotsStr, setLocalLotsStr] = useState('1');
    const [jobbin_price, setJobbin_price] = useState("0.08");

    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [dataUpdateTrigger, setDataUpdateTrigger] = useState(0); // To trigger re-renders on data updates
    const inputRef = useRef(null);

    // --- Context & Role ---
    const isMarketOpen = logMarketStatus();
    const userString = localStorage.getItem('loggedInUser');
    const userObject = userString ? JSON.parse(userString) : {};
    const userRole = userObject.role;

    // Get live data from ticksRef
    const liveData = useMemo(() => {
        if (!instrumentToken || !ticksRef.current) return null;
        return ticksRef.current.get(String(instrumentToken)) || null;
    }, [instrumentToken, ticksRef, dataUpdateTrigger]);

    // Get live data from ticksRef (full data when window is open)
    const liveDataFull = useMemo(() => {
        if (!instrumentToken || !ticksRef.current) return null;
        return ticksRef.current.get(String(instrumentToken)) || null;
    }, [instrumentToken, ticksRef, dataUpdateTrigger]);

    // --- Derived Values ---
    const ltp = liveDataFull?.ltp || liveData?.ltp || 0;
    const bestBid = liveDataFull?.bestBidPrice || liveData?.bestBidPrice || 0;
    const bestAsk = liveDataFull?.bestAskPrice || liveData?.bestAskPrice || 0;

    // Lot Size
    const lotSize = underlyingStock?.lot_size || underlyingStock?.lotSize || 50;

    // Reset on Open
    useEffect(() => {
        if (isOpen) {
            setLocalLotsStr('1');
            setFeedback(null);
            setActionTab('Buy');
            setProductType('Intraday');
        }
    }, [isOpen, strikePrice, optionType]);

    // Subscribe to full market data when window opens
    useEffect(() => {
        if (isOpen && instrumentToken) {
            // Subscribe to full market data for this instrument
            subscribe([{ instrument_token: instrumentToken }], 'full');
        }
        
        // Unsubscribe when window closes
        return () => {
            if (instrumentToken) {
                unsubscribe([{ instrument_token: instrumentToken }], 'full');
            }
        };
    }, [isOpen, instrumentToken, subscribe, unsubscribe]);

    // Trigger re-renders when tick data updates
    useEffect(() => {
        let interval;
        if (isOpen) {
            // When window is open, check for updates more frequently
            interval = setInterval(() => {
                setDataUpdateTrigger(prev => prev + 1);
            }, 100); // Update every 100ms for smooth UI updates
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isOpen]);

    // --- Calculations ---
    const lotsNum = useMemo(() => {
        const n = Number(localLotsStr);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }, [localLotsStr]);

    const qtyNum = useMemo(() => {
        return lotsNum * lotSize;
    }, [lotsNum, lotSize]);

    const jobbinPct = useMemo(() => {
        const v = parseFloat(String(jobbin_price).trim());
        return Number.isFinite(v) ? v / 100 : 0;
    }, [jobbin_price]);

    const { adjustedPricePerShare } = useMemo(() => {
        if (!ltp) return { adjustedPricePerShare: 0 };
        const perShareFactor = actionTab === 'Buy' ? (1 + jobbinPct) : (1 - jobbinPct);
        const pxRaw = ltp * perShareFactor;
        return { adjustedPricePerShare: Number(pxRaw.toFixed(4)) };
    }, [ltp, actionTab, jobbinPct]);

    const totalOrderValue = useMemo(() => {
        if (!adjustedPricePerShare || !qtyNum) return 0;
        return Number((adjustedPricePerShare * qtyNum).toFixed(2));
    }, [adjustedPricePerShare, qtyNum]);

    if (!isOpen) return null;

    // --- Name Construction ---
    // For Option Chain orders, use underlying_symbol (clean base name like "HDFCBANK", "NIFTY")
    // This prevents names like "HDFCBANK 30 DEC 870 CALL 30 DEC 985 CALL"
    const getInstrumentName = () => {
        // Priority: underlying_symbol (clean base name) > symbol_name > symbol > tradingSymbol
        const symbol = underlyingStock?.underlying_symbol
            || underlyingStock?.symbol_name
            || underlyingStock?.name
            || underlyingStock?.symbol
            || "UNKNOWN";

        let expiryStr = "";
        if (expiry) {
            try {
                const d = new Date(expiry);
                const day = String(d.getDate()).padStart(2, '0');
                const month = d.toLocaleString('default', { month: 'short' }).toUpperCase();
                expiryStr = `${day} ${month}`;
            } catch (e) { }
        }
        const typeStr = (optionType === 'CE' || optionType === 'CALL') ? 'CALL' : 'PUT';
        return `${symbol} ${expiryStr} ${strikePrice} ${typeStr}`.trim();
    };
    const instrumentName = getInstrumentName();

    const formatExpiryFull = (dateStr) => {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { return dateStr; }
    };

    const handleInputChange = (e) => {
        setLocalLotsStr(e.target.value);
        setFeedback(null);
    };

    // --- CONFIRM ORDER HANDLER ---
    const handleConfirm = async () => {
        setSubmitting(true);
        setFeedback(null);

        const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";

        try {
            // 1. Input Validation
            if (!lotsNum || lotsNum < 1) {
                setFeedback({ type: 'error', message: 'Please enter a valid lot count.' });
                setSubmitting(false);
                return;
            }

            // ============================================================
            // 🔥 FIX: LOOKUP CORRECT OPTION INSTRUMENT TOKEN FROM INSTRUMENTS
            // The option chain API returns instrument_token for Kite
            // ============================================================
            let finalInstrumentToken = String(
                instrumentToken ||
                ''
            );

            // If strikeData doesn't have instrument_token, look it up from instruments
            if (!finalInstrumentToken && strikePrice && optionType && expiry) {
                try {
                    const underlyingSymbol = underlyingStock?.underlying_symbol
                        || underlyingStock?.symbol_name
                        || underlyingStock?.name
                        || '';

                    const lookupParams = new URLSearchParams({
                        name: underlyingSymbol,
                        strike: strikePrice,
                        optionType: optionType === 'CE' || optionType === 'CALL' ? 'CE' : 'PE',
                        expiry: expiry
                    });

                    console.log('[OptionOrder] Looking up instrument token:', lookupParams.toString());

                    const lookupRes = await fetch(`${apiBase}/api/option-chain/security-id?${lookupParams.toString()}`);

                    if (lookupRes.ok) {
                        const lookupData = await lookupRes.json();
                        // API returns instrument_token (Kite format)
                        if (lookupData.data?.instrument_token) {
                            finalInstrumentToken = String(lookupData.data.instrument_token);
                            console.log('[OptionOrder] Found instrument token:', finalInstrumentToken);
                        }
                    }
                } catch (lookupErr) {
                    console.warn('[OptionOrder] Instrument token lookup failed:', lookupErr);
                }
            }

            // Last resort fallback to parent's instrument_token
            if (!finalInstrumentToken) {
                finalInstrumentToken = String(
                    underlyingStock?.instrument_token ||
                    ''
                );
                console.warn('[OptionOrder] Using parent instrument token as fallback:', finalInstrumentToken);
            }

            if (!finalInstrumentToken) {
                setFeedback({ type: 'error', message: "Instrument token missing. Check console." });
                console.error("Data Missing for instrument_token:", { instrumentToken, underlyingStock });
                setSubmitting(false);
                return;
            }

            // 2. Fund Validation
            try {
                const fundsData = await getFundsData();
                if (!fundsData) throw new Error("Unable to fetch wallet balance.");

                const requiredAmount = Number(totalOrderValue);
                let availableLimit = 0;
                let limitType = "";

                if (productType === 'Intraday') {
                    const max = fundsData.intraday?.available_limit || 0;
                    const used = fundsData.intraday?.used_limit || 0;
                    availableLimit = max - used;
                    limitType = "Intraday";
                } else {
                    availableLimit = fundsData.overnight?.available_limit || 0;
                    limitType = "Overnight";
                }

                if (requiredAmount > availableLimit) {
                    setFeedback({
                        type: 'error',
                        message: `Insufficient ${limitType} Funds! Required: ₹${requiredAmount.toFixed(2)}, Available: ₹${availableLimit.toFixed(2)}. Add funds.`
                    });
                    setSubmitting(false);
                    return;
                }
            } catch (fundErr) {
                setFeedback({ type: 'error', message: "Fund validation failed. Try again." });
                setSubmitting(false);
                return;
            }

            const activeContextString = localStorage.getItem('activeContext');
            const activeContext = activeContextString ? JSON.parse(activeContextString) : null;
            const brokerId = activeContext?.brokerId || '';
            const customerId = activeContext?.customerId || '';

            const side = actionTab === 'Buy' ? 'BUY' : 'SELL';
            const product = productType === 'Intraday' ? 'MIS' : 'NRML';
            const finalPrice = adjustedPricePerShare || ltp;

            const payload = {
                broker_id_str: brokerId,
                customer_id_str: customerId,
                instrument_token: finalInstrumentToken,
                symbol: instrumentName,
                segment: underlyingStock?.segment || 'NFO-OPT',
                side,
                product,
                price: Number(finalPrice),
                quantity: qtyNum,
                lots: lotsNum,
                lot_size: lotSize,
                jobbin_price: jobbin_price === '' ? 0 : Number(jobbin_price),
                order_status: "OPEN",
                meta: {
                    from: 'ui_option_chain',
                    underlying: underlyingStock?.name,
                    expiry: expiry,
                    spotPrice: spotPrice,
                    strike: strikePrice,
                    optionType: optionType
                },

                placed_at: new Date()
            };

            console.log('Option Order Payload:', payload);

            const res = await fetch(`${apiBase}/api/orders/postOrder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let body = null;
            try { body = await res.json(); } catch (e) { body = null; }

            if (!res.ok || (body && body.success === false)) {
                const message = body?.error || body?.message || `Server responded with ${res.status}`;
                throw new Error(message);
            }

            setFeedback({ type: 'success', message: 'Order placed successfully!' });
            setTimeout(() => { onClose(); }, 1500);

        } catch (err) {
            console.error('Option Order failed:', err);
            setFeedback({ type: 'error', message: `Order failed: ${String(err.message || err)}` });
        } finally {
            setSubmitting(false);
        }
    };

    const getProductTypeClass = (mode) => {
        if (productType !== mode) return 'bg-[#1A1F30] text-gray-400';
        return actionTab === 'Buy' ? 'bg-green-600 text-white' : 'bg-red-600 text-white';
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/60 z-[110]" onClick={onClose} />
            <div className="fixed bottom-0 left-0 right-0 bg-[#1A1F30] z-[120] rounded-t-2xl max-h-[85vh] overflow-y-auto animate-slide-up">

                {/* Header */}
                <div className="sticky top-0 bg-[#1A1F30] px-4 py-3 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-white font-bold text-lg">{instrumentName}</h2>
                            <p className="text-gray-500 text-xs">{formatExpiryFull(expiry)}</p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition">
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Price Bar */}
                <div className="px-4 py-3 bg-[#141B2D] border-b border-white/10">
                    <div className="flex justify-between items-center">
                        <div className="text-center flex-1">
                            <p className="text-gray-500 text-[10px] uppercase">Bid</p>
                            <p className="text-green-400 font-semibold text-sm">{bestBid ? `₹${Number(bestBid).toFixed(2)}` : '—'}</p>
                        </div>
                        <div className="text-center flex-1 border-x border-white/10 px-4">
                            <p className="text-gray-500 text-[10px] uppercase">LTP</p>
                            <p className="text-yellow-400 font-bold text-lg">{ltp ? `₹${Number(ltp).toFixed(2)}` : '—'}</p>
                        </div>
                        <div className="text-center flex-1">
                            <p className="text-gray-500 text-[10px] uppercase">Ask</p>
                            <p className="text-red-400 font-semibold text-sm">{bestAsk ? `₹${Number(bestAsk).toFixed(2)}` : '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="px-4 py-4 space-y-4">

                    {/* Buy/Sell Toggle */}
                    <div className="flex gap-2">
                        <button
                            className={`flex-1 py-2.5 rounded-lg font-semibold transition ${actionTab === 'Buy' ? 'bg-green-600 text-white' : 'bg-[#252B3B] text-gray-400'}`}
                            onClick={() => setActionTab('Buy')}
                        >
                            BUY
                        </button>
                        {userRole === 'broker' && (<button
                            className={`flex-1 py-2.5 rounded-lg font-semibold transition ${actionTab === 'Sell' ? 'bg-red-600 text-white' : 'bg-[#252B3B] text-gray-400'}`}
                            onClick={() => setActionTab('Sell')}
                        >
                            SELL
                        </button>)}
                    </div>

                    {/* Product Type */}
                    <div>
                        <p className="text-gray-500 text-xs mb-2">Product Type</p>
                        <div className="flex gap-2">
                            <button
                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${getProductTypeClass('Intraday')}`}
                                onClick={() => setProductType('Intraday')}
                            >
                                Intraday
                            </button>
                            <button
                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${getProductTypeClass('Overnight')}`}
                                onClick={() => setProductType('Overnight')}
                            >
                                Overnight
                            </button>
                        </div>
                    </div>

                    {/* Quantity Input */}
                    <div>
                        <p className="text-gray-500 text-xs mb-2">Quantity (Lots)</p>
                        <input
                            ref={inputRef}
                            type="number"
                            value={localLotsStr}
                            onChange={handleInputChange}
                            placeholder="Enter lots"
                            className="w-full p-3 bg-[#252B3B] text-white rounded-lg text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-white/10"
                            min="1"
                        />
                        <div className="flex justify-between mt-2 text-xs">
                            <span className="text-gray-500">Lot size: <span className="text-white">{lotSize}</span></span>
                            <span className="text-gray-500">Qty: <span className="text-white">{qtyNum}</span></span>
                        </div>
                    </div>

                    {/* Jobbing Price (Broker Only) */}
                    {userRole === 'broker' && (
                        <div>
                            <p className="text-gray-500 text-xs mb-2">Jobbing %</p>
                            <div className="flex items-center bg-[#252B3B] rounded-lg p-3 border border-white/10">
                                <Hash className="w-4 h-4 text-gray-400 mr-2" />
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.08"
                                    value={jobbin_price}
                                    onChange={(e) => setJobbin_price(e.target.value)}
                                    className="bg-transparent text-white font-medium focus:outline-none w-full"
                                />
                            </div>
                        </div>
                    )}

                    {/* Price Display (Broker Only) */}
                    {userRole === 'broker' && (
                        <div className="bg-[#252B3B] rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-400">Adj. Price:</span>
                                <span className="text-white font-mono">{adjustedPricePerShare}</span>
                            </div>
                            <div className="flex justify-between items-center border-t border-white/10 pt-2">
                                <span className="text-gray-400 text-sm">Total Value:</span>
                                <span className="text-white font-bold text-lg">
                                    {totalOrderValue ? `₹${totalOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Feedback */}
                    {feedback && (
                        <div className={`p-3 rounded-lg text-sm text-center ${feedback.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                            {feedback.message}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="space-y-2 pt-2">
                        {(userRole === 'broker' || isMarketOpen) && (
                            <button
                                onClick={handleConfirm}
                                disabled={submitting || !lotsNum}
                                className={`w-full py-3.5 rounded-lg font-bold text-white text-base transition ${actionTab === 'Buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                                    } ${(submitting || !lotsNum) ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {submitting ? 'Placing Order...' : `INSTANT ${actionTab.toUpperCase()}`}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="w-full py-3 rounded-lg bg-[#252B3B] text-gray-300 font-medium transition hover:bg-[#333846]"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes slide-up {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                .animate-slide-up { animation: slide-up 0.3s ease-out; }
            `}</style>
        </>
    );
};

export default OptionStrikeBottomWindow;