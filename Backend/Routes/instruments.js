// Routes/instruments.js - KITE VERSION
// Updated to use Kite instrument schema (instrument_token, name, lot_size, etc.)

import { Router } from "express";
import Instrument from "../Model/InstrumentModel.js";
import { getCache, setCache } from "../services/redisCache.js";

const router = Router();

// ==================== SEARCH OPTIMIZATION CACHE ====================
const searchCache = new Map();
const SEARCH_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

const searchAnalytics = new Map();
const ANALYTICS_WINDOW = 60 * 60 * 1000; // 1 hour

function trackSearch(query, category, resultsCount) {
    const key = `${query.toLowerCase()}:${category}`;
    const now = Date.now();
    if (!searchAnalytics.has(key)) {
        searchAnalytics.set(key, { query, category, count: 0, lastSearched: now, avgResults: 0 });
    }
    const stats = searchAnalytics.get(key);
    stats.count++;
    stats.lastSearched = now;
    stats.avgResults = Math.round((stats.avgResults * (stats.count - 1) + resultsCount) / stats.count);
}

function getTopSearches(limit = 20) {
    const now = Date.now();
    return Array.from(searchAnalytics.entries())
        .filter(([_, stats]) => (now - stats.lastSearched) < ANALYTICS_WINDOW)
        .map(([key, stats]) => ({ key, ...stats }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

// Cache cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of searchCache.entries()) {
        if (now - value.timestamp > SEARCH_CACHE_TTL) searchCache.delete(key);
    }
    console.log(`[Cache Cleanup] Search: ${searchCache.size} entries`);
}, 5 * 60 * 1000);

// ==================== KITE SEGMENT MAPPING ====================
// Kite segments: NFO-FUT, NFO-OPT, BFO-FUT, BFO-OPT, MCX-FUT, MCX-OPT, NSE, BSE, INDICES
// Kite instrument_type: FUT, CE, PE, EQ

// Map category filter to Kite segment patterns
function getSegmentFilter(category) {
    switch (category) {
        case "F&O":
            return { $in: ["NFO-FUT", "NFO-OPT", "BFO-FUT", "BFO-OPT"] };
        case "Commodity":
            return { $in: ["MCX-FUT", "MCX-OPT", "CDS-FUT", "CDS-OPT"] };
        case "Index":
        case "NSE_INDEX":
            return { $in: ["INDICES"] };
        case "Equity":
            return { $in: ["NSE", "BSE"] };
        case "All":
        default:
            // Default: F&O + Commodity (excluding indices and equity for trading)
            return { $in: ["NSE","BSE","NFO-FUT", "NFO-OPT", "BFO-FUT", "BFO-OPT", "MCX-FUT", "MCX-OPT"] };
    }
}

// Check if instrument is a futures contract
function isFutures(instrument_type) {
    return instrument_type === "FUT";
}

// Check if instrument is an options contract
function isOptions(instrument_type) {
    return ["CE", "PE"].includes(instrument_type);
}

