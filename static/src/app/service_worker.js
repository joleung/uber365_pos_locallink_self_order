// @odoo-module ignore
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */

/**
 * Enhanced POS ServiceWorker with GoLocalLink SSE Support
 *
 * This is a modified version of Odoo's POS ServiceWorker that excludes
 * GoLocalLink payment gateway SSE endpoints from caching.
 *
 * Issue: ServiceWorkers cannot cache Server-Sent Events (SSE) streaming responses
 * Solution: Skip caching for /api/events/* endpoints used by GoLocalLink
 *
 * See: GitHub Issue #22 - ServiceWorker blocks SSE connections
 */

const cacheName = "odoo-pos-cache";

const fetchCacheRespond = async (event) => {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(event.request);
        cache.put(event.request, response.clone());
        return response;
    } catch {
        return await cache.match(event.request);
    }
};

const cacheResources = async (event) => {
    const url = event.request.url;

    try {
        const cache = await caches.open(cacheName);
        await cache.add(url);
    } catch (error) {
        console.info("Failed to cache resource", url, error);
    }
};

self.addEventListener("fetch", (event) => {
    const url = event.request.url;

    // Ignore Chrome extensions and dataset. Dataset will be cached in indexedDB.
    if (
        url.includes("extension") ||
        url.includes("web/dataset") ||
        event.request.method !== "GET"
    ) {
        return;
    }

    // ENHANCEMENT: Skip caching for GoLocalLink SSE endpoints
    // SSE connections use EventSource API which cannot be cached
    // Pattern: /api/events/* (GoLocalLink transaction status stream)
    if (url.includes("/api/events/")) {
        console.log("[SW] Skipping cache for GoLocalLink SSE endpoint:", url);
        return; // Let browser handle SSE connection directly
    }

    // Also skip caching for GoLocalLink transaction endpoints to avoid stale data
    if (url.includes("/api/sse/txn/") || url.includes("/api/txn/")) {
        console.log("[SW] Skipping cache for GoLocalLink transaction endpoint:", url);
        return;
    }

    event.respondWith(fetchCacheRespond(event));
});

// Handle notification
self.addEventListener("message", (event) => {
    const data = event.data;
    if (data.urlsToCache && navigator.onLine) {
        for (const url of data.urlsToCache) {
            cacheResources({ request: { url } });
        }
    }
});
