// Summery.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { TrendingUp, ShoppingCart, DollarSign, Hash, Zap, TrendingDown, DollarSign as BidAskIcon } from 'lucide-react';
// *** IMPORT FETCH FUND UTILITY ***
import { getFundsData } from '../../../Utils/fetchFund.jsx';
import { logMarketStatus } from '../../../Utils/marketStatus.js'

const DetailRow = ({ Icon, label, value, colorClass = "text-[var(--text-primary)]" }) => (
  <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)] last:border-b-0">
    <div className="flex items-center text-[var(--text-secondary)] text-sm">
      <Icon className="w-4 h-4 mr-2 text-indigo-400" />
      {label}
    </div>
    <span className={`font-medium text-sm ${value === '—' ? 'text-[var(--text-muted)]' : colorClass}`}>
      {value}
    </span>
  </div>
);

function Summery({
  selectedStock,
  sheetData,
  actionTab,
  setActionTab,
  quantity,
  setQuantity,
  orderPrice,
  setOrderPrice,
  placeFakeOrder,
  setSelectedStock,
  productType,
  setProductType,
  ticksRef,
}) {
  // ---------- local states ----------
  const [jobbin_price, setJobbin_price] = useState("0.08");
  const [localLotsStr, setLocalLotsStr] = useState('');
  const inputRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const isOpen = logMarketStatus();

  // ---------- FRESH DATA HELPER ----------
  // Gets the latest tick data directly from ticksRef (Kite uses instrument_token)
  const getLatestTickData = () => {
    if (!selectedStock || !ticksRef?.current) return null;
    // Kite uses instrument_token as the key
    const key = String(selectedStock.instrument_token);
    return ticksRef.current.get(key) || null;
  };

  // Smart price extraction - handles instruments with only close price
  const extractValidPrice = (data, isBuy = true) => {
    if (!data) return null;
    // Priority 1: LTP (live trading price)
    if (data.ltp != null && data.ltp > 0) return data.ltp;
    // Priority 2: Best Ask (for BUY) or Best Bid (for SELL)
    if (isBuy && data.bestAskPrice != null && data.bestAskPrice > 0) return data.bestAskPrice;
    if (!isBuy && data.bestBidPrice != null && data.bestBidPrice > 0) return data.bestBidPrice;
    // Priority 3: Opposite side bid/ask
    if (isBuy && data.bestBidPrice != null && data.bestBidPrice > 0) return data.bestBidPrice;
    if (!isBuy && data.bestAskPrice != null && data.bestAskPrice > 0) return data.bestAskPrice;
    // Priority 4: Close price (for illiquid instruments)
    if (data.close != null && data.close > 0) return data.close;
    return null;
  };

  // Check if we have ANY valid price data
  const hasValidPriceData = (data) => {
    if (!data) return false;
    return (
      (data.ltp != null && data.ltp > 0) ||
      (data.bestBidPrice != null && data.bestBidPrice > 0) ||
      (data.bestAskPrice != null && data.bestAskPrice > 0) ||
      (data.close != null && data.close > 0)
    );
  };

  // Ensure productType once (Intraday or Overnight)
  useEffect(() => {
    if (!productType) setProductType('Intraday');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selectedStock changes, reset local lots
  useEffect(() => {
    const lotSize = selectedStock?.lot_size || selectedStock?.lotSize || 1;
    if (quantity != null) {
      const n = Number(quantity);
      const lots = Number.isFinite(n) && lotSize > 0 ? Math.floor(n / lotSize) : 0;
      setLocalLotsStr(lots > 0 ? String(lots) : '');
    } else {
      setLocalLotsStr('');
    }
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock]);

  // ---------- market values ----------
  const ltpRaw = sheetData?.ltp != null ? Number(sheetData.ltp) : null;
  const bestBidRaw = sheetData?.bestBidPrice != null ? Number(sheetData.bestBidPrice) : null;
  const bestAskRaw = sheetData?.bestAskPrice != null ? Number(sheetData.bestAskPrice) : null;

  const showHigh = sheetData?.high != null ? `₹${Number(sheetData.high).toFixed(2)}` : '—';
  const showLow = sheetData?.low != null ? `₹${Number(sheetData.low).toFixed(2)}` : '—';
  const showClose = sheetData?.close != null ? `₹${Number(sheetData.close).toFixed(2)}` : '—';

  const changeSign = sheetData?.percentChange != null ? (sheetData.percentChange >= 0 ? '▲' : '▼') : '';
  const formattedChangePercent = sheetData?.percentChange != null
    ? `${changeSign} ${Math.abs(Number(sheetData.percentChange)).toFixed(2)}%`
    : '—';

  const getProductTypeClass = (mode) => {
    if (productType !== mode) return 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
    return actionTab === 'Buy' ? 'bg-green-600 text-white shadow-lg' : 'bg-red-600 text-white shadow-lg';
  };

  // ---------- calculations ----------
  const lotsNum = useMemo(() => {
    const n = Number(localLotsStr);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [localLotsStr]);

  const lotSize = selectedStock?.lot_size || selectedStock?.lotSize || 1;
  const qtyNum = useMemo(() => {
    return lotsNum > 0 ? lotsNum * (Number(lotSize) || 1) : 0;
  }, [lotsNum, lotSize]);

  const jobbinPct = useMemo(() => {
    const v = parseFloat(String(jobbin_price).trim());
    return Number.isFinite(v) ? v / 100 : 0;
  }, [jobbin_price]);

  const baseLtp = ltpRaw ?? bestAskRaw ?? bestBidRaw ?? 0;

  const { adjustedPricePerShareRaw, adjustedPricePerShare } = useMemo(() => {
    if (!baseLtp) return { adjustedPricePerShareRaw: 0, adjustedPricePerShare: 0 };
    const perShareFactor = actionTab === 'Buy' ? (1 + jobbinPct) : (1 - jobbinPct);
    const pxRaw = baseLtp * perShareFactor;
    return { adjustedPricePerShareRaw: pxRaw, adjustedPricePerShare: Number(pxRaw.toFixed(4)) };
  }, [baseLtp, actionTab, jobbinPct]);

  const totalOrderValue = useMemo(() => {
    if (!adjustedPricePerShare || !qtyNum) return 0;
    return Number((adjustedPricePerShare * qtyNum).toFixed(2));
  }, [adjustedPricePerShare, qtyNum]);

  useEffect(() => {
    if (totalOrderValue > 0) setOrderPrice(String(totalOrderValue));
    else setOrderPrice('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalOrderValue]);

  // ---------- handlers ----------
  const handleInputChange = (e) => {
    const v = e.target.value;
    setLocalLotsStr(v);
    setFeedback(null);
  };

  const propagateQtyToParent = () => {
    const rawLots = (localLotsStr || (inputRef.current && inputRef.current.value) || '').toString().trim();
    const n = parseInt(rawLots, 10);
    const lots = Number.isFinite(n) && n > 0 ? n : 0;
    const totalShares = lots > 0 ? String(lots * (Number(lotSize) || 1)) : '';
    setQuantity && setQuantity(totalShares);
  };

  const handleQtyBlur = () => {
    propagateQtyToParent();
  };


  // *** MAIN ORDER HANDLER ***
  const handleConfirm = async () => {
    setSubmitting(true);
    setFeedback(null);

    propagateQtyToParent();

    const rawLots = (localLotsStr || (inputRef.current && inputRef.current.value) || '').toString().trim();
    const parsedLots = parseInt(rawLots, 10);
    const lots = Number.isFinite(parsedLots) && parsedLots > 0 ? parsedLots : 0;

    // 1. Basic Input Validation
    if (!lots) {
      setFeedback({ type: 'error', message: 'Please enter a valid lot count.' });
      setSubmitting(false);
      return;
    }

    // *** CRITICAL: Get FRESH price from ticksRef at this exact moment ***
    const isBuy = actionTab === 'Buy';
    const latestTickData = getLatestTickData();
    const freshPrice = extractValidPrice(latestTickData, isBuy);

    // Smart validation - only block if we have NO valid price data at all
    if (freshPrice === null) {
      // Check sheetData as fallback (from React state)
      const fallbackPrice = extractValidPrice(sheetData, isBuy);
      if (fallbackPrice === null) {
        setFeedback({ type: 'error', message: 'Unable to fetch price. Please wait a moment and try again.' });
        setSubmitting(false);
        return;
      }
    }

    // Use fresh price if available, otherwise fallback to displayed price
    const priceForOrder = freshPrice ?? extractValidPrice(sheetData, isBuy) ?? 0;

    const activeContextString = localStorage.getItem('activeContext');
    const activeContext = activeContextString ? JSON.parse(activeContextString) : null;
    const brokerId = activeContext?.brokerId || '';
    const customerId = activeContext?.customerId || '';

    const side = isBuy ? 'BUY' : 'SELL';
    const product = productType === 'Intraday' ? 'MIS' : 'NRML';
    const lot_size = selectedStock?.lot_size || selectedStock?.lotSize || 1;
    const qty = Number(lots) * Number(lot_size);

    // Calculate final price with jobbin adjustment using FRESH price
    const jobbinFactor = isBuy ? (1 + jobbinPct) : (1 - jobbinPct);
    const finalPrice = Number((priceForOrder * jobbinFactor).toFixed(4));
    const calculatedOrderValue = Number((finalPrice * qty).toFixed(2));

    // *** 2. FUND VALIDATION LOGIC ***
    try {
      // Calculate Total Required Amount for this Order (using fresh calculated value)
      const requiredAmount = calculatedOrderValue;

      // Fetch Latest Funds from Backend
      const fundsData = await getFundsData();

      if (!fundsData) {
        throw new Error("Unable to fetch wallet balance.");
      }

      let availableLimit = 0;
      let limitType = "";

      if (productType === 'Intraday') {
        // Intraday Free Limit = Available - Used
        const maxLimit = fundsData.intraday?.available_limit || 0;
        const usedLimit = fundsData.intraday?.used_limit || 0;
        availableLimit = maxLimit - usedLimit;
        limitType = "Intraday";
      } else {
        // Overnight Free Limit = Available - Used
        const maxLimit = fundsData.overnight?.available_limit || 0;
        const usedLimit = fundsData.overnight?.used_limit || 0;
        availableLimit = maxLimit - usedLimit;
        limitType = "Overnight";
      }

      // Check Logic
      if (requiredAmount > availableLimit) {
        // *** NOT ENOUGH BALANCE - RED TOAST ***
        setFeedback({
          type: 'error',
          message: `Insufficient ${limitType} Balance! Required: ₹${requiredAmount}, Available: ₹${availableLimit.toFixed(2)}. Add funds.`
        });
        setSubmitting(false);
        return; // Stop execution here
      }

    } catch (err) {
      console.error("Fund validation error:", err);
      setFeedback({ type: 'error', message: "Failed to validate funds. Try again." });
      setSubmitting(false);
      return;
    }

    // *** 3. PROCEED TO PLACE ORDER (If Funds OK) ***
    const payload = {
      broker_id_str: brokerId,
      customer_id_str: customerId,
      instrument_token: selectedStock?.instrument_token || '',
      symbol: selectedStock?.tradingSymbol || '',
      segment: selectedStock?.segment || '',
      side,
      product,
      price: Number(finalPrice),
      quantity: qty,
      lots: Number(lots),
      lot_size: Number(lot_size),
      jobbin_price: jobbin_price,
      expire: selectedStock?.expiry || new Date().toLocaleString('en-IN'),
      meta: { from: 'ui_watchlist_summery', selectedStock }
    };

    const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";

    try {
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

      console.log('Order successful:', body);
      // *** GREEN SUCCESS TOAST ***
      setFeedback({ type: 'success', message: 'Order placed successfully!' });

      setTimeout(() => {
        setSelectedStock && setSelectedStock(null);
      }, 1500);

    } catch (err) {
      console.error('Order submission failed', err);
      setFeedback({ type: 'error', message: `Order failed: ${String(err.message || err)}` });

    } finally {
      setSubmitting(false);
    }
  };

  const userString = localStorage.getItem('loggedInUser');
  const userObject = userString ? JSON.parse(userString) : {};
  const userRole = userObject.role;

  // Use an input key so React will remount the input only when selectedStock changes.
  const qtyInputKey = selectedStock ? (selectedStock.instrument_token ?? selectedStock.symbol ?? JSON.stringify(selectedStock)) : 'qty-global';

  const formattedCMP = baseLtp ? `₹${baseLtp.toFixed(2)}` : '—';

  return (
    <div className="overflow-y-auto max-h-[80vh] p-2">
      {/* CMP */}
      <div className="mb-4">
        <p className="text-xl font-bold">
          <span className="text-[var(--text-secondary)] mr-1">₹</span>
          <span className={
            sheetData?.isPositive === true
              ? "text-green-500"
              : sheetData?.isPositive === false
                ? "text-red-500"
                : "text-[var(--text-primary)]"
          }>
            {formattedCMP}
          </span>
          <span className={`text-sm font-normal ml-2 ${sheetData?.isPositive === true ? "text-green-400" :
            sheetData?.isPositive === false ? "text-red-400" : "text-[var(--text-secondary)]"
            }`}>
            {formattedChangePercent}
          </span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">Current Market Price (CMP)</p>
      </div>

      {/* Buy/Sell */}
      <div className="flex space-x-2 mb-2">
        <button
          className={`flex-1 p-2 rounded-lg font-semibold transition ${actionTab === 'Buy' ? 'bg-green-600 text-white shadow-lg' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          onClick={() => setActionTab('Buy')}
        >
          BUY
        </button>
        <button
          className={`flex-1 p-2 rounded-lg font-semibold transition ${actionTab === 'Sell' ? 'bg-red-600 text-white shadow-lg' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          onClick={() => setActionTab('Sell')}
        >
          SELL
        </button>
      </div>

      {/* Product type */}
      <h4 className="text-20 font-semibold mb-2 text-[var(--text-secondary)] text-muted">Product Order</h4>
      <div className="flex space-x-2 mb-4">
        <button className={`flex-1 p-2 rounded-lg  font-semibold transition ${getProductTypeClass('Intraday')}`} onClick={() => setProductType('Intraday')}>Intraday</button>
        <button className={`flex-1 p-2 rounded-lg  font-semibold transition ${getProductTypeClass('Overnight')}`} onClick={() => setProductType('Overnight')}>overnight</button>
      </div>

      {/* <h4 className="text-20 font-semibold mb-2 text-white/80 text-muted">Order Type</h4>
      <div className="flex space-x-2 mb-4">
        <button className={`flex-1 p-2 rounded-lg text-xs font-medium transition ${getProductTypeClass('Market')}`} >Market</button>
        <button className={`flex-1 p-2 rounded-lg text-xs font-medium transition ${getProductTypeClass('SL')}`} >SL</button>
      </div> */}

      {feedback && (
        <div className={`p-2 mb-3 rounded-md text-sm ${feedback.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
          {feedback.message}
        </div>
      )}

      {/* Order inputs */}
      <div className="p-3 bg-[var(--bg-secondary)] rounded-lg mb-4">
        <h4 className="text-lg font-semibold mb-3 text-[var(--text-primary)]">{actionTab === 'Buy' ? 'Place Buy Order' : 'Place Sell Order'}</h4>

        <div className="space-y-3">
          {/* Quantity (Lots) Input */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center">
              <h6 className='text-lg font-semibold text-[var(--text-primary)]'>Lot</h6>
            </div>
            <input
              key={qtyInputKey}
              ref={inputRef}
              value={localLotsStr}
              type="number"
              onChange={handleInputChange}
              onBlur={handleQtyBlur}
              placeholder="enter lots (e.g., 1)"
              className="flex-1 p-2 bg-[var(--bg-input)] text-[var(--text-primary)] rounded-md transition border border-[var(--border-color)]"
            />
            <div className="text-xs text-[var(--text-secondary)] italic">Lot size: <span className="font-medium text-[var(--text-primary)] ml-1">{lotSize}</span></div>
          </div>

          {/* Jobbing % */}
          {userRole === 'broker' && (
            <div className="flex items-center">
              <Hash className="w-5 h-5 text-[var(--text-secondary)] mr-2" />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Jobbing %"
                value={jobbin_price}
                onChange={(e) => setJobbin_price(e.target.value)}
                className="w-55 p-2 bg-[var(--bg-input)] text-[var(--text-primary)] rounded-md transition border border-[var(--border-color)]"
              />
            </div>
          )}

          {userRole === 'broker' && (
            <div className="text-xs text-[var(--text-secondary)]">Applied jobbing: <span className="text-[var(--text-primary)] font-medium">{jobbin_price || '0'}%</span></div>
          )}

          {/* Price / share and Total */}
          <div className="text-sm bg-[var(--bg-input)] rounded-md p-3 flex flex-col border border-[var(--border-color)]">
            {userRole === 'broker' && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Price / share (Jobbing applied)</span>
                <span className="text-[var(--text-primary)] font-semibold">{adjustedPricePerShare ? `₹${adjustedPricePerShare.toFixed(4)}` : '—'}</span>
              </div>
            )}
            <div className="flex justify-between mt-2">
              <span className="text-[var(--text-secondary)]">Total Order Value</span>
              <span className="text-[var(--text-primary)] font-semibold">{totalOrderValue ? `₹${totalOrderValue.toFixed(2)}` : '—'}</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex space-x-2">

            {/* Buy/Sell Button: Sirf tab dikhega jab Broker ho YA Market Open ho */}
            {(userRole === 'broker' || isOpen) && (
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className={`flex-1 p-3 rounded-lg text-white font-semibold ${actionTab === 'Buy' ? 'bg-green-600' : 'bg-red-600'} ${submitting ? 'opacity-50' : ''}`}
              >
                {submitting ? 'Placing...' : `${actionTab === 'Buy' ? 'Instant Buy' : 'Instant Sell'}`}
              </button>
            )}

            {/* Cancel Button: Hamesha dikhega taaki user window band kar sake */}
            <button
              onClick={() => setSelectedStock(null)}
              className={`p-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium ${(userRole === 'broker' || isOpen) ? '' : 'flex-1'}`}
            >
              Cancel
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

export default Summery;