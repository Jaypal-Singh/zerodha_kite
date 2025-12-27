// services/kiteQuote.js
// Kite Connect Quote API service
// Fetches LTP, OHLC, and depth data using Kite's Quote API

import KiteCredential from '../Model/KiteCredentialModel.js';

const BASE_URL = 'https://api.kite.trade';

/**
 * Get active Kite credentials from database
 */
async function getKiteCredentials() {
    const credential = await KiteCredential.findOne({ is_active: true }).lean();

    if (!credential || !credential.api_key || !credential.access_token) {
        throw new Error('No active Kite credentials found. Please login first.');
    }

    return {
        api_key: credential.api_key,
        access_token: credential.access_token
    };
}

/**
 * Fetch quote data for one or more instruments
 * 
 * @param {string[]} instrumentTokens - Array of instrument tokens
 * @returns {Promise<Object>} Object keyed by token with quote data
 * 
 * Example response:
 * {
 *   "256265": { last_price: 24850.50, ohlc: {...}, depth: {...}, ... }
 * }
 */
export async function getKiteQuote(instrumentTokens) {
    if (!instrumentTokens || instrumentTokens.length === 0) {
        return {};
    }

    try {
        const { api_key, access_token } = await getKiteCredentials();

        // Build instrument list for Kite API
        // Kite expects format like: NSE:NIFTY 50, NFO:NIFTY24DECFUT
        // But for tokens, we use: i=256265&i=260105
        const tokenParams = instrumentTokens.map(t => `i=${t}`).join('&');

        const url = `${BASE_URL}/quote?${tokenParams}`;

        console.log(`[KiteQuote] Fetching quotes for ${instrumentTokens.length} tokens`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Kite-Version': '3',
                'Authorization': `token ${api_key}:${access_token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[KiteQuote] API Error:', response.status, errorText);

            if (response.status === 403) {
                throw new Error('Access token expired. Please login again.');
            }
            throw new Error(`Kite Quote API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch quotes');
        }

        // Transform response - Kite returns {data: {token: quote, ...}}
        // We want to return {token: quote, ...}
        return data.data || {};

    } catch (error) {
        console.error('[KiteQuote] Error:', error.message);
        throw error;
    }
}

/**
 * Fetch LTP (Last Traded Price) only for instruments
 * More efficient than full quote
 * 
 * @param {string[]} instrumentTokens - Array of instrument tokens
 * @returns {Promise<Object>} Object keyed by token with LTP data
 */
export async function getKiteLTP(instrumentTokens) {
    if (!instrumentTokens || instrumentTokens.length === 0) {
        return {};
    }

    try {
        const { api_key, access_token } = await getKiteCredentials();

        const tokenParams = instrumentTokens.map(t => `i=${t}`).join('&');
        const url = `${BASE_URL}/quote/ltp?${tokenParams}`;

        console.log(`[KiteQuote] Fetching LTP for ${instrumentTokens.length} tokens`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Kite-Version': '3',
                'Authorization': `token ${api_key}:${access_token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[KiteQuote] LTP API Error:', response.status, errorText);
            throw new Error(`Kite LTP API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch LTP');
        }

        return data.data || {};

    } catch (error) {
        console.error('[KiteQuote] Error:', error.message);
        throw error;
    }
}

/**
 * Fetch OHLC data for instruments
 * 
 * @param {string[]} instrumentTokens - Array of instrument tokens
 * @returns {Promise<Object>} Object keyed by token with OHLC data
 */
export async function getKiteOHLC(instrumentTokens) {
    if (!instrumentTokens || instrumentTokens.length === 0) {
        return {};
    }

    try {
        const { api_key, access_token } = await getKiteCredentials();

        const tokenParams = instrumentTokens.map(t => `i=${t}`).join('&');
        const url = `${BASE_URL}/quote/ohlc?${tokenParams}`;

        console.log(`[KiteQuote] Fetching OHLC for ${instrumentTokens.length} tokens`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Kite-Version': '3',
                'Authorization': `token ${api_key}:${access_token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[KiteQuote] OHLC API Error:', response.status, errorText);
            throw new Error(`Kite OHLC API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch OHLC');
        }

        return data.data || {};

    } catch (error) {
        console.error('[KiteQuote] Error:', error.message);
        throw error;
    }
}

export default {
    getKiteQuote,
    getKiteLTP,
    getKiteOHLC
};
