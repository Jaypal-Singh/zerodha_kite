import React, { useState, useEffect } from 'react';
import { ShoppingCart, DollarSign, Hash, Zap, XCircle, Target, AlertCircle } from 'lucide-react';
import { getFundsData } from '../../../Utils/fetchFund.jsx';
import { logMarketStatus } from '../../../Utils/marketStatus.js';
import { calculatePnLAndBrokerage } from '../../../Utils/calculateBrokerage.jsx';

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

// sirf ENTRY side pe 0.01%
const ENTRY_BROKERAGE_PERCENT = 0.01;

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

export default function OvernightOrderBottomWindow({ selectedOrder, onClose, sheetData }) {
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
        ? `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`
        : 'N/A';

    const {
        symbol, side, product, quantity: initialQty, price: initialPrice, jobbin_price,
        instrument_token, segment, _id: orderId, lots, stop_loss, target
    } = selectedOrder;

    const lotSize = Number(selectedOrder.lot_size) || Number(selectedOrder.meta?.selectedStock?.lot_size) || 1;

    const ltpRaw = sheetData?.ltp != null ? Number(sheetData.ltp) : null;
    const currentPrice = ltpRaw || Number(initialPrice) || 0;
    const formattedCMP = currentPrice ? `₹${currentPrice.toFixed(2)}` : '—';

    // States
    const [addLotInput, setAddLotInput] = useState('');
    const [slPrice, setSlPrice] = useState(selectedOrder.stop_loss || '');
    const [targetPrice, setTargetPrice] = useState(selectedOrder.target || '');

    const [submitting, setSubmitting] = useState(false);
    const [action, setAction] = useState('Adjust');
    const [feedback, setFeedback] = useState(null);
    const [orderStatus, setOrderStatus] = useState((selectedOrder.order_status || 'OPEN').toUpperCase());

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
        setAction('Adjust');
        setOrderStatus((selectedOrder.order_status || 'OPEN').toUpperCase());
    }, [selectedOrder]);

    const tradingsymbol = selectedOrder.meta?.selectedStock?.tradingSymbol ?? symbol ?? "N/A";
    const orderSide = String(side ?? "").toUpperCase();
    const productType = product === 'MIS' ? 'Intraday' : 'Overnight';

    const avg = Number(initialPrice ?? 0);
    const ltp = Number(sheetData?.ltp ?? avg);
    const qty = Number(initialQty ?? 0);

    // ---------- BROKERAGE + P&L (ENTRY SIDE ONLY) ----------
    const {
        entryValue,
        currentValue,
        brokerageEntry,
        totalBrokerage,
        grossPnl,
        netPnl,
        pct,
    } = calculatePnLAndBrokerage({
        side: orderSide,
        avgPrice: avg,
        ltp,
        qty,
        brokeragePercentPerSide: ENTRY_BROKERAGE_PERCENT,
        mode: "entry-only",
    });

    const pnlColor = netPnl >= 0 ? "text-green-400" : "text-red-400";
    const isBuy = orderSide === 'BUY';
    const adjustActionColor = 'bg-green-600';

    // --- ADD LOT CALCULATION ---
    const currentLots = Number(lots ?? 0);
    const parsedAddLots = Math.max(0, parseInt(String(addLotInput).trim() || '0', 10));
    const targetTotalLots = currentLots + parsedAddLots;
    const targetTotalQuantity = targetTotalLots * lotSize;

    let computedAvg = avg || 0;
    if (parsedAddLots > 0) {
        const totalExisting = avg * qty;
        const totalNew = currentPrice * (parsedAddLots * lotSize);
        computedAvg = (totalExisting + totalNew) / targetTotalQuantity;
    }
    const displayComputedAvg = `₹${Number(computedAvg || 0).toFixed(2)}`;

    // --- ACTION HANDLER ---
    const handleAction = async (intendedAction) => {
        setSubmitting(true);
        setFeedback(null);
        setAction(intendedAction);

        try {
            // Validation & Fund Check
            if (intendedAction === 'Adjust') {

                const sl = Number(slPrice) || 0;
                const tgt = Number(targetPrice) || 0;

                // --- 1. STOP LOSS & TARGET VALIDATION (Real Market Rules) ---
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

                // --- 2. FUND CHECK FOR ADDING LOTS ---
                if (parsedAddLots > 0) {
                    try {
                        const fundsData = await getFundsData();
                        if (!fundsData) throw new Error("Unable to fetch wallet balance.");

                        const requiredAmount = (parsedAddLots * lotSize) * currentPrice;
                        const availableLimit = fundsData.overnight?.available_limit || 0;

                        if (requiredAmount > availableLimit) {
                            setFeedback({
                                type: 'error',
                                message: `Insufficient Overnight Funds! Required: ₹${requiredAmount.toFixed(2)}, Available: ₹${availableLimit.toFixed(2)}`
                            });
                            setSubmitting(false);
                            return;
                        }
                    } catch (fundErr) {
                        setFeedback({ type: 'error', message: "Fund validation failed. Try again." });
                        setSubmitting(false);
                        return;
                    }
                }
            }

            const endpoint = `${apiBase.replace(/\/$/, "")}/api/orders/updateOrder`;
            const basePayload = {
                broker_id_str: brokerId,
                customer_id_str: customerId,
                order_id: orderId,
                instrument_token: instrument_token,
                symbol: tradingsymbol,
                side: orderSide,
                product: product,
                segment: segment,
            };

            let payload = {};

            if (intendedAction === 'Adjust') {
                // *** BUY MORE / UPDATE SL-TARGET ***
                payload = {
                    ...basePayload,
                    lots: String(targetTotalLots),
                    quantity: Number(targetTotalQuantity),
                    price: Number(Number(computedAvg).toFixed(2)),
                    order_status: null,
                    stop_loss: slPrice ? Number(slPrice) : 0,
                    target: targetPrice ? Number(targetPrice) : 0,
                    meta: { from: 'ui_overnight_order_adjustment' }
                };
            } else if (intendedAction === 'Close') {
                // *** EXIT LOGIC ***
                const liveLtp = Number(sheetData?.ltp ?? 0);
                const jobbingRaw = Number(selectedOrder.jobbin_price ?? jobbin_price ?? 0);
                const jobbingPct = Number.isFinite(jobbingRaw) ? (jobbingRaw / 100) : 0;

                let closedLtp = liveLtp || currentPrice || initialPrice || 0;
                if (closedLtp > 0 && jobbingPct !== 0) {
                    if (orderSide === 'BUY') closedLtp = closedLtp - (closedLtp * jobbingPct);
                    else closedLtp = closedLtp + (closedLtp * jobbingPct);
                }

                payload = {
                    ...basePayload,
                    lots: String(lots),
                    quantity: Number(initialQty),
                    closed_ltp: Number(Number(closedLtp || 0).toFixed(4)),
                    closed_at: new Date().toISOString(),
                    order_status: "CLOSED",
                    came_From: 'Overnight',
                    meta: { from: 'ui_overnight_order_closure' }
                };
            }

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

            let successMsg = `${intendedAction} successful.`;
            if (intendedAction === 'Adjust' && parsedAddLots === 0) successMsg = "Order Updated Successfully!";

            setFeedback({ type: 'success', message: successMsg });
            try {
                window.dispatchEvent(new CustomEvent('orders:changed', { detail: { order: body?.order } }));
            } catch (e) { }

            setTimeout(() => onClose(), 1000);

        } catch (err) {
            console.error("Error inside handleAction:", err);
            setFeedback({ type: 'error', message: `Failed: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="open-order-bottom-window fixed bottom-0 left-0 right-0 z-50 bg-[#121A2B] border-t border-white/10 shadow-2xl p-4 transition-transform duration-300">
            <div className="flex justify-between items-start mb-3 border-b border-white/10 pb-2">
                <h3 className="text-xl text-white font-bold tracking-wide">{tradingsymbol} ({orderSide})</h3>
                <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:text-white transition"><XCircle className="w-6 h-6" /></button>
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
                    <p className="text-xs text-gray-500">Net P&L (after entry brokerage)</p>
                </div>
            </div>

            <div className="mb-4 p-2 bg-[#1A1F30] rounded-lg">
                <DetailRow label="Quantity" value={`${initialQty} shares`} />
                <DetailRow label="Lots" value={`${lots} lots`} />
                <DetailRow label="Avg. Buy Price" value={money(initialPrice)} colorClass="text-yellow-300" />
                <DetailRow label="Type" value={orderSide} colorClass={isBuy ? "text-green-400" : "text-red-400"} />
                <DetailRow label="Order Instant" value={productType} colorClass="text-gray-300" />
                <DetailRow label="Expire Date" value={formattedStockExpireDate} colorClass="text-gray-300" />
                {(stop_loss !== 0 && stop_loss != null) && <DetailRow label="Stop Loss" value={stop_loss} colorClass="text-gray-300" />}
                {(target !== 0 && target != null) && <DetailRow label="Target" value={target} colorClass="text-gray-300" />}
                <div className="mt-1 text-right text-[10px] text-gray-500">
                    Est. Brokerage (entry): -{money(brokerageEntry)}
                </div>
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
                            placeholder="Add Lots"
                            className="flex-1 p-2 bg-[#2A314A] text-white rounded-md transition"
                            disabled={orderStatus !== 'OPEN'}
                        />
                        <div className="text-xs text-gray-400 italic">Size: <span className="font-medium text-white ml-1">{lotSize}</span></div>
                    </div>

                    {userRole === 'broker' && (
                        <div className="flex items-center">
                            <Hash className="w-5 h-5 text-gray-400 mr-2" />
                            <div className="w-full p-2 bg-[#2A314A] text-white rounded-md transition flex items-center justify-between">
                                <span className="text-sm">New Avg. Price</span>
                                <span className="font-medium">{displayComputedAvg}</span>
                            </div>
                        </div>
                    )}

                    {/* --- SL & TARGET INPUTS --- */}
                    <div className="flex space-x-2">
                        {/* Stop Loss Input */}
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

                        {/* Target Input */}
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
                </div>
            </div>

            {(userRole === 'broker' || isOpen) && (
                <div className="flex space-x-2">
                    <button
                        onClick={() => handleAction('Adjust')}
                        disabled={submitting}
                        className={`flex-1 p-3 rounded-lg text-white font-semibold transition ${adjustActionColor} ${submitting && action === 'Adjust' ? 'opacity-50' : ''}`}
                    >
                        {submitting && action === 'Adjust' ? 'UPDATING...' : (parsedAddLots > 0 ? 'BUY MORE...' : 'BUY MORE')}
                    </button>

                    {userRole === 'broker' && <button
                        onClick={() => handleAction('Close')}
                        disabled={submitting}
                        className={`flex-1 p-3 rounded-lg text-white font-semibold transition bg-red-500 hover:bg-gray-700 ${submitting && action === 'Close' ? 'opacity-50' : ''}`}
                    >
                        {submitting && action === 'Close' ? 'EXITING...' : 'EXIT'}
                    </button>}
                </div>
            )}
        </div>
    );
}