// ------------------------------------------------------------
// Smart query parsing – extracts optional segment and type tokens
// ------------------------------------------------------------
// Supported segment tokens: NSE, BSE, MCX
// Supported type tokens: FUT (futures), OPT (options)
// Example queries:
//   "RELIANCE NSE FUT" → keyword: "RELIANCE", segments: ["NSE","NFO-FUT","NFO-OPT"], type: "FUT"
//   "BANKNIFTY MCX OPT" → keyword: "BANKNIFTY", segments: ["MCX-FUT","MCX-OPT"], type: "OPT"
//   "INFY" → keyword: "INFY", segments: all (default), type: any
// Returns an object { keyword, segmentFilter, typeFilter }
function parseSmartQuery(rawQuery) {
    // Normalize the query and preserve original case for keyword matching
    const normalizedQuery = rawQuery.trim().toUpperCase();
    const tokens = normalizedQuery.split(/\s+/);
    const segmentMap = {
        NSE: ["NSE", "NFO-FUT", "NFO-OPT"],
        BSE: ["BSE", "BFO-FUT", "BFO-OPT"],
        MCX: ["MCX-FUT", "MCX-OPT"],
        EQUITY: ["NSE", "BSE"],
        EQUITIES: ["NSE", "BSE"],
        FUTURES: ["NFO-FUT", "BFO-FUT", "MCX-FUT"],
        OPTIONS: ["NFO-OPT", "BFO-OPT", "MCX-OPT"]
    };
    const typeMap = {
        FUT: "FUT",
        FUTURE: "FUT",
        FUTURES: "FUT",
        OPT: ["CE", "PE"],
        OPTION: ["CE", "PE"],
        OPTIONS: ["CE", "PE"]
    };

    const segmentTokens = [];
    const typeTokens = [];
    const keywordParts = [];

    for (const t of tokens) {
        if (segmentMap[t]) {
            segmentTokens.push(t);
        } else if (typeMap[t]) {
            typeTokens.push(t);
        } else {
            keywordParts.push(t);
        }
    }

    // Handle special case where user types something like "TVS MOTOR" but we want to match "TVSMOTOR"
    // We'll create both versions - with spaces and without spaces
    let processedKeyword = keywordParts.join(' ');
    if (keywordParts.length > 1) {
        // Create a regex that matches both spaced and unspaced versions
        const spacedKeyword = keywordParts.join('\\s+');
        const unspacedKeyword = keywordParts.join('');
        processedKeyword = `(${spacedKeyword}|${unspacedKeyword})`;
    }

    // Build segment filter – if any segment token present, include all related segments
    let segmentFilter;
    if (segmentTokens.length > 0) {
        const segments = [];
        segmentTokens.forEach(tok => segments.push(...segmentMap[tok]));
        segmentFilter = { $in: Array.from(new Set(segments)) };
    } else {
        // Default – same as previous "All" filter
        segmentFilter = { $in: ["NSE","BSE","NFO-FUT", "NFO-OPT", "BFO-FUT", "BFO-OPT", "MCX-FUT", "MCX-OPT"] };
    }

    // Build type filter – if any type token present, restrict instrument_type accordingly
    let typeFilter = {};
    if (typeTokens.length > 0) {
        // If multiple type tokens, combine with $or (unlikely but safe)
        const conditions = typeTokens.map(tok => {
            const val = typeMap[tok];
            if (Array.isArray(val)) {
                return { instrument_type: { $in: val } };
            }
            return { instrument_type: val };
        });
        typeFilter = { $or: conditions };
    }

    return { keyword: processedKeyword, segmentFilter, typeFilter };
}

export { parseSmartQuery };

