// ClosedOrder.jsx
import React, { useEffect, useState } from "react";
import { ShoppingCart, DollarSign, Hash, Zap, XCircle, Clock, Layers, RefreshCw } from 'lucide-react';
import ClosedOrderFilter from "./CloseOrderFilter"; // Ensure this path is correct
import { logMarketStatus } from '../../../Utils/marketStatus.js';
import { calculateExitBrokerageAndPnL } from "../../../Utils/calculateBrokerage.jsx";

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

// --- Helper to ensure consistent math everywhere ---
const getOrderValues = (order) => {
    const qty = parseFloat(order.quantity) || 0;

    // Priority: average_price -> price
    let entryPrice = parseFloat(order.average_price);
    if (!entryPrice) entryPrice = parseFloat(order.price) || 0;

    // Exit: closed_ltp -> ltp
    let exitPrice = parseFloat(order.closed_ltp);
    if (!exitPrice) exitPrice = parseFloat(order.ltp) || 0;

    return { qty, entryPrice, exitPrice };
};

// --- Internal Component: DetailRow (Safe Icon Rendering) ---
const DetailRow = ({ Icon, label, value, colorClass }) => (
    <div className="flex justify-between items-center py-0.5 px-2">
        <div className="flex items-center text-[var(--text-secondary)]">
            {Icon && <Icon className="w-3 h-3 mr-2" />}
            <span className="text-xs">{label}</span>
        </div>
        <span className={`text-sm font-medium ${colorClass || "text-[var(--text-primary)]"}`}>
            {value}
        </span>
    </div>
);

