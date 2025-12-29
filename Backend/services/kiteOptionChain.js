// Backend/services/kiteOptionChain.js
// Option Chain service using Kite instruments database and Quote API

import Instrument from '../Model/InstrumentModel.js';
import { getKiteQuote } from './kiteQuote.js';

/**
 * Index underlying to spot price token mapping
 * These are the INDICES segment tokens for known index underlyings
 */
const INDEX_UNDERLYING_MAP = {
    // NSE Indices
    'NIFTY': { tradingsymbol: 'NIFTY 50', token: '256265', exchange: 'NSE' },
    'BANKNIFTY': { tradingsymbol: 'NIFTY BANK', token: '260105', exchange: 'NSE' },
    'FINNIFTY': { tradingsymbol: 'NIFTY FIN SERVICE', token: '257801', exchange: 'NSE' },
    'MIDCPNIFTY': { tradingsymbol: 'NIFTY MIDCAP 100', token: '256777', exchange: 'NSE' },

    // BSE Indices
    'SENSEX': { tradingsymbol: 'SENSEX', token: '265', exchange: 'BSE' },
    'BANKEX': { tradingsymbol: 'BANKEX', token: '274441', exchange: 'BSE' },
    'SENSEX50': { tradingsymbol: 'SENSEX 50', token: null, exchange: 'BSE' }, // Lookup needed
};

/**
 * Map option segment to the corresponding equity segment for stock underlyings
 */
const OPTION_TO_EQUITY_SEGMENT = {
    'NFO-OPT': 'NSE',
    'NFO-FUT': 'NSE',
    'BFO-OPT': 'BSE',
    'BFO-FUT': 'BSE',
};

/**
 * Map any segment to its corresponding OPTION segment
 * This is used when a user clicks on a FUT and wants to see the option chain
 */
const SEGMENT_TO_OPTION_SEGMENT = {
    'NFO-OPT': 'NFO-OPT',
    'NFO-FUT': 'NFO-OPT',
    'BFO-OPT': 'BFO-OPT',
    'BFO-FUT': 'BFO-OPT',
    'MCX-OPT': 'MCX-OPT',
    'MCX-FUT': 'MCX-OPT',
    'CDS-OPT': 'CDS-OPT',
    'CDS-FUT': 'CDS-OPT',
};

/**
 * Normalize segment to option segment
 * e.g., NFO-FUT -> NFO-OPT, BFO-FUT -> BFO-OPT
 */
export function normalizeToOptionSegment(segment) {
    return SEGMENT_TO_OPTION_SEGMENT[segment] || 'NFO-OPT';
}

/**
 * Get spot price for an underlying
 * Handles indices, stocks, and MCX commodities
 *
 * @param {string} underlyingName - e.g., "NIFTY", "HDFCBANK", "GOLD"
 * @param {string} segment - e.g., "NFO-OPT", "BFO-OPT", "MCX-OPT"
 * @returns {Promise<number|null>} Spot price or null if not found
 */
export async function getSpotPrice(underlyingName, segment) {
    try {
        // 1. Check if it's a known INDEX
        const indexInfo = INDEX_UNDERLYING_MAP[underlyingName];
        if (indexInfo && indexInfo.token) {
            console.log(`[KiteOptionChain] Getting spot for index: ${underlyingName} -> token ${indexInfo.token}`);
            const quote = await getKiteQuote([indexInfo.token]);
            return quote?.[indexInfo.token]?.last_price || null;
        }

        // 2. For STOCK OPTIONS (NFO-OPT/BFO-OPT), get equity price
        const equitySegment = OPTION_TO_EQUITY_SEGMENT[segment];
        if (equitySegment) {
            console.log(`[KiteOptionChain] Getting spot for stock: ${underlyingName} in ${equitySegment}`);
            const stock = await Instrument.findOne({
                tradingsymbol: underlyingName,
                segment: equitySegment
            }).lean();

            if (stock) {
                const quote = await getKiteQuote([stock.instrument_token]);
                return quote?.[stock.instrument_token]?.last_price || null;
            }
        }

        // 3. For MCX (Commodities) - use near month future as spot reference
        if (segment && segment.startsWith('MCX')) {
            console.log(`[KiteOptionChain] Getting spot for MCX: ${underlyingName} from near month future`);
            const nearFuture = await Instrument.findOne({
                name: underlyingName,
                segment: 'MCX-FUT',
                expiry: { $gte: new Date() }
            }).sort({ expiry: 1 }).lean();

            if (nearFuture) {
                const quote = await getKiteQuote([nearFuture.instrument_token]);
                return quote?.[nearFuture.instrument_token]?.last_price || null;
            }
        }

        console.warn(`[KiteOptionChain] Could not find spot price for: ${underlyingName} (${segment})`);
        return null;

    } catch (error) {
        console.error('[KiteOptionChain] Error getting spot price:', error.message);
        return null;
    }
}

/**
 * Get spot instrument info for an underlying
 * Handles indices, stocks, and MCX commodities
 *
 * @param {string} underlyingName - e.g., "NIFTY", "HDFCBANK", "GOLD"
 * @param {string} segment - e.g., "NFO-OPT", "BFO-OPT", "MCX-OPT"
 * @returns {Promise<Object|null>} Spot instrument info or null if not found
 */
