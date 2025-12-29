// Controllers/optionChainController.js
// Option Chain Controller - Uses Kite instruments database and Quote API

import {
    getExpiryList as kiteGetExpiryList,
    getNearestExpiry,
    getOptionChain as kiteGetOptionChain,
    getOptionSegment,
    normalizeToOptionSegment
} from '../services/kiteOptionChain.js';
import Instrument from '../Model/InstrumentModel.js';

/**
 * Get option chain data
 * Query params:
 *   - name: Underlying name (e.g., "NIFTY", "HDFCBANK", "GOLD")
 *   - segment: Option segment (optional, auto-detected)
 *   - expiry: Expiry date in YYYY-MM-DD format (optional, defaults to nearest)
 */
async function getOptionChain(req, res) {
    try {
        const { name, segment, expiry } = req.query;

        // Validate required parameters
        if (!name) {
            return res.status(400).json({
                error: 'Missing required parameter',
                details: 'name is required (e.g., NIFTY, BANKNIFTY, HDFCBANK)'
            });
        }

        const underlyingName = name.toUpperCase();
        console.log('[OptionChainController] Request:', { underlyingName, segment, expiry });

        // Determine option segment - normalize FUT to OPT if needed
        // e.g., NFO-FUT -> NFO-OPT, BFO-FUT -> BFO-OPT
        const optionSegment = segment
            ? normalizeToOptionSegment(segment)
            : getOptionSegment(underlyingName);
        console.log('[OptionChainController] Using segment:', optionSegment, '(input was:', segment, ')');

        // If no expiry provided, get earliest available
        let targetExpiry = expiry;
        if (!targetExpiry) {
            const expiries = await kiteGetExpiryList(underlyingName, optionSegment);
            targetExpiry = getNearestExpiry(expiries);

            if (!targetExpiry) {
                return res.status(404).json({
                    error: 'No active expiries found',
                    details: `No future expiry dates found for ${underlyingName} in ${optionSegment}`
                });
            }
            console.log('[OptionChainController] Using nearest expiry:', targetExpiry);
        }

        // Build option chain
        const optionChainData = await kiteGetOptionChain(underlyingName, optionSegment, targetExpiry);

        if (!optionChainData.chain || optionChainData.chain.length === 0) {
            return res.status(404).json({
                error: 'No option chain data found',
                details: `No options found for ${underlyingName} expiry ${targetExpiry}`
            });
        }

        console.log('[OptionChainController] Success:', {
            totalStrikes: optionChainData.totalStrikes,
            spotInstrumentInfo: optionChainData.spotInstrumentInfo
        });

        // Return response (same format as before for frontend compatibility)
        return res.json({
            ok: true,
            data: {
                underlying: underlyingName,
                segment: optionSegment,
                expiry: targetExpiry,
                spotInstrumentInfo: optionChainData.spotInstrumentInfo,
                chain: optionChainData.chain,
                meta: {
                    totalStrikes: optionChainData.totalStrikes,
                    timestamp: new Date().toISOString()
                }
            }
        });

    } catch (error) {
        console.error('[OptionChainController] Error:', error);
        return res.status(500).json({
            error: 'Failed to fetch option chain',
            details: error.message,
            hint: 'Please check if the instrument has active option contracts'
        });
    }
}

/**
 * Get list of available expiry dates for an underlying
 * Query params:
 *   - name: Underlying name (e.g., "NIFTY", "HDFCBANK")
 *   - segment: Option segment (optional)
 */
async function getExpiryList(req, res) {
    try {
        const { name, segment } = req.query;

        if (!name) {
            return res.status(400).json({
                error: 'Missing required parameter',
                details: 'name is required'
            });
        }

        const underlyingName = name.toUpperCase();
        const optionSegment = segment
            ? normalizeToOptionSegment(segment)
            : getOptionSegment(underlyingName);

        console.log('[ExpiryListController] Request:', { underlyingName, optionSegment, inputSegment: segment });

        const expiries = await kiteGetExpiryList(underlyingName, optionSegment);
        const nearestExpiry = getNearestExpiry(expiries);

        console.log('[ExpiryListController] Found', expiries.length, 'expiries');

        return res.json({
            ok: true,
            data: {
                expiries,
                nearest: nearestExpiry,
                count: expiries.length
            }
        });

    } catch (error) {
        console.error('[ExpiryListController] Error:', error);
        return res.status(500).json({
            error: 'Failed to fetch expiry list',
            details: error.message
        });
    }
}

/**
 * Lookup the instrument_token for an option contract
 * Query params:
 *   - name: Underlying name (e.g., "NIFTY", "HDFCBANK")
 *   - strike: Strike price (number)
 *   - optionType: "CE" or "PE"
 *   - expiry: Expiry date in YYYY-MM-DD format
 */
async function getOptionSecurityId(req, res) {
    try {
        const { name, strike, optionType, expiry } = req.query;

        if (!name || !strike || !optionType || !expiry) {
            return res.status(400).json({
                error: 'Missing required parameters',
                details: 'name, strike, optionType, and expiry are required'
            });
        }

        const underlyingName = name.toUpperCase();
        const optionSegment = getOptionSegment(underlyingName);

        console.log('[getOptionSecurityId] Looking up:', { underlyingName, strike, optionType, expiry });

        // Parse expiry date for range query
        const expiryDate = new Date(expiry);
        const expiryStart = new Date(expiryDate);
        expiryStart.setHours(0, 0, 0, 0);
        const expiryEnd = new Date(expiryDate);
        expiryEnd.setHours(23, 59, 59, 999);

        // Find the option contract
        const instrument = await Instrument.findOne({
            name: underlyingName,
            strike: Number(strike),
            instrument_type: optionType.toUpperCase(),
            expiry: { $gte: expiryStart, $lte: expiryEnd },
            segment: optionSegment
        }).lean();

        if (!instrument) {
            console.log('[getOptionSecurityId] No instrument found');
            return res.status(404).json({
                error: 'Option contract not found',
                details: `No option found for ${underlyingName} ${strike} ${optionType} expiring ${expiry}`
            });
        }

        console.log('[getOptionSecurityId] Found:', instrument.tradingsymbol);

        return res.json({
            ok: true,
            data: {
                instrument_token: instrument.instrument_token,
                tradingsymbol: instrument.tradingsymbol,
                segment: instrument.segment,
                lot_size: instrument.lot_size,
                tick_size: instrument.tick_size
            }
        });

    } catch (error) {
        console.error('[getOptionSecurityId] Error:', error);
        return res.status(500).json({
            error: 'Failed to lookup option',
            details: error.message
        });
    }
}

export { getOptionChain, getExpiryList, getOptionSecurityId };
