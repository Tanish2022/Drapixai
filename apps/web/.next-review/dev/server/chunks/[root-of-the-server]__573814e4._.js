module.exports = [
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/tags-manifest.external.js [external] (next/dist/server/lib/incremental-cache/tags-manifest.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/tags-manifest.external.js", () => require("next/dist/server/lib/incremental-cache/tags-manifest.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/apps/web/app/lib/admin-session.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ADMIN_SESSION_COOKIE",
    ()=>ADMIN_SESSION_COOKIE,
    "ADMIN_SESSION_MAX_AGE_SECONDS",
    ()=>ADMIN_SESSION_MAX_AGE_SECONDS,
    "createAdminSessionToken",
    ()=>createAdminSessionToken,
    "verifyAdminSessionToken",
    ()=>verifyAdminSessionToken
]);
const ADMIN_SESSION_COOKIE = 'drapixai_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const getAdminSessionSecret = ()=>process.env.ADMIN_SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encodeBase64Url = (value)=>btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decodeBase64Url = (value)=>{
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - normalized.length % 4);
    return atob(`${normalized}${padding}`);
};
const getSigningKey = async ()=>{
    return crypto.subtle.importKey('raw', encoder.encode(getAdminSessionSecret()), {
        name: 'HMAC',
        hash: 'SHA-256'
    }, false, [
        'sign',
        'verify'
    ]);
};
const toHex = (buffer)=>Array.from(new Uint8Array(buffer)).map((value)=>value.toString(16).padStart(2, '0')).join('');
const sign = async (payload)=>{
    const signature = await crypto.subtle.sign('HMAC', await getSigningKey(), encoder.encode(payload));
    return toHex(signature);
};
const createAdminSessionToken = async ()=>{
    const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
    const payload = encodeBase64Url(JSON.stringify({
        scope: 'admin',
        expiresAt
    }));
    return `${payload}.${await sign(payload)}`;
};
const verifyAdminSessionToken = async (token)=>{
    if (!token) {
        return false;
    }
    const secret = getAdminSessionSecret();
    if (!secret) {
        return false;
    }
    const [payload, signature] = token.split('.');
    if (!payload || !signature) {
        return false;
    }
    const expectedSignature = await sign(payload);
    if (signature !== expectedSignature) {
        return false;
    }
    try {
        const parsed = JSON.parse(decoder.decode(Uint8Array.from(decodeBase64Url(payload), (char)=>char.charCodeAt(0))));
        return parsed.scope === 'admin' && typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
    } catch  {
        return false;
    }
};
}),
"[project]/apps/web/app/lib/dashboard-session.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DASHBOARD_SESSION_COOKIE",
    ()=>DASHBOARD_SESSION_COOKIE,
    "DASHBOARD_SESSION_MAX_AGE_SECONDS",
    ()=>DASHBOARD_SESSION_MAX_AGE_SECONDS,
    "createDashboardSessionToken",
    ()=>createDashboardSessionToken,
    "readDashboardSessionToken",
    ()=>readDashboardSessionToken,
    "verifyDashboardSessionToken",
    ()=>verifyDashboardSessionToken
]);
const DASHBOARD_SESSION_COOKIE = 'drapixai_dashboard_session';
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const getDashboardSessionSecret = ()=>process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || '';
const toBase64 = (bytes)=>{
    let binary = '';
    for (const value of bytes){
        binary += String.fromCharCode(value);
    }
    return btoa(binary);
};
const fromBase64 = (value)=>{
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for(let index = 0; index < binary.length; index += 1){
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};
const encodeBase64Url = (bytes)=>toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decodeBase64Url = (value)=>{
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - normalized.length % 4);
    return fromBase64(`${normalized}${padding}`);
};
const getEncryptionKey = async ()=>{
    const secret = getDashboardSessionSecret();
    if (!secret) {
        throw new Error('DASHBOARD_SESSION_SECRET_NOT_CONFIGURED');
    }
    const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
    return crypto.subtle.importKey('raw', hashed, {
        name: 'AES-GCM'
    }, false, [
        'encrypt',
        'decrypt'
    ]);
};
const createDashboardSessionToken = async (apiKey)=>{
    const payload = {
        scope: 'dashboard',
        apiKey,
        expiresAt: Date.now() + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv
    }, await getEncryptionKey(), encoder.encode(JSON.stringify(payload)));
    return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(cipherBuffer))}`;
};
const readDashboardSessionToken = async (token)=>{
    if (!token) {
        return null;
    }
    const secret = getDashboardSessionSecret();
    if (!secret) {
        return null;
    }
    const [ivPart, cipherPart] = token.split('.');
    if (!ivPart || !cipherPart) {
        return null;
    }
    try {
        const decrypted = await crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: decodeBase64Url(ivPart)
        }, await getEncryptionKey(), decodeBase64Url(cipherPart));
        const parsed = JSON.parse(decoder.decode(decrypted));
        if (parsed.scope !== 'dashboard' || parsed.expiresAt <= Date.now() || !parsed.apiKey) {
            return null;
        }
        return parsed;
    } catch  {
        return null;
    }
};
const verifyDashboardSessionToken = async (token)=>{
    return Boolean(await readDashboardSessionToken(token));
};
}),
"[project]/apps/web/proxy.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "proxy",
    ()=>proxy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/server.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$admin$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/admin-session.ts [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/dashboard-session.ts [middleware] (ecmascript)");
;
;
;
async function proxy(req) {
    const { pathname } = req.nextUrl;
    if (pathname.startsWith('/admin')) {
        const adminSession = req.cookies.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$admin$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["ADMIN_SESSION_COOKIE"])?.value;
        if (!await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$admin$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["verifyAdminSessionToken"])(adminSession)) {
            const url = req.nextUrl.clone();
            url.pathname = '/admin-access';
            return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].redirect(url);
        }
    }
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/settings') || pathname.startsWith('/subscription')) {
        const dashboardSession = req.cookies.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["DASHBOARD_SESSION_COOKIE"])?.value;
        const hasDashboardSession = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["verifyDashboardSessionToken"])(dashboardSession);
        if (!hasDashboardSession) {
            const url = req.nextUrl.clone();
            url.pathname = '/auth/login';
            url.searchParams.set('next', pathname);
            return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].redirect(url);
        }
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next();
}
const config = {
    matcher: [
        '/admin/:path*',
        '/dashboard/:path*',
        '/settings/:path*',
        '/subscription/:path*'
    ]
};
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__573814e4._.js.map