export async function getSpotInstrumentInfo(underlyingName, segment) {
    try {
        // 1. Check if it's a known INDEX
        const indexInfo = INDEX_UNDERLYING_MAP[underlyingName];
        if (indexInfo && indexInfo.token) {
            console.log(`[KiteOptionChain] Getting spot instrument for index: ${underlyingName} -> token ${indexInfo.token}`);
            return {
                token: indexInfo.token,
                type: 'index',
                tradingsymbol: indexInfo.tradingsymbol,
                exchange: indexInfo.exchange
            };
        }

        // 2. For STOCK OPTIONS (NFO-OPT/BFO-OPT), get equity instrument info
        const equitySegment = OPTION_TO_EQUITY_SEGMENT[segment];
        if (equitySegment) {
            console.log(`[KiteOptionChain] Getting spot instrument for stock: ${underlyingName} in ${equitySegment}`);
            const stock = await Instrument.findOne({
                tradingsymbol: underlyingName,
                segment: equitySegment
            }).lean();

            if (stock) {
                return {
                    token: stock.instrument_token,
                    type: 'stock',
                    tradingsymbol: stock.tradingsymbol,
                    exchange: stock.exchange,
                    lot_size: stock.lot_size
                };
            }
        }

        // 3. For MCX (Commodities) - use near month future as spot reference
        if (segment && segment.startsWith('MCX')) {
            console.log(`[KiteOptionChain] Getting spot instrument for MCX: ${underlyingName} from near month future`);
            const nearFuture = await Instrument.findOne({
                name: underlyingName,
                segment: 'MCX-FUT',
                expiry: { $gte: new Date() }
            }).sort({ expiry: 1 }).lean();

            if (nearFuture) {
                return {
                    token: nearFuture.instrument_token,
                    type: 'commodity_future',
                    tradingsymbol: nearFuture.tradingsymbol,
                    exchange: nearFuture.exchange,
                    lot_size: nearFuture.lot_size
                };
            }
        }

        console.warn(`[KiteOptionChain] Could not find spot instrument for: ${underlyingName} (${segment})`);
        return null;

    } catch (error) {
        console.error('[KiteOptionChain] Error getting spot instrument info:', error.message);
        return null;
    }
}

/**
 * Get list of available expiry dates for an underlying
 * 
 * @param {string} underlyingName - e.g., "NIFTY", "HDFCBANK", "AXIS BANK"
 * @param {string} segment - e.g., "NFO-OPT", "BFO-OPT", "MCX-OPT"
 * @returns {Promise<string[]>} Array of expiry dates in YYYY-MM-DD format
 */
export async function getExpiryList(underlyingName, segment = 'NFO-OPT') {
    try {
        console.log(`[KiteOptionChain] Getting expiries for: ${underlyingName} (${segment})`);

        let expiries = await Instrument.distinct('expiry', {
            name: underlyingName,
            segment: segment,
            expiry: { $gte: new Date() }
        });

        // Fallback: For equity options (NFO-OPT/BFO-OPT), if no results found,
        // try searching with the equity's tradingsymbol (handles names with spaces)
        if ((!expiries || expiries.length === 0) && (segment === 'NFO-OPT' || segment === 'BFO-OPT')) {
            console.log(`[KiteOptionChain] No expiries found with name="${underlyingName}", trying tradingsymbol fallback...`);
            
            // Get the equity segment for lookup
            const equitySegment = OPTION_TO_EQUITY_SEGMENT[segment];
            if (equitySegment) {
                // Look up the equity instrument to get its tradingsymbol
                const equityInstrument = await Instrument.findOne({
                    name: underlyingName,
                    segment: equitySegment
                }).lean();

                if (equityInstrument && equityInstrument.tradingsymbol) {
                    console.log(`[KiteOptionChain] Found equity tradingsymbol: ${equityInstrument.tradingsymbol}, retrying...`);
                    
                    // Retry with tradingsymbol
                    expiries = await Instrument.distinct('expiry', {
                        name: equityInstrument.tradingsymbol,
                        segment: segment,
                        expiry: { $gte: new Date() }
                    });
                }
            }
        }

        if (!expiries || expiries.length === 0) {
            console.warn(`[KiteOptionChain] No expiries found for ${underlyingName}`);
            return [];
        }

        // Sort by date and format as YYYY-MM-DD
        const sortedExpiries = expiries
            .map(e => new Date(e))
            .sort((a, b) => a - b)
            .map(e => e.toISOString().split('T')[0]);

        console.log(`[KiteOptionChain] Found ${sortedExpiries.length} expiries`);
        return sortedExpiries;

    } catch (error) {
        console.error('[KiteOptionChain] Error getting expiry list:', error.message);
        return [];
    }
}

/**
 * Get nearest expiry date from a list of expiries
 * 
 * @param {string[]} expiries - Array of expiry dates
 * @returns {string|null} Nearest expiry in YYYY-MM-DD format
 */