// ==================== SEARCH ENDPOINT ====================
router.get("/search", async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        // Note: We're no longer using the category parameter as we're doing smart parsing
        if (!q) return res.json([]);

        // --- Smart query parsing ---
        // The frontend sends only the raw query string (q). We now interpret optional tokens
        // such as NSE, BSE, MCX, FUT, OPT to build precise segment and type filters.
        const { keyword, segmentFilter, typeFilter } = parseSmartQuery(q);
        // Use the processed keyword directly as it already handles spaced/unspaced variations
        const regex = new RegExp(keyword, "i");
        const currentDate = new Date();

        // Cache check - using original query for more accurate caching
        const cacheKey = `search:${q.toLowerCase()}:${JSON.stringify(segmentFilter)}:${JSON.stringify(typeFilter)}`;
        const now = Date.now();

        const redisCache = await getCache(cacheKey);
        if (redisCache) {
            console.log(`[Search Redis Cache HIT] "${q}" - ${redisCache.length} results`);
            // trackSearch(q, "Smart", redisCache.length);
            return res.json(redisCache);
        }

        const memoryCached = searchCache.get(cacheKey);
        if (memoryCached && (now - memoryCached.timestamp) < SEARCH_CACHE_TTL) {
            console.log(`[Search Memory Cache HIT] "${q}" - ${memoryCached.results.length} results`);
            // trackSearch(q, "Smart", memoryCached.results.length);
            return res.json(memoryCached.results);
        }

        // ------------------------------------------------------------
        // New aggregation using $facet to enforce ordering:
        //   1️⃣ Up to 10 equity instruments (segment NSE/BSE, instrument_type not FUT/CE/PE)
        //   2️⃣ Futures (instrument_type = "FUT")
        //   3️⃣ Options (instrument_type = "CE" or "PE")
        // All results respect the original segment and optional type filters.
        // ------------------------------------------------------------
        // For equities, we don't need to filter by expiry since they don't expire
        // For futures/options, we need to filter by expiry
        const baseMatch = {
            segment: segmentFilter,
            $or: [{ tradingsymbol: regex }, { name: regex }]
        };

        // If a type filter was derived from the smart query, merge it into the match stage
        if (Object.keys(typeFilter).length) {
            Object.assign(baseMatch, typeFilter);
        }

        const searchResults = await Instrument.aggregate([
            { $match: baseMatch },
            {
                $facet: {
                    equities: [
                        // Equities are in NSE or BSE segments with instrument_type EQ
                        { $match: {
                            segment: { $in: ["NSE", "BSE"] },
                            instrument_type: "EQ",
                            $or: [{ tradingsymbol: regex }, { name: regex }]
                        } },
                        { $sort: { tradingsymbol: 1 } }, // simple alphabetical sort for equities
                        { $limit: 15 } // Increased to 15 as requested
                    ],
                    futures: [
                        { $match: {
                            instrument_type: "FUT",
                            expiry: { $gte: currentDate }
                        } },
                        // Prioritize nearest expiry
                        { $addFields: { expiryScore: { $subtract: [0, { $toLong: "$expiry" }] } } },
                        { $sort: { expiryScore: -1 } },
                        { $limit: 200 }
                    ],
                    options: [
                        { $match: {
                            instrument_type: { $in: ["CE", "PE"] },
                            expiry: { $gte: currentDate }
                        } },
                        { $addFields: { expiryScore: { $subtract: [0, { $toLong: "$expiry" }] } } },
                        { $sort: { expiryScore: -1 } },
                        { $limit: 200 }
                    ]
                }
            },
            // Combine the three arrays while preserving order
            {
                $project: {
                    combined: { $concatArrays: ["$equities", "$futures", "$options"] }
                }
            },
            { $unwind: "$combined" },
            { $replaceRoot: { newRoot: "$combined" } },
            // Final overall limit (including the 10 equity cap already applied)
            { $limit: 200 }
        ]);

        // Format response with Kite fields
        const results = searchResults.map(item => ({
            _id: item._id,
            instrument_token: item.instrument_token,
            exchange_token: item.exchange_token,
            tradingsymbol: item.tradingsymbol,
            name: item.name,
            segment: item.segment,
            exchange: item.exchange,
            instrument_type: item.instrument_type,
            expiry: item.expiry,
            strike: item.strike,
            lot_size: item.lot_size,
            tick_size: item.tick_size,
            last_price: item.last_price
        }));

        console.log(`[Search] Returning ${results.length} results for "${q}"`);
        // trackSearch(q, "Smart", results.length);
        // Store the combined, ordered result set in both memory and Redis caches
        // The result shape is an array of instrument objects (already ordered by equities → futures → options)
        searchCache.set(cacheKey, { results, timestamp: Date.now() });
        // Redis cache expects the raw array; we keep the same TTL (120 seconds)
        setCache(cacheKey, results, 120).catch(console.error);
        res.json(results);

    } catch (e) {
        console.error("instruments/search error:", e);
        res.status(500).json({ error: "failed" });
    }
});

