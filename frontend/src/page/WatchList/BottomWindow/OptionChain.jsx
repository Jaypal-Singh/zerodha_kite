// OptionChainView.jsx - Clean ATM-Centered Option Chain with Live WebSocket Updates
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TrendingDown, Loader, RefreshCw, AlertCircle } from 'lucide-react';
import { useOptionChain } from '../../../hooks/useOptionChain';

// Strike count options
const STRIKE_OPTIONS = [
    { label: '6', value: 6 },
    { label: '12', value: 12 },
    { label: '18', value: 18 },
];

const OptionChainView = ({ selectedStock, sheetData }) => {
    const [selectedExpiry, setSelectedExpiry] = useState(null);
    const [strikeCount, setStrikeCount] = useState(6); // Default to 6 for compact view
    const [lastUpdateTime, setLastUpdateTime] = useState(null);
    const updateCountRef = useRef(0);

    const {
        chainData,
        spotPrice,
        expiries,
        loading,
        error,
        refetch
    } = useOptionChain({
        name: selectedStock?.name,
        segment: selectedStock?.segment,
        expiry: selectedExpiry
    });

    // Use live spot price from hook, fallback to sheetData
    const currentPrice = spotPrice || sheetData?.ltp || 0;

    // Update timestamp when chain data changes (live WebSocket updates)
    useEffect(() => {
        if (chainData) {
            setLastUpdateTime(new Date());
            updateCountRef.current += 1;
        }
    }, [chainData]);

    // Find ATM strike and filter data around it
    const { filteredChain, atmStrike } = useMemo(() => {
        if (!chainData || chainData.length === 0 || !currentPrice) {
            return { filteredChain: [], atmStrike: null };
        }

        // Find ATM strike (closest to spot price)
        let closestStrike = chainData[0]?.strike;
        let minDiff = Math.abs(chainData[0]?.strike - currentPrice);

        chainData.forEach(row => {
            const diff = Math.abs(row.strike - currentPrice);
            if (diff < minDiff) {
                minDiff = diff;
                closestStrike = row.strike;
            }
        });

        // Find index of ATM strike
        const atmIndex = chainData.findIndex(row => row.strike === closestStrike);

        // Calculate strikes above and below based on selected count
        const strikesPerSide = Math.floor((strikeCount - 1) / 2);
        let strikesAbove = strikesPerSide;
        let strikesBelow = strikesPerSide;

        // Adjust if we don't have enough strikes on one side
        const availableAbove = atmIndex;
        const availableBelow = chainData.length - atmIndex - 1;

        if (availableAbove < strikesAbove) {
            strikesAbove = availableAbove;
            strikesBelow = Math.min(availableBelow, strikeCount - strikesAbove - 1);
        }
        if (availableBelow < strikesBelow) {
            strikesBelow = availableBelow;
            strikesAbove = Math.min(availableAbove, strikeCount - strikesBelow - 1);
        }

        // Slice the data
        const startIndex = Math.max(0, atmIndex - strikesAbove);
        const endIndex = Math.min(chainData.length, atmIndex + strikesBelow + 1);

        return {
            filteredChain: chainData.slice(startIndex, endIndex),
            atmStrike: closestStrike
        };
    }, [chainData, currentPrice, strikeCount]);

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Loader className="w-6 h-6 inline animate-spin text-indigo-400 mb-2" />
                    <p className="text-gray-400 text-xs">Loading...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <AlertCircle className="w-6 h-6 inline text-red-400 mb-2" />
                    <p className="text-red-400 text-xs mb-2">{error}</p>
                    <button
                        onClick={refetch}
                        className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // No data state
    if (!filteredChain || filteredChain.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-400">
                    <TrendingDown className="w-6 h-6 inline mb-2 opacity-50" />
                    <p className="text-xs">No option chain data available</p>
                </div>
            </div>
        );
    }

    // Format expiry date
    const formatExpiry = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    };

    const formatLTP = (value) => {
        if (value === undefined || value === null) return '—';
        return Number(value).toFixed(2);
    };

    return (
        <div className="w-full h-full flex flex-col text-white">

            {/* Compact Header - Fixed */}
            <div className="bg-[#1A1F30] px-3 py-2 flex justify-between items-center text-xs flex-shrink-0 border-b border-white/10">
                {/* Left: Expiry + Strike Filter */}
                <div className="flex items-center gap-2">
                    {expiries.length > 0 && (
                        <select
                            value={selectedExpiry || expiries[0]}
                            onChange={(e) => setSelectedExpiry(e.target.value)}
                            className="bg-[#252B3B] text-white px-2 py-1 rounded text-xs focus:outline-none border border-white/10"
                        >
                            {expiries.map(exp => (
                                <option key={exp} value={exp}>{formatExpiry(exp)}</option>
                            ))}
                        </select>
                    )}
                    <select
                        value={strikeCount}
                        onChange={(e) => setStrikeCount(Number(e.target.value))}
                        className="bg-[#252B3B] text-white px-2 py-1 rounded text-xs focus:outline-none border border-white/10"
                    >
                        {STRIKE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                {/* Right: Spot Price + Live Indicator + Refresh */}
                <div className="flex items-center gap-2">
                    <span className="text-yellow-400 font-semibold">₹{Number(currentPrice).toFixed(2)}</span>
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    <button
                        onClick={() => { refetch(); setLastUpdateTime(new Date()); }}
                        className="p-1 hover:bg-white/10 rounded transition"
                        title="Refresh"
                    >
                        <RefreshCw className="w-3 h-3 text-gray-400 hover:text-white" />
                    </button>
                </div>
            </div>

            {/* Table Header - Fixed */}
            <div className="bg-[#252B3B] flex-shrink-0">
                <div className="grid grid-cols-3">
                    <div className="py-2 px-4 text-center text-green-400 font-medium text-xs uppercase tracking-wide">
                        Call LTP
                    </div>
                    <div className="py-2 px-4 text-center text-gray-400 font-medium text-xs uppercase tracking-wide border-x border-white/10">
                        Strike
                    </div>
                    <div className="py-2 px-4 text-center text-red-400 font-medium text-xs uppercase tracking-wide">
                        Put LTP
                    </div>
                </div>
            </div>

            {/* Table Body - Scrollable */}
            <div className="flex-1 overflow-y-auto">
                {filteredChain.map((row) => {
                    const isATM = row.strike === atmStrike;

                    return (
                        <div
                            key={row.strike}
                            className={`
                                grid grid-cols-3 border-b border-white/5 transition-colors
                                ${isATM
                                    ? 'bg-yellow-500/10 border-yellow-500/30'
                                    : 'hover:bg-white/5'
                                }
                            `}
                        >
                            {/* Call LTP */}
                            <div className="py-2.5 px-4 text-center">
                                <span className={`font-mono ${isATM ? 'text-green-300 font-semibold' : 'text-green-400'}`}>
                                    {formatLTP(row.call?.ltp)}
                                </span>
                            </div>

                            {/* Strike Price */}
                            <div className={`
                                py-2.5 px-4 text-center font-bold border-x border-white/10
                                ${isATM
                                    ? 'bg-yellow-500/20 text-yellow-300'
                                    : 'bg-[#1E2430] text-white'
                                }
                            `}>
                                {row.strike}
                            </div>

                            {/* Put LTP */}
                            <div className="py-2.5 px-4 text-center">
                                <span className={`font-mono ${isATM ? 'text-red-300 font-semibold' : 'text-red-400'}`}>
                                    {formatLTP(row.put?.ltp)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

        </div>
    );
}

export default OptionChainView;