module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/apps/web/app/lib/dashboard-session.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/apps/web/app/api/dashboard/session/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DELETE",
    ()=>DELETE,
    "GET",
    ()=>GET,
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/headers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/dashboard-session.ts [app-route] (ecmascript)");
;
;
;
const API_BASE_URL = process.env.DRAPIXAI_API_URL || ("TURBOPACK compile-time value", "http://localhost:8000") || 'http://localhost:8000';
const persistDashboardCookie = async (apiKey)=>{
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])();
    cookieStore.set({
        name: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DASHBOARD_SESSION_COOKIE"],
        value: await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createDashboardSessionToken"])(apiKey),
        httpOnly: true,
        sameSite: 'lax',
        secure: ("TURBOPACK compile-time value", "development") === 'production',
        path: '/',
        maxAge: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DASHBOARD_SESSION_MAX_AGE_SECONDS"]
    });
};
async function GET() {
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])();
    const session = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["readDashboardSessionToken"])(cookieStore.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DASHBOARD_SESSION_COOKIE"])?.value);
    if (!session) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'UNAUTHORIZED'
        }, {
            status: 401
        });
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        ok: true,
        apiKey: session.apiKey
    });
}
async function POST(request) {
    const body = await request.json().catch(()=>null);
    const directApiKey = body?.apiKey?.trim();
    if (directApiKey) {
        await persistDashboardCookie(directApiKey);
        return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: true,
            apiKey: directApiKey
        });
    }
    if (!body?.mode || ![
        'login',
        'register'
    ].includes(body.mode)) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'INVALID_MODE'
        }, {
            status: 400
        });
    }
    const endpoint = body.mode === 'register' ? '/auth/register' : '/auth/login';
    const payload = body.mode === 'register' ? {
        email: body.email,
        password: body.password,
        companyName: body.companyName,
        selectedPlan: body.selectedPlan,
        mobileNumber: body.mobileNumber,
        otp: body.otp
    } : {
        email: body.email,
        password: body.password,
        issueNewKey: true
    };
    const authResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        cache: 'no-store'
    });
    const authPayload = await authResponse.json().catch(()=>null);
    if (!authResponse.ok) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: authPayload?.error || 'AUTH_FAILED'
        }, {
            status: authResponse.status
        });
    }
    const apiKey = authPayload?.apiKey?.trim();
    if (!apiKey) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'API_KEY_NOT_ISSUED'
        }, {
            status: 500
        });
    }
    await persistDashboardCookie(apiKey);
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        ok: true,
        apiKey
    });
}
async function DELETE() {
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])();
    cookieStore.set({
        name: __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$dashboard$2d$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DASHBOARD_SESSION_COOKIE"],
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        secure: ("TURBOPACK compile-time value", "development") === 'production',
        path: '/',
        maxAge: 0
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        ok: true
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__c23e1b97._.js.map