// ==================== WATCHLIST ENDPOINT ====================
router.get("/watchlist", async (req, res) => {
    try {
        const start = Date.now();
        const popularKeywords = [
            "NIFTY", "BANKNIFTY", "RELIANCE", "HDFCBANK", "TATASTEEL",
            "SBIN", "ICICIBANK", "INFY", "TCS", "ADANIENT"
        ];

        const currentDate = new Date();
        const results = [];

        for (const keyword of popularKeywords.slice(0, 5)) {
            const futDoc = await Instrument.findOne({
                name: { $regex: new RegExp(`^${keyword}$`, 'i') },
                instrument_type: "FUT",
                expiry: { $gte: currentDate }
            })
                .sort({ expiry: 1 })
                .lean();

            if (futDoc) results.push(futDoc);
        }

        console.log(`[Watchlist API] Loaded ${results.length} instruments in ${Date.now() - start}ms`);
        res.json(results);
    } catch (e) {
        console.error("instruments/watchlist error:", e);
        res.status(500).json({ error: "failed" });
    }
});

// ==================== INDEXES ENDPOINT ====================
router.get("/indexes", async (req, res) => {
    try {
        const cacheKey = 'indexes:all';

        // Check memory cache
        const cached = searchCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
            return res.json(cached.results);
        }

        // Kite: Indices are in segment "INDICES"
        const indexes = await Instrument.find({
            segment: "INDICES"
        })
            .limit(50)
            .lean();

        const results = indexes.map(item => ({
            instrument_token: item.instrument_token,
            tradingsymbol: item.tradingsymbol,
            name: item.name,
            segment: item.segment,
            exchange: item.exchange
        }));

        console.log(`[Indexes] Found ${results.length} index instruments`);
        searchCache.set(cacheKey, { results, timestamp: Date.now() });
        res.json(results);
    } catch (e) {
        console.error("instruments/indexes error:", e);
        res.status(500).json({ error: "failed" });
    }
});

// ==================== RESOLVE ENDPOINT ====================
router.get("/resolve", async (req, res) => {
    try {
        const { segment, tradingsymbol, name, instrument_type, expiry, strike } = req.query;
        const q = {};
        if (segment) q.segment = segment.toUpperCase();
        if (tradingsymbol) q.tradingsymbol = tradingsymbol.toUpperCase();
        if (name) q.name = name.toUpperCase();
        if (instrument_type) q.instrument_type = instrument_type.toUpperCase();
        if (expiry) q.expiry = new Date(expiry);
        if (strike) q.strike = Number(strike);

        const doc = await Instrument.findOne(q).lean();
        if (!doc) return res.status(404).json({ error: "Instrument not found" });

        res.json({
            instrument_token: doc.instrument_token,
            segment: doc.segment,
            tradingsymbol: doc.tradingsymbol,
            lot_size: doc.lot_size
        });
    } catch (e) {
        console.error("instruments/resolve error:", e);
        res.status(500).json({ error: "failed" });
    }
});

// ==================== LOOKUP ENDPOINT ====================
router.get("/lookup", async (req, res) => {
    try {
        const { instrument_token, segment } = req.query;

        if (!instrument_token) {
            return res.status(400).json({ error: "instrument_token is required" });
        }

        const query = { instrument_token: String(instrument_token) };
        if (segment) query.segment = segment;

        const instrument = await Instrument.findOne(query)
            .select("instrument_token segment exchange tradingsymbol name instrument_type lot_size")
            .lean();

        if (!instrument) {
            return res.status(404).json({ error: "Instrument not found" });
        }

        res.json(instrument);
    } catch (e) {
        console.error("instruments/lookup error:", e);
        res.status(500).json({ error: "failed" });
    }
});

// ==================== ANALYTICS ENDPOINT ====================
router.get("/analytics", async (req, res) => {
    try {
        const topSearches = getTopSearches(50);
        const cacheStats = {
            memory: {
                searchCache: searchCache.size,
                analyticsTracked: searchAnalytics.size
            }
        };

        res.json({
            topSearches,
            cacheStats,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error("instruments/analytics error:", e);
        res.status(500).json({ error: "failed" });
    }
});

export default router;