export function getNearestExpiry(expiries) {
    if (!expiries || expiries.length === 0) return null;
    return expiries[0]; // Already sorted, first is nearest
}

/**
 * Build option chain data for an underlying and expiry
 * 
 * @param {string} underlyingName - e.g., "NIFTY", "HDFCBANK"
 * @param {string} segment - e.g., "NFO-OPT", "BFO-OPT"
 * @param {string} expiry - Expiry date in YYYY-MM-DD format
 * @returns {Promise<Object>} Option chain data with spotPrice and chain array
 */
export async function getOptionChain(underlyingName, segment = 'NFO-OPT', expiry) {
    try {
        console.log(`[KiteOptionChain] Building chain for: ${underlyingName} (${segment}) expiry: ${expiry}`);

        // Parse expiry date for range query (to handle timezone differences)
        const expiryDate = new Date(expiry);
        const expiryStart = new Date(expiryDate);
        expiryStart.setHours(0, 0, 0, 0);
        const expiryEnd = new Date(expiryDate);
        expiryEnd.setHours(23, 59, 59, 999);

        // Query all options for this underlying and expiry
        let options = await Instrument.find({
            name: underlyingName,
            segment: segment,
            expiry: { $gte: expiryStart, $lte: expiryEnd },
            instrument_type: { $in: ['CE', 'PE'] }
        }).lean();

        // Fallback: For equity options (NFO-OPT/BFO-OPT), if no results found,
        // try searching with the equity's tradingsymbol (handles names with spaces)
        if ((!options || options.length === 0) && (segment === 'NFO-OPT' || segment === 'BFO-OPT')) {
            console.log(`[KiteOptionChain] No options found with name="${underlyingName}", trying tradingsymbol fallback...`);
            
            // Get the equity segment for lookup
            const equitySegment = OPTION_TO_EQUITY_SEGMENT[segment];
            if (equitySegment) {
                // Look up the equity instrument to get its tradingsymbol
                const equityInstrument = await Instrument.findOne({
                    name: underlyingName,
                    segment: equitySegment
                }).lean();

                if (equityInstrument && equityInstrument.tradingsymbol) {
                    console.log(`[KiteOptionChain] Found equity tradingsymbol: ${equityInstrument.tradingsymbol}, retrying...`);
                    
                    // Retry with tradingsymbol
                    options = await Instrument.find({
                        name: equityInstrument.tradingsymbol,
                        segment: segment,
                        expiry: { $gte: expiryStart, $lte: expiryEnd },
                        instrument_type: { $in: ['CE', 'PE'] }
                    }).lean();
                }
            }
        }

        if (!options || options.length === 0) {
            console.warn(`[KiteOptionChain] No options found for ${underlyingName} ${expiry}`);
            return { chain: [], spotPrice: null, totalStrikes: 0 };
        }

        console.log(`[KiteOptionChain] Found ${options.length} option contracts`);

        // Group by strike price
        const strikeMap = new Map();

        for (const opt of options) {
            const strike = opt.strike;
            if (!strikeMap.has(strike)) {
                strikeMap.set(strike, { strike, call: null, put: null });
            }

            const row = strikeMap.get(strike);
            const optionData = {
                instrument_token: opt.instrument_token,
                tradingsymbol: opt.tradingsymbol,
                lot_size: opt.lot_size,
                tick_size: opt.tick_size,
                ltp: 0, // Will be populated by frontend via WebSocket
                oi: 0,
                volume: 0,
            };

            if (opt.instrument_type === 'CE') {
                row.call = optionData;
            } else if (opt.instrument_type === 'PE') {
                row.put = optionData;
            }
        }

        // Convert map to sorted array
        const chain = Array.from(strikeMap.values())
            .sort((a, b) => a.strike - b.strike);

        // Get spot instrument info
        const spotInstrumentInfo = await getSpotInstrumentInfo(underlyingName, segment);

        console.log(`[KiteOptionChain] Built chain with ${chain.length} strikes, spot instrument:`, spotInstrumentInfo);

        return {
            chain,
            spotInstrumentInfo,
            totalStrikes: chain.length
        };

    } catch (error) {
        console.error('[KiteOptionChain] Error building option chain:', error.message);
        throw error;
    }
}

/**
 * Determine the option segment for a given underlying
 * 
 * @param {string} underlyingName - e.g., "NIFTY", "SENSEX", "GOLD"
 * @returns {string} Option segment e.g., "NFO-OPT", "BFO-OPT", "MCX-OPT"
 */
export function getOptionSegment(underlyingName) {
    // BSE indices
    if (['SENSEX', 'BANKEX', 'SENSEX50'].includes(underlyingName)) {
        return 'BFO-OPT';
    }

    // MCX commodities
    const mcxUnderlyings = ['GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'CRUDEOIL', 'CRUDEOILM',
        'NATURALGAS', 'NATGASMINI', 'COPPER', 'ZINC'];
    if (mcxUnderlyings.includes(underlyingName)) {
        return 'MCX-OPT';
    }

    // Default to NFO (NSE F&O)
    return 'NFO-OPT';
}