// --- Internal Component: ClosedOrderBottomWindow ---
const ClosedOrderBottomWindow = ({ selectedOrder, onClose }) => {
    if (!selectedOrder) return null;
    console.log(selectedOrder);

    // 1. Get User Role for Permissions
    const userString = localStorage.getItem('loggedInUser');
    const userObject = userString ? JSON.parse(userString) : {};
    const userRole = userObject.role; // 'broker' or 'customer'
    const isOpen = logMarketStatus();

    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState(null);

    // For option chain orders, expiry is in meta.expiry
    // For regular orders, expiry is in meta.selectedStock.expiry
    const expireDate = selectedOrder.meta?.expiry || selectedOrder.meta?.selectedStock?.expiry;
    const date = expireDate ? new Date(expireDate) : null;
    const formattedStockExpireDate = date ? (
        String(date.getDate()).padStart(2, '0') + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        date.getFullYear()
    ) : "—";

    const {
        symbol, side, product, lots, lot_size, closed_at,
        _id: orderId, instrument_token, segment, quantity, price, came_From
    } = selectedOrder;

    const tradingsymbol = selectedOrder.meta?.selectedStock?.tradingSymbol ?? symbol ?? "N/A";
    const orderSide = String(side ?? "").toUpperCase();
    const productType = product === 'MIS' ? 'Intraday' : 'Overnight';

    const { qty, entryPrice, exitPrice } = getOrderValues(selectedOrder);

    // 🔹 EXIT P&L + FULL BROKERAGE (entry + exit) helper se
    const {
        entryValue,
        exitValue,
        brokerageEntry,
        brokerageExit,
        totalBrokerage,
        grossPnl,
        netPnl,
        pct
    } = calculateExitBrokerageAndPnL({
        side: orderSide,
        avgPrice: entryPrice,
        exitPrice,
        qty
    });

    const isZero = Math.abs(netPnl) < 0.01;
    const profit = netPnl > 0;

    let pnlColor = "text-gray-200";
    if (!isZero) {
        pnlColor = profit ? "text-green-400" : "text-red-400";
    }

    const closedTime = closed_at ? (() => {
        const d = new Date(closed_at);
        const datePart = String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear();
        const timePart = d.toLocaleTimeString();
        return `${datePart}, ${timePart}`;
    })() : "—";

    // --- REOPEN LOGIC ---
    const handleReopen = async () => {
        setSubmitting(true);
        setFeedback(null);

        try {
            const activeContextString = localStorage.getItem('activeContext');
            const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
            const brokerId = activeContext.brokerId;
            const customerId = activeContext.customerId;
            const token = localStorage.getItem("token") || null;
            const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";
            const endpoint = `${apiBase}/api/orders/updateOrder`;

            const payload = {
                broker_id_str: brokerId,
                customer_id_str: customerId,
                order_id: orderId,
                instrument_token: instrument_token,
                symbol: tradingsymbol,
                side: orderSide,
                product: product,
                segment: segment,
                lots: String(lots),
                quantity: Number(quantity),
                price: Number(price),
                order_status: "OPEN", // Reopening
                meta: { from: 'ui_closed_order_reopen' }
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });

            let body = null;
            try { body = await res.json(); } catch (e) { body = null; }

            if (!res.ok) throw new Error(body?.message || body?.error || `Server error: ${res.status}`);
            if (body && body.success === false) throw new Error(body.message || 'Server returned failure');

            setFeedback({ type: 'success', message: 'Order Reopened Successfully!' });

            // Notify app
            try { window.dispatchEvent(new CustomEvent('orders:changed', { detail: { order: body?.order } })); } catch (e) { }

            setTimeout(() => { onClose(); }, 1000);

        } catch (err) {
            console.error("Reopen error:", err);
            setFeedback({ type: 'error', message: `Failed to reopen: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="open-order-bottom-window fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-card)] border-t border-[var(--border-color)] shadow-2xl p-4 transition-transform duration-300">
            {/* Header */}
            <div className="flex justify-between items-start mb-3 border-b border-[var(--border-color)] pb-2">
                <h3 className="text-xl text-[var(--text-primary)] font-bold tracking-wide">
                    {tradingsymbol} ({orderSide})
                </h3>
                <button onClick={onClose} className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
                    <XCircle className="w-6 h-6" />
                </button>
            </div>

            {/* Feedback */}
            {feedback && (
                <div className={`p-2 mb-3 rounded-md text-sm ${feedback.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                    {feedback.message}
                </div>
            )}

            {/* P&L Display */}
            <div className="mb-4 flex justify-between items-end">
                <div>
                    <p className="text-xl font-bold">
                        <span className="text-[var(--text-secondary)] mr-1">₹</span>
                        <span className={pnlColor}>{exitPrice.toFixed(2)}</span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">Exit Price</p>
                </div>
                <div className="text-right">
                    <p className={`text-xl font-bold ${pnlColor}`}>{money(netPnl)}</p>
                    <p className="text-xs text-[var(--text-muted)]">Realized P&L (After Brokerage)</p>
                </div>
            </div>

            {/* Brokerage Breakdown */}
            <div className="mb-2 p-2 bg-[var(--bg-secondary)] rounded-md text-[11px]">
                <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Gross P&L</span>
                    <span>{money(grossPnl)}</span>
                </div>
                <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Entry Brokerage 0.01%</span>
                    <span className="text-red-400">-{money(brokerageEntry)}</span>
                </div>
                <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Exit Brokerage 0.01%</span>
                    <span className="text-red-400">-{money(brokerageExit)}</span>
                </div>
                <div className="flex justify-between mt-1 border-t border-[var(--border-color)] pt-1 font-semibold">
                    <span>Net P&L</span>
                    <span className={`${pnlColor}`}>{money(netPnl)} ({pct.toFixed(2)}%)</span>
                </div>
            </div>

            {/* Details Grid (Compact) */}
            <div className="mb-2 p-2 bg-[var(--bg-secondary)] rounded-md text-xs">
                <DetailRow label="Quantity" value={`${qty} shares`} />
                <DetailRow label="Lots (Size)" value={`${lots ?? '-'} (${lot_size ?? '-'})`} />
                <DetailRow label="Entry Price" value={money(entryPrice)} colorClass="text-yellow-300" />
                <DetailRow label="Exit Price" value={money(exitPrice)} colorClass="text-white" />
                <DetailRow label="Type" value={orderSide} colorClass={orderSide === 'BUY' ? "text-green-400" : "text-red-400"} />
                <DetailRow label="Product" value={productType} colorClass="text-indigo-300" />
                <DetailRow label="From" value={came_From} colorClass="text-indigo-300" />
                <DetailRow label="Closed At" value={closedTime} colorClass="text-gray-400 text-xs" />
                <DetailRow label="Expire Date" value={formattedStockExpireDate} colorClass="text-gray-400 text-xs" />
                {selectedOrder.exit_reason && <DetailRow label="exit_reason" value={selectedOrder.exit_reason} colorClass="text-gray-400 text-xs" />}

            </div>

            {/* Actions */}
            <div className="flex space-x-2 mt-4">
                <button
                    onClick={onClose}
                    className="flex-1 p-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] font-semibold hover:bg-[var(--bg-hover)] transition border border-[var(--border-color)]"
                >
                    Close
                </button>

                {/* Condition: Not Hold, Not Overnight AND User is Broker */}
                {((came_From !== 'Hold' && came_From !== 'Overnight' && userRole === 'broker') || isOpen) && (
                    <button
                        onClick={handleReopen}
                        disabled={submitting}
                        className={`flex-1 p-3 rounded-lg font-semibold text-white transition flex items-center justify-center gap-2
                        ${submitting ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'}`}
                    >
                        {submitting ? (
                            <>Processing...</>
                        ) : (
                            <>
                                <RefreshCw className="w-4 h-4" />
                                To Open
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
};


// --- Main Component: ClosedOrder ---

export default function ClosedOrder() {
    const [closedOrders, setClosedOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [loader, setLoader] = useState(true);
    const [error, setError] = useState(null);
    const [selectedOrderData, setSelectedOrderData] = useState(null);

    const activeContextString = localStorage.getItem('activeContext');
    const activeContext = activeContextString ? JSON.parse(activeContextString) : {};
    const brokerId = activeContext.brokerId;
    const customerId = activeContext.customerId;
    const token = localStorage.getItem("token") || null;
    const apiBase = import.meta.env.VITE_REACT_APP_API_URL || "";

    const orderStatus = "CLOSED";

    const handleOrderSelect = (orderData) => {
        setSelectedOrderData(orderData);
    };

    const handleCloseWindow = () => {
        setSelectedOrderData(null);
    };

    const fetchClosedOrders = async () => {
        if (!brokerId || !customerId) {
            setLoader(false);
            return;
        }
        setLoader(true);
        try {
            const endPoint = `${apiBase.replace(/\/$/, "")}/api/orders/getOrderInstrument?broker_id_str=${brokerId}&customer_id_str=${customerId}&orderStatus=${orderStatus}`;
            const res = await fetch(endPoint, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                credentials: "include",
            });

            if (!res.ok) {
                setClosedOrders([]);
                setFilteredOrders([]);
                setError("Failed to load closed orders");
                return;
            }

            const data = await res.json();
            const orders = Array.isArray(data?.ordersInstrument) ? data.ordersInstrument : (Array.isArray(data) ? data : []);
            // Sort by closing time desc
            const sortedOrders = orders.sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

            setClosedOrders(sortedOrders);
            setFilteredOrders(sortedOrders.slice());
            setError(null);
        } catch (err) {
            console.error("fetchClosedOrders exception:", err);
            setClosedOrders([]);
            setFilteredOrders([]);
            setError(String(err));
        } finally {
            setLoader(false);
        }
    };

    useEffect(() => {
        fetchClosedOrders();
        const handler = () => fetchClosedOrders();
        window.addEventListener('orders:changed', handler);
        return () => window.removeEventListener('orders:changed', handler);
    }, [brokerId, customerId, apiBase, token]);

    return (
        <>
            <div className="grid md:grid-cols-[320px_1fr] gap-4">
                {/* Left: Filter Sidebar */}
                <div>
                    <ClosedOrderFilter
                        closedOrders={closedOrders}
                        onFilter={(newList) => setFilteredOrders(newList)}
                    />
                </div>

                {/* Right: Order List */}
                <div>
                    <h3 className="text-[var(--text-secondary)] text-sm mb-2">Closed Orders ({filteredOrders.length})</h3>

                    {loader ? (
                        <div className="flex justify-center items-center py-8">
                            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <div className="text-[var(--text-muted)] text-center py-8 text-sm italic">
                            No closed positions found.
                        </div>
                    ) : (
                        <ul className="space-y-2 pb-29 overflow-auto">
                            {filteredOrders.map((data, idx) => {
                                const tradingsymbolRaw = data?.meta?.selectedStock?.tradingSymbol ?? data?.symbol ?? "";
                                const tradingsymbol = String(tradingsymbolRaw ?? "");

                                const { qty, entryPrice, exitPrice } = getOrderValues(data);
                                const sideUpper = String(data.side ?? "").toUpperCase();

                                const {
                                    grossPnl,
                                    brokerageEntry,
                                    brokerageExit,
                                    totalBrokerage,
                                    netPnl,
                                    pct
                                } = calculateExitBrokerageAndPnL({
                                    side: sideUpper,
                                    avgPrice: entryPrice,
                                    exitPrice,
                                    qty
                                });

                                const isZero = Math.abs(netPnl) < 0.01;
                                const profit = netPnl > 0;

                                let pnlColor = "text-gray-200";
                                if (!isZero) {
                                    pnlColor = profit ? "text-green-400" : "text-red-400";
                                }

                                const pctText = `${profit && !isZero ? '+' : ''}${netPnl.toFixed(2)} (${profit && !isZero ? '+' : ''}${pct.toFixed(2)}%)`;

                                return (
                                    <li
                                        key={data._id || idx}
                                        className="relative bg-[var(--bg-card)] rounded-lg p-3 border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                                        onClick={() => handleOrderSelect(data)}
                                    >
                                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-fuchsia-500/90" />

                                        <div className="flex items-start justify-between">
                                            <h4 className="text-[var(--text-primary)] font-bold tracking-wide text-sm">
                                                {tradingsymbol || '—'}
                                            </h4>
                                            <div className={`text-xs font-bold ${pnlColor}`}>{pctText}</div>
                                        </div>

                                        <div className="mt-1 grid grid-cols-2 gap-y-1 text-[12px]">
                                            {/* Qty and Exit */}
                                            <div className="text-[var(--text-secondary)]">
                                                Qty: <span className="text-[var(--text-primary)]">{qty}</span>
                                            </div>
                                            <div className="text-right text-[var(--text-secondary)]">
                                                Exit: <span className="text-[var(--text-primary)] font-semibold">{money(exitPrice)}</span>
                                            </div>

                                            {/* Lots and Avg */}
                                            <div className="text-[var(--text-secondary)]">
                                                Lots: <span className="text-[var(--text-primary)]">{data.lots ?? '-'}</span>
                                                <span className="text-[var(--text-muted)] ml-1 text-[10px]">({data.lot_size ?? '-'})</span>
                                            </div>
                                            <div className="text-right text-[var(--text-secondary)]">
                                                Avg: <span className="text-[var(--text-primary)]">{money(entryPrice)}</span>
                                            </div>

                                            {/* Total P&L Row */}
                                            <div className="col-span-2 text-right pt-1 mt-1 border-t border-[var(--border-color)]">
                                                <span className="text-[var(--text-secondary)] mr-2">
                                                    Net P&L (After Brokerage):
                                                </span>
                                                <span className={`${pnlColor} font-semibold text-sm`}>{money(netPnl)}</span>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {selectedOrderData && (
                        <ClosedOrderBottomWindow
                            selectedOrder={selectedOrderData}
                            onClose={handleCloseWindow}
                        />
                    )}
                </div>
            </div>
        </>
    );
}
