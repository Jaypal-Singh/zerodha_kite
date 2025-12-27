import React, { useState, useEffect } from 'react';
import { ShoppingCart, DollarSign, Hash, Zap, XCircle, Target, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { getFundsData } from '../../../Utils/fetchFund.jsx';
import { logMarketStatus } from '../../../Utils/marketStatus.js';
import { calculatePnLAndBrokerage } from '../../../Utils/calculateBrokerage.jsx';

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

const DetailRow = ({ Icon, label, value, colorClass }) => {
    return (
        <div className="flex justify-between items-center py-0.5 px-2">
            <div className="flex items-center text-gray-400">
                {Icon && <Icon className="w-3 h-3 mr-2" />}
                <span className="text-xs">{label}</span>
            </div>
            <span className={`text-sm font-medium ${colorClass || "text-white"}`}>
                {value}
            </span>
        </div>
    );
};

export default function OpenOrderBottomWindow({ selectedOrder, onClose, sheetData }) {

    if (!selectedOrder) return null;
    const isOpen = logMarketStatus();

    const userString = localStorage.getItem('loggedInUser');
    const userObject = userString ? JSON.parse(userString) : {};
    const userRole = userObject.role;

    // For option chain orders, expiry is in meta.expiry
    // For regular orders, expiry is in meta.selectedStock.expiry
    const expireDate = selectedOrder.meta?.expiry || selectedOrder.meta?.selectedStock?.expiry;
    const date = expireDate ? new Date(expireDate) : null;
    const formattedStockExpireDate = date
        ? String(date.getDate()).padStart(2, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + date.getFullYear()
        : 'N/A';

    const {
        symbol, side, product, quantity: initialQty, price: initialPrice, jobbin_price,
        instrument_token, segment, _id: orderId, lots, stop_loss, target, margin_blocked
    } = selectedOrder;

    const lotSize = Number(selectedOrder.lot_size) || Number(selectedOrder.meta?.selectedStock?.lot_size) || 1;
    const ltpRaw = sheetData?.ltp != null ? Number(sheetData.ltp) : null;
    const currentPrice = ltpRaw || Number(initialPrice) || 0;
    const formattedCMP = currentPrice ? `₹${currentPrice.toFixed(2)}` : '—';

    const tradingsymbol = selectedOrder.meta?.selectedStock?.tradingSymbol ?? symbol ?? "N/A";
    const orderSide = String(side ?? "").toUpperCase();
    const productType = product === 'MIS' ? 'Intraday' : 'Overnight';

    const avg = Number(initialPrice ?? 0);
    const ltp = Number(sheetData?.ltp ?? avg);
    const qty = Number(initialQty ?? 0);
    const isBuy = orderSide === 'BUY';

    // 🔹 Brokerage + P&L (entry-only)
    const {
        grossPnl,
        totalBrokerage,
        netPnl,
    } = calculatePnLAndBrokerage({
        side: orderSide,
        avgPrice: avg,
        ltp,
        qty,
        brokeragePercentPerSide: 0.01,
        mode: "entry-only",
    });

    const pnlColor = netPnl >= 0 ? "text-green-400" : "text-red-400";

    // States
    const [addLotInput, setAddLotInput] = useState('');
    // SL & Target States
    const [slPrice, setSlPrice] = useState(selectedOrder.stop_loss || '');
    const [targetPrice, setTargetPrice] = useState(selectedOrder.target || '');

    const [submitting, setSubmitting] = useState(false);
    const [action, setAction] = useState('Adjust');
    const [feedback, setFeedback] = useState(null);
    const [orderStatus, setOrderStatus] = useState((selectedOrder.order_status || 'OPEN').toUpperCase());

    // --- Price Edit State (Ported) ---
    const [isEditingPrice, setIsEditingPrice] = useState(false);
    const [editPriceInput, setEditPriceInput] = useState('');

    const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";
    const token = localStorage.getItem("token") || null;
    const activeContextString = localStorage.getItem('activeContext');
    const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
    const brokerId = activeContext.brokerId;
    const customerId = activeContext.customerId;

    useEffect(() => {
        setAddLotInput('');
        setSlPrice(selectedOrder.stop_loss || '');
        setTargetPrice(selectedOrder.target || '');
        setFeedback(null);
        setOrderStatus((selectedOrder.order_status || 'OPEN').toUpperCase());
    }, [selectedOrder]);

    // --- ADD LOT CALCULATION ---
    const currentLots = Number(lots ?? 0);
    const parsedAddLots = Math.max(0, parseInt(String(addLotInput).trim() || '0', 10));

    const targetTotalLots = currentLots + parsedAddLots;
    const targetTotalQuantity = targetTotalLots * lotSize;

    // Weighted Avg Price Logic
    let computedAvg = avg;
    if (parsedAddLots > 0) {
        const existingVal = qty * avg;
        const newVal = (parsedAddLots * lotSize) * currentPrice;
        computedAvg = (existingVal + newVal) / targetTotalQuantity;
    }
    const displayComputedAvg = `₹${Number(computedAvg || 0).toFixed(2)}`;



    // --- PRICE EDIT HANDLER (Ported) ---
    const handlePriceSave = async () => {
        if (!editPriceInput || isNaN(editPriceInput) || Number(editPriceInput) < 0) {
            setFeedback({ type: 'error', message: 'Invalid Price' });
            return;
        }

        setSubmitting(true);
        try {
            const endpoint = `${apiBase.replace(/\/$/, "")}/api/orders/updateOrder`;
            const payload = {
                broker_id_str: brokerId,
                customer_id_str: customerId,
                order_id: orderId,
                price: Number(editPriceInput),
                meta: { from: 'ui_open_order_window_edit_price' }
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify(payload)
            });

            let body = null;
            try { body = await res.json(); } catch (e) { }

            if (!res.ok || (body && body.success === false)) {
                throw new Error(body?.message || `Server error: ${res.status}`);
            }

            setFeedback({ type: 'success', message: 'Price Updated Successfully!' });
            setIsEditingPrice(false);

            try {
                window.dispatchEvent(new CustomEvent('orders:changed', { detail: { order: body?.order } }));
            } catch (e) { }

        } catch (err) {
            console.error("Price Edit Error:", err);
            setFeedback({ type: 'error', message: `Failed: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    // --- MAIN ACTION HANDLER ---
    const handleAction = async (clickedAction, targetStatus) => {
        setSubmitting(true);
        setFeedback(null);

        try {
            // =========================================
            // 1. VALIDATION LOGIC (SL/Target/Lots)
            // =========================================

            if (targetStatus === 'OPEN' && clickedAction === 'Adjust') {

                const sl = Number(slPrice) || 0;
                const tgt = Number(targetPrice) || 0;

                // A. Stop Loss & Target Validation (Real Market Rules)
                if (currentPrice > 0) {
                    if (orderSide === 'BUY') {
                        // [BUY RULE]: SL must be LOWER than Current Price
                        if (sl > 0 && sl >= currentPrice) {
                            setFeedback({ type: 'error', message: `Invalid SL: For BUY, SL must be lower than CMP (${currentPrice})` });
                            setSubmitting(false); return;
                        }
                        // [BUY RULE]: Target must be HIGHER than Current Price
                        if (tgt > 0 && tgt <= currentPrice) {
                            setFeedback({ type: 'error', message: `Invalid Target: For BUY, Target must be higher than CMP (${currentPrice})` });
                            setSubmitting(false); return;
                        }
                    } else {
                        // [SELL RULE]: SL must be HIGHER than Current Price
                        if (sl > 0 && sl <= currentPrice) {
                            setFeedback({ type: 'error', message: `Invalid SL: For SELL, SL must be higher than CMP (${currentPrice})` });
                            setSubmitting(false); return;
                        }
                        // [SELL RULE]: Target must be LOWER than Current Price
                        if (tgt > 0 && tgt >= currentPrice) {
                            setFeedback({ type: 'error', message: `Invalid Target: For SELL, Target must be lower than CMP (${currentPrice})` });
                            setSubmitting(false); return;
                        }
                    }
                }

                // B. Fund Check
                if (parsedAddLots > 0) {
                    try {
                        const fundsData = await getFundsData();
                        if (!fundsData) throw new Error("Unable to fetch wallet balance.");

                        const requiredAmount = (parsedAddLots * lotSize) * currentPrice;
                        let availableLimit = 0;

                        if (productType === 'Intraday') {
                            const max = fundsData.intraday?.available_limit || 0;
                            const used = fundsData.intraday?.used_limit || 0;
                            availableLimit = max - used;
                        } else {
                            availableLimit = (fundsData.overnight?.available_limit || 0);
                        }

                        if (requiredAmount > availableLimit) {
                            setFeedback({
                                type: 'error',
                                message: `Insufficient Funds! Required: ₹${requiredAmount.toFixed(2)}, Available: ₹${availableLimit.toFixed(2)}`
                            });
                            setSubmitting(false);
                            return;
                        }
                    } catch (fundErr) {
                        setFeedback({ type: 'error', message: "Fund check failed. Try again." });
                        setSubmitting(false);
                        return;
                    }
                }
            }

            // =========================================
            // 2. API CALL PREPARATION
            // =========================================

            const endpoint = `${apiBase.replace(/\/$/, "")}/api/orders/updateOrder`;
            const method = 'POST';
            let payload;

            if (targetStatus === 'OPEN') {
                payload = {
                    broker_id_str: brokerId,
                    customer_id_str: customerId,
                    order_id: orderId,
                    instrument_token: instrument_token,
                    symbol: tradingsymbol,
                    side: orderSide,
                    product: 'MIS',
                    lots: String(targetTotalLots),
                    quantity: Number(targetTotalQuantity),
                    price: Number(Number(computedAvg).toFixed(2)),
                    came_From: 'Open',
                    order_status: 'OPEN',
                    margin_blocked: Number(margin_blocked),
                    // --- SEND SL & TARGET ---
                    stop_loss: slPrice ? Number(slPrice) : 0,
                    target: targetPrice ? Number(targetPrice) : 0,

                    meta: { from: 'ui_open_order_window_add' }
                };
            } else {
                // *** EXIT LOGIC ***
                const liveLtp = Number(sheetData?.ltp ?? 0);
                const jobbing = Number(jobbin_price ?? 0);
                let closedLtp = liveLtp;

                if (liveLtp > 0 && !Number.isNaN(jobbing)) {
                    if (orderSide === 'BUY') closedLtp = liveLtp - (liveLtp * (jobbing / 100));
                    else closedLtp = liveLtp + (liveLtp * (jobbing / 100));
                }

                payload = {
                    broker_id_str: brokerId,
                    customer_id_str: customerId,
                    order_id: orderId,
                    instrument_token: instrument_token,
                    closed_ltp: Number(Number(closedLtp || 0).toFixed(4)),
                    closed_at: new Date().toISOString(),
                    symbol: tradingsymbol,
                    order_status: targetStatus,
                    came_From: targetStatus === 'HOLD' ? 'Hold' : 'Open',
                    meta: { from: 'ui_open_order_window_exit' }
                };
            }

            const res = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify(payload)
            });

            let body = null;
            try { body = await res.json(); } catch (e) { }

            if (!res.ok || (body && body.success === false)) {
                throw new Error(body?.message || `Server error: ${res.status}`);
            }

            let successMsg = `${clickedAction} successful.`;
            if (clickedAction === 'Adjust' && parsedAddLots === 0) successMsg = "Order Updated Successfully!";

            setFeedback({ type: 'success', message: successMsg });

            try {
                window.dispatchEvent(new CustomEvent('orders:changed', { detail: { order: body?.order } }));
            } catch (e) { }

            setTimeout(() => onClose(), 1000);

        } catch (err) {
            console.error("HandleAction Error:", err);
            setFeedback({ type: 'error', message: `Failed: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="open-order-bottom-window fixed bottom-0 left-0 right-0 z-50 bg-[#121A2B] border-t border-white/10 shadow-2xl p-4 transition-transform duration-300">
            <div className="flex justify-between items-start mb-3 border-b border-white/10 pb-2">
                <h3 className="text-xl text-white font-bold tracking-wide">{tradingsymbol} ({orderSide})</h3>
                <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:text-white transition">
                    <XCircle className="w-6 h-6" />
                </button>
            </div>

            {feedback && (
                <div className={`p-2 mb-3 rounded-md text-sm ${feedback.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                    {feedback.message}
                </div>
            )}

            <div className="mb-4 flex justify-between items-end">
                <div>
                    <p className="text-xl font-bold">
                        <span className="text-gray-300 mr-1">₹</span>
                        <span className={pnlColor}>{formattedCMP}</span>
                    </p>
                    <p className="text-xs text-gray-500">Current Market Price</p>
                </div>
                <div className="text-right">
                    <p className={`text-xl font-bold ${pnlColor}`}>{money(netPnl)}</p>
                    <p className="text-xs text-gray-500">Net P&L (after brokerage)</p>
                </div>
            </div>

            <div className="mb-2 p-2 bg-[#1A1F30] rounded-md text-xs">
                <DetailRow label="Quantity" value={`${initialQty} shares`} />
                <DetailRow label="Lots" value={`${lots} lots`} />
                <DetailRow label="Avg. Buy Price" value={money(initialPrice)} colorClass="text-yellow-300" />
                <DetailRow label="Type" value={orderSide} colorClass={isBuy ? "text-green-400" : "text-red-400"} />
                <DetailRow label="Order Instant" value={productType} colorClass="text-gray-300" />
                <DetailRow label="Expire Date" value={formattedStockExpireDate} colorClass="text-gray-300" />
                <DetailRow
                    label="Gross P&L"
                    value={money(grossPnl)}
                    colorClass={grossPnl >= 0 ? "text-green-400" : "text-red-400"}
                />
                <DetailRow
                    label="Est. Brokerage (entry)"
                    value={`-${money(totalBrokerage)}`}
                    colorClass="text-red-400"
                />
                {/* Purani value show kar rahe hain sirf reference ke liye, user ne mana nahi kiya display se, button se mana kiya hai */}
                {(stop_loss !== 0 && stop_loss != null) && <DetailRow label="Stop Loss" value={stop_loss} colorClass="text-gray-300" />}
                {(target !== 0 && target != null) && <DetailRow label="Target" value={target} colorClass="text-gray-300" />}
            </div>

            <div className="p-3 bg-[#1F2028] rounded-lg mb-4">
                <h4 className="text-lg font-semibold mb-3 text-white">MODIFY ORDER</h4>
                <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                        <h6 className='text-lg font-semibold text-white'>Add Lot</h6>
                        <input
                            type="number"
                            min="0"
                            value={addLotInput}
                            onChange={(e) => setAddLotInput(e.target.value)}
                            placeholder="0"
                            className="flex-1 p-2 bg-[#2A314A] text-white rounded-md transition"
                            disabled={orderStatus !== 'OPEN'}
                        />
                        <div className="text-xs text-gray-400 italic">
                            Size: <span className="font-medium text-white ml-1">{lotSize}</span>
                        </div>
                    </div>

                    {/* --- SL & TARGET INPUTS (Half-Half) --- */}
                    <div className="flex space-x-2">
                        <div className="flex-1 flex items-center space-x-2 bg-[#2A314A] p-2 rounded-md">
                            <AlertCircle className="w-4 h-4 text-red-400" />
                            <div className="flex flex-col w-full">
                                <span className="text-[10px] text-gray-400 uppercase">Stop Loss</span>
                                <input
                                    type="number"
                                    value={slPrice}
                                    onChange={(e) => setSlPrice(e.target.value)}
                                    placeholder="0.00"
                                    className="bg-transparent text-white font-medium focus:outline-none w-full"
                                />
                            </div>
                        </div>

                        <div className="flex-1 flex items-center space-x-2 bg-[#2A314A] p-2 rounded-md">
                            <Target className="w-4 h-4 text-green-400" />
                            <div className="flex flex-col w-full">
                                <span className="text-[10px] text-gray-400 uppercase">Target</span>
                                <input
                                    type="number"
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(e.target.value)}
                                    placeholder="0.00"
                                    className="bg-transparent text-white font-medium focus:outline-none w-full"
                                />
                            </div>
                        </div>
                    </div>

                    {userRole === 'broker' && (
                        <div className="flex items-center">
                            <Hash className="w-5 h-5 text-gray-400 mr-2" />
                            <div className="w-75 p-2 bg-[#2A314A] text-white rounded-md transition flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <span className="text-sm">New Avg. Price</span>
                                </div>

                                {isEditingPrice ? (
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="number"
                                            value={editPriceInput}
                                            onChange={(e) => setEditPriceInput(e.target.value)}
                                            className="w-24 bg-[#1F2028] text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none"
                                        />
                                        <button onClick={handlePriceSave} disabled={submitting} className="p-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/40">
                                            <Check className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => setIsEditingPrice(false)} disabled={submitting} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/40">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center">
                                        <span className="font-medium mr-2">{displayComputedAvg}</span>
                                        <button
                                            onClick={() => {
                                                setEditPriceInput(Number(computedAvg).toFixed(2));
                                                setIsEditingPrice(true);
                                            }}
                                            className="text-gray-400 hover:text-white"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {(userRole === 'broker' || isOpen) && (
                <div className="space-y-2">
                    <div className="flex space-x-2">
                        {/* UPDATE BUTTON: Text remains "BUY MORE" or "UPDATING" per user request */}
                        <button
                            onClick={() => handleAction('Adjust', 'OPEN')}
                            disabled={submitting}
                            className={`flex-1 p-3 rounded-lg text-white font-semibold transition bg-green-500 hover:bg-blue-700 ${submitting ? 'opacity-50' : ''}`}
                        >
                            {submitting && action === 'Adjust'
                                ? 'UPDATING...'
                                : (parsedAddLots > 0 ? 'BUY MORE..' : 'BUY MORE')}
                        </button>
                        <button
                            onClick={() => handleAction('Adjust', 'CLOSED')}
                            disabled={submitting}
                            className={`flex-1 p-3 rounded-lg text-white font-semibold transition bg-red-500 hover:bg-yellow-700 ${submitting ? 'opacity-50' : ''}`}
                        >
                            EXIT
                        </button>
                    </div>

                    {userRole === 'broker' && (
                        <button
                            onClick={() => handleAction('Adjust', 'HOLD')}
                            disabled={submitting}
                            className={`w-full p-3 rounded-lg text-white font-semibold transition bg-blue-500 hover:bg-purple-700 ${submitting ? 'opacity-50' : ''}`}
                        >
                            CONVERT TO HOLD
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}