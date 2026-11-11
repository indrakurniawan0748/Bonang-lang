'use strict';

/**
 * Klien HTTP Bonang.
 *
 * Wrapper tipis di atas `fetch` yang:
 *  - selalu menggunakan timeout
 *  - melemparkan error terstruktur (BonangError) untuk status non-2xx
 *  - mendukung retry dengan backoff eksponensial
 */
const { BonangError, withTimeout, sleep } = require('../core/runtime');

/**
 * Buat klien HTTP.
 */
function createHttpClient(options = {}) {
    const baseUrl = options.baseUrl ? String(options.baseUrl).replace(/\/$/, '') : '';
    const defaultTimeout = options.timeout || 10000;
    const defaultHeaders = options.headers || {};
    const fetchImpl = options.fetch || globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
        throw new BonangError('fetch tidak tersedia di lingkungan ini', 'NO_FETCH', 500);
    }

    /**
     * Lakukan satu request.
     */
    async function request(method, url, config = {}) {
        const target = /^https?:\/\//i.test(url) ? url : `${baseUrl}${url}`;
        const timeout = config.timeout || defaultTimeout;
        const headers = { ...defaultHeaders, ...(config.headers || {}) };

        let body = config.body;
        if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
            body = JSON.stringify(body);
            if (!headers['Content-Type'] && !headers['content-type']) {
                headers['Content-Type'] = 'application/json';
            }
        }

        let response;
        try {
            response = await withTimeout(
                fetchImpl(target, { method, headers, body }),
                timeout,
                `Request ${method} ${target} melebihi batas waktu ${timeout}ms`
            );
        } catch (err) {
            if (err instanceof BonangError) throw err;
            throw new BonangError(`Request ${method} ${target} gagal: ${err.message}`, 'NETWORK_ERROR', 502);
        }

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await response.json().catch(() => null)
            : await response.text();

        if (!response.ok) {
            throw new BonangError(
                `Request ${method} ${target} gagal dengan status ${response.status}`,
                'HTTP_ERROR',
                response.status,
                { data }
            );
        }

        return { status: response.status, data, headers: response.headers };
    }

    /**
     * Request dengan retry dan backoff eksponensial.
     */
    async function requestWithRetry(method, url, config = {}) {
        const retries = config.retries ?? 0;
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await request(method, url, config);
            } catch (err) {
                lastError = err;
                // Hanya retry untuk error jaringan/server, bukan untuk 4xx.
                const retryable = err.code === 'NETWORK_ERROR'
                    || err.code === 'TIMEOUT'
                    || (err.statusCode && err.statusCode >= 500);
                if (!retryable || attempt === retries) break;
                await sleep((config.backoffMs || 200) * Math.pow(2, attempt));
            }
        }
        throw lastError;
    }

    return {
        get: (url, config) => request('GET', url, config),
        post: (url, body, config) => request('POST', url, { ...config, body }),
        put: (url, body, config) => request('PUT', url, { ...config, body }),
        patch: (url, body, config) => request('PATCH', url, { ...config, body }),
        delete: (url, config) => request('DELETE', url, config),
        request,
        requestWithRetry
    };
}

module.exports = { createHttpClient };
