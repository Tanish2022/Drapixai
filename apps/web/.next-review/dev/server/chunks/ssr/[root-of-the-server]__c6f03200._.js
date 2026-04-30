module.exports = [
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

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
"[project]/apps/web/app/components/BackButton.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>BackButton
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$left$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowLeft$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/arrow-left.js [app-ssr] (ecmascript) <export default as ArrowLeft>");
'use client';
;
;
;
function BackButton() {
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRouter"])();
    const pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["usePathname"])();
    if (pathname === '/') return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
        onClick: ()=>{
            if (pathname.startsWith('/auth')) {
                router.push('/');
                return;
            }
            if (("TURBOPACK compile-time value", "undefined") !== 'undefined' && window.history.length > 1) //TURBOPACK unreachable
            ;
            else {
                router.push('/');
            }
        },
        "aria-label": "Go back",
        className: "fixed top-16 left-4 z-50 p-2 text-white/80 bg-white/5 border border-white/10 rounded-full backdrop-blur hover:text-white hover:bg-white/10 transition-colors",
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$left$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowLeft$3e$__["ArrowLeft"], {
            className: "w-4 h-4"
        }, void 0, false, {
            fileName: "[project]/apps/web/app/components/BackButton.tsx",
            lineNumber: 26,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/apps/web/app/components/BackButton.tsx",
        lineNumber: 11,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/app/lib/public-env.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEMO_VIDEO_URL",
    ()=>DEMO_VIDEO_URL,
    "GOOGLE_AUTH_ENABLED",
    ()=>GOOGLE_AUTH_ENABLED,
    "PUBLIC_API_BASE_URL",
    ()=>PUBLIC_API_BASE_URL,
    "getPublicWebBaseUrl",
    ()=>getPublicWebBaseUrl,
    "getSdkScriptUrl",
    ()=>getSdkScriptUrl
]);
const trimTrailingSlash = (value)=>value.replace(/\/+$/, '');
const PUBLIC_API_BASE_URL = trimTrailingSlash(("TURBOPACK compile-time value", "http://localhost:8000") || 'http://localhost:8000');
const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === '1';
const DEMO_VIDEO_URL = (process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || '').trim();
function getPublicWebBaseUrl() {
    const configuredBaseUrl = ("TURBOPACK compile-time value", "http://localhost:3000");
    if ("TURBOPACK compile-time truthy", 1) {
        return trimTrailingSlash(configuredBaseUrl);
    }
    //TURBOPACK unreachable
    ;
}
function getSdkScriptUrl() {
    return `${getPublicWebBaseUrl()}/sdk.js`;
}
}),
"[project]/apps/web/app/lib/analytics.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "trackEvent",
    ()=>trackEvent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$public$2d$env$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/public-env.ts [app-ssr] (ecmascript)");
'use client';
;
const VISITOR_STORAGE_KEY = 'drapixaiVisitorId';
const getVisitorId = ()=>{
    if ("TURBOPACK compile-time truthy", 1) {
        return '';
    }
    //TURBOPACK unreachable
    ;
    const existing = undefined;
    const created = undefined;
};
const trackEvent = (event, input = {})=>{
    if ("TURBOPACK compile-time truthy", 1) {
        return;
    }
    //TURBOPACK unreachable
    ;
    const payload = undefined;
};
}),
"[project]/apps/web/app/components/SiteAnalytics.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>SiteAnalytics
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$analytics$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/analytics.ts [app-ssr] (ecmascript)");
'use client';
;
;
;
function SiteAnalytics() {
    const pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["usePathname"])();
    const lastTrackedPath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!pathname || lastTrackedPath.current === pathname) {
            return;
        }
        lastTrackedPath.current = pathname;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$analytics$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["trackEvent"])('page_view', {
            path: pathname,
            metadata: {
                title: document.title
            }
        });
    }, [
        pathname
    ]);
    return null;
}
}),
"[project]/apps/web/app/providers.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Providers
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2d$auth$2f$react$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next-auth/react/index.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$components$2f$SiteAnalytics$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/components/SiteAnalytics.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
;
const THEME_STORAGE_KEY = 'drapixai-theme';
function ThemeSync() {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const applyTheme = (theme)=>{
            document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
        };
        const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
        applyTheme(storedTheme);
    }, []);
    return null;
}
function SessionSync() {
    const { data: session } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2d$auth$2f$react$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useSession"])();
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const apiKey = session?.apiKey;
        if (apiKey) {
            localStorage.setItem('apiKey', apiKey);
            fetch('/api/dashboard/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    apiKey
                })
            }).catch(()=>undefined);
        }
    }, [
        session
    ]);
    return null;
}
function Providers({ children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2d$auth$2f$react$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["SessionProvider"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(ThemeSync, {}, void 0, false, {
                fileName: "[project]/apps/web/app/providers.tsx",
                lineNumber: 41,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$components$2f$SiteAnalytics$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/apps/web/app/providers.tsx",
                lineNumber: 42,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(SessionSync, {}, void 0, false, {
                fileName: "[project]/apps/web/app/providers.tsx",
                lineNumber: 43,
                columnNumber: 7
            }, this),
            children
        ]
    }, void 0, true, {
        fileName: "[project]/apps/web/app/providers.tsx",
        lineNumber: 40,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/web/app/components/SupportAssistant.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>SupportAssistant
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/client/app-dir/link.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/arrow-right.js [app-ssr] (ecmascript) <export default as ArrowRight>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$mail$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Mail$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/mail.js [app-ssr] (ecmascript) <export default as Mail>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$message$2d$square$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__MessageSquare$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/message-square.js [app-ssr] (ecmascript) <export default as MessageSquare>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$send$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Send$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/send.js [app-ssr] (ecmascript) <export default as Send>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/sparkles.js [app-ssr] (ecmascript) <export default as Sparkles>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__ = __turbopack_context__.i("[project]/apps/web/node_modules/lucide-react/dist/esm/icons/x.js [app-ssr] (ecmascript) <export default as X>");
'use client';
;
;
;
;
;
const supportTopics = [
    {
        id: 'garment-upload',
        title: 'Garment upload help',
        summary: 'Start with garment-only upper-body images on plain backgrounds. DrapixAI should validate those assets first, before product discovery or storefront install enters the conversation.',
        keywords: [
            'garment',
            'upload',
            'rejected',
            'image',
            'background',
            'product prep',
            'asset',
            'cache'
        ],
        links: [
            {
                href: '/dashboard#garment-onboarding',
                label: 'Open product and garment prep'
            },
            {
                href: '/help#garments-images',
                label: 'Open garment guidance'
            }
        ]
    },
    {
        id: 'catalog-discovery',
        title: 'Catalog discovery help',
        summary: 'After garment validation, bring in a small product list or feed so DrapixAI has product context. Discovery should happen before suggested matches or live install.',
        keywords: [
            'catalog',
            'discovery',
            'feed',
            'products',
            'import',
            'csv',
            'discover',
            'sync'
        ],
        links: [
            {
                href: '/dashboard#garment-onboarding',
                label: 'Open discovery tools'
            },
            {
                href: '/help#integration-help',
                label: 'Open discovery and integration guidance'
            }
        ]
    },
    {
        id: 'matches-confirmation',
        title: 'Suggested matches and confirmation',
        summary: 'DrapixAI should suggest likely garment-to-product links after discovery, then a human confirms the right pairings before the storefront depends on them.',
        keywords: [
            'match',
            'matches',
            'suggested',
            'suggestions',
            'confirm',
            'confirmation',
            'pairing',
            'mapping'
        ],
        links: [
            {
                href: '/help#matches-confirmation',
                label: 'Open match confirmation guidance'
            }
        ]
    },
    {
        id: 'store-verification',
        title: 'Store verification help',
        summary: 'Save the store URL first, then add the verification meta tag only when you are ready for live domain setup. Verification is later than garment validation, discovery, and confirmation.',
        keywords: [
            'store',
            'verify',
            'verification',
            'domain',
            'meta',
            'homepage',
            'live',
            'settings'
        ],
        links: [
            {
                href: '/settings',
                label: 'Open store settings'
            },
            {
                href: '/help#integration-help',
                label: 'Open integration guidance'
            }
        ]
    },
    {
        id: 'weak-results',
        title: 'Weak or unrealistic try-on results',
        summary: 'Most weak results come from poor garment assets or weak person images. Use clean front-facing person photos and garment-only upper-body assets with accurate color and lighting.',
        keywords: [
            'result',
            'weak',
            'realistic',
            'quality',
            'output',
            'bad',
            'wrong',
            'color',
            'fit',
            'preview'
        ],
        links: [
            {
                href: '/help#tryon-results',
                label: 'Open try-on quality guidance'
            },
            {
                href: '/dashboard#plugin-demo',
                label: 'Open internal preview'
            }
        ]
    },
    {
        id: 'sdk-install',
        title: 'SDK installation help',
        summary: 'Use the Help page when you are ready to install on a storefront. The SDK should use confirmed mappings only after internal preview and confirmation are trusted.',
        keywords: [
            'sdk',
            'install',
            'script',
            'button',
            'widget',
            'auto attach',
            'single product',
            'storefront',
            'docs'
        ],
        links: [
            {
                href: '/help#integration-help',
                label: 'Open Help'
            },
            {
                href: '/help#integration-help',
                label: 'Single product install'
            },
            {
                href: '/help#integration-help',
                label: 'Auto attach install'
            }
        ]
    },
    {
        id: 'billing-support',
        title: 'Plan, quota, and billing help',
        summary: 'Use the trial or current plan to validate your workflow first. If the account has reached its try-on limit, stop rollout, review the Subscription page, and upgrade or contact sales before continuing.',
        keywords: [
            'billing',
            'plan',
            'pricing',
            'quota',
            'trial',
            'renders',
            'subscription',
            'upgrade',
            'limit reached',
            'quota exhausted',
            'no try-ons left'
        ],
        links: [
            {
                href: '/subscription',
                label: 'Open subscription'
            },
            {
                href: '/pricing',
                label: 'View pricing'
            },
            {
                href: '/contact',
                label: 'Contact support'
            }
        ]
    },
    {
        id: 'getting-started',
        title: 'Best first steps',
        summary: 'The easiest path is: upload garments, validate them, discover products, review suggested matches, confirm the right pairings, then run one believable preview before any live storefront setup.',
        keywords: [
            'start',
            'onboarding',
            'begin',
            'first',
            'setup',
            'how do i start',
            'quick',
            'easy'
        ],
        links: [
            {
                href: '/dashboard',
                label: 'Open guided dashboard'
            },
            {
                href: '/settings',
                label: 'Open settings'
            },
            {
                href: '/help#getting-started',
                label: 'Open getting started help'
            }
        ]
    }
];
const quickPrompts = [
    'How do I start?',
    'Why was my garment rejected?',
    'How does catalog discovery work?',
    'How do suggested matches work?',
    'How do I verify my store?',
    'My result looks weak',
    'How do I install the SDK?'
];
const normalize = (value)=>value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
const greetingKeywords = [
    'hi',
    'hii',
    'hello',
    'hey',
    'hey there',
    'hi there',
    'good morning',
    'good afternoon',
    'good evening'
];
const thanksKeywords = [
    'thanks',
    'thank you',
    'thx',
    'ty',
    'thanks a lot',
    'thankyou'
];
const acknowledgementKeywords = [
    'ok',
    'okay',
    'okk',
    'got it',
    'understood',
    'cool',
    'alright',
    'all right',
    'fine'
];
const farewellKeywords = [
    'bye',
    'goodbye',
    'see you',
    'see ya',
    'talk later',
    'bye bye'
];
const helpKeywords = [
    'help',
    'can you help',
    'need help',
    'support'
];
const normalizeQuery = (query)=>normalize(query).trim().replace(/\s+/g, ' ');
const isGreetingMessage = (query)=>{
    const normalizedQuery = normalizeQuery(query);
    return greetingKeywords.includes(normalizedQuery);
};
const isThanksMessage = (query)=>{
    const normalizedQuery = normalizeQuery(query);
    return thanksKeywords.includes(normalizedQuery);
};
const isAcknowledgementMessage = (query)=>{
    const normalizedQuery = normalizeQuery(query);
    return acknowledgementKeywords.includes(normalizedQuery);
};
const isFarewellMessage = (query)=>{
    const normalizedQuery = normalizeQuery(query);
    return farewellKeywords.includes(normalizedQuery);
};
const isSimpleHelpMessage = (query)=>{
    const normalizedQuery = normalize(query).trim().replace(/\s+/g, ' ');
    return helpKeywords.includes(normalizedQuery);
};
const findSupportTopic = (query)=>{
    const normalizedQuery = normalize(query);
    const matches = supportTopics.map((topic)=>{
        const score = topic.keywords.reduce((total, keyword)=>{
            const normalizedKeyword = normalize(keyword).trim();
            if (!normalizedKeyword) return total;
            return normalizedQuery.includes(normalizedKeyword) ? total + normalizedKeyword.split(' ').length : total;
        }, 0);
        return {
            topic,
            score
        };
    }).sort((left, right)=>right.score - left.score);
    return matches[0]?.score ? matches[0].topic : null;
};
const fallbackResponse = {
    role: 'assistant',
    title: 'Support path',
    summary: 'I could not match that cleanly yet. The fastest next step is to open DrapixAI Help for guided setup, and use email support if the issue is account-specific or blocking.',
    links: [
        {
            href: '/help',
            label: 'Open Help'
        },
        {
            href: 'mailto:support@drapixai.com',
            label: 'Email support@drapixai.com'
        }
    ]
};
const greetingResponse = {
    role: 'assistant',
    title: 'Hello',
    summary: 'Hi there. I can help with onboarding, garment validation, catalog discovery, suggested matches, store verification, SDK setup, pricing, or quota questions. Ask me what you need and I will point you to the right next step.',
    links: [
        {
            href: '/dashboard',
            label: 'Open dashboard'
        },
        {
            href: '/help',
            label: 'Open Help'
        }
    ]
};
const thanksResponse = {
    role: 'assistant',
    title: 'You’re welcome',
    summary: 'Happy to help. If you want, ask the next question directly and I’ll keep pointing you to the right onboarding, docs, pricing, or support step.',
    links: [
        {
            href: '/dashboard',
            label: 'Open dashboard'
        },
        {
            href: '/help',
            label: 'Open Help'
        }
    ]
};
const acknowledgementResponse = {
    role: 'assistant',
    title: 'Sounds good',
    summary: 'Whenever you are ready, ask the next question about onboarding, garments, store setup, SDK installation, pricing, or quota and I’ll guide you from there.',
    links: [
        {
            href: '/dashboard',
            label: 'Open dashboard'
        },
        {
            href: '/help',
            label: 'Open Help'
        }
    ]
};
const farewellResponse = {
    role: 'assistant',
    title: 'Talk soon',
    summary: 'Any time you come back, I can help with garments, discovery, suggested matches, store verification, SDK setup, or billing questions.',
    links: [
        {
            href: '/help',
            label: 'Open Help'
        },
        {
            href: 'mailto:support@drapixai.com',
            label: 'Email support'
        }
    ]
};
const helpResponse = {
    role: 'assistant',
    title: 'How I can help',
    summary: 'I can help with onboarding, garment validation, catalog discovery, suggested matches, manual confirmation, store verification, result quality, SDK setup, pricing, and quota questions.',
    links: [
        {
            href: '/dashboard',
            label: 'Open dashboard'
        },
        {
            href: '/help',
            label: 'Open Help'
        }
    ]
};
function SupportAssistant() {
    const pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["usePathname"])();
    const [isOpen, setIsOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [input, setInput] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])('');
    const [messages, setMessages] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])([
        {
            role: 'assistant',
            id: 'welcome',
            title: 'DrapixAI support assistant',
            summary: 'Ask about onboarding, garment validation, catalog discovery, suggested matches, confirmation, store verification, result quality, or SDK install. I will point you to the right page and the next best action.',
            links: [
                {
                    href: '/help',
                    label: 'Open Help'
                }
            ]
        }
    ]);
    const hasUserMessages = messages.some((message)=>message.role === 'user');
    const sendMessage = (rawMessage)=>{
        const message = rawMessage.trim();
        if (!message) return;
        const topic = findSupportTopic(message);
        const assistantReply = isGreetingMessage(message) ? {
            ...greetingResponse,
            id: `assistant-${Date.now() + 1}`
        } : isThanksMessage(message) ? {
            ...thanksResponse,
            id: `assistant-${Date.now() + 1}`
        } : isAcknowledgementMessage(message) ? {
            ...acknowledgementResponse,
            id: `assistant-${Date.now() + 1}`
        } : isFarewellMessage(message) ? {
            ...farewellResponse,
            id: `assistant-${Date.now() + 1}`
        } : isSimpleHelpMessage(message) ? {
            ...helpResponse,
            id: `assistant-${Date.now() + 1}`
        } : topic ? {
            role: 'assistant',
            id: `assistant-${Date.now() + 1}`,
            title: topic.title,
            summary: topic.summary,
            links: [
                ...topic.links,
                {
                    href: 'mailto:support@drapixai.com',
                    label: 'Email support'
                }
            ]
        } : {
            ...fallbackResponse,
            id: `assistant-${Date.now() + 1}`
        };
        setMessages((current)=>[
                ...current,
                {
                    role: 'user',
                    id: `user-${Date.now()}`,
                    body: message
                },
                assistantReply
            ]);
        setInput('');
        setIsOpen(true);
    };
    const hideAssistant = pathname === '/auth/login' || pathname === '/auth/register';
    if (hideAssistant) {
        return null;
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                type: "button",
                onClick: ()=>setIsOpen((current)=>!current),
                className: "fixed bottom-4 right-4 z-[70] inline-flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/30 bg-[#0b1120]/92 text-white shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:bg-[#121a2b] sm:bottom-6 sm:right-6",
                "aria-label": isOpen ? 'Close support assistant' : 'Open support assistant',
                title: isOpen ? 'Close support assistant' : 'Open support assistant',
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$message$2d$square$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__MessageSquare$3e$__["MessageSquare"], {
                    className: "h-6 w-6 text-cyan-300"
                }, void 0, false, {
                    fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                    lineNumber: 339,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                lineNumber: 332,
                columnNumber: 7
            }, this),
            isOpen ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "fixed inset-x-4 bottom-20 z-[70] flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#07101f]/95 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[420px]",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "border-b border-white/[0.08] bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(59,130,246,0.12))] px-5 py-4",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex items-start justify-between gap-3",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                            className: "text-sm uppercase tracking-[0.24em] text-cyan-300/80",
                                            children: "Support"
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                            lineNumber: 347,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                            className: "mt-1 text-lg font-semibold text-white",
                                            children: "DrapixAI assistant"
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                            lineNumber: 348,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                    lineNumber: 346,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    type: "button",
                                    onClick: ()=>setIsOpen(false),
                                    className: "rounded-xl border border-white/[0.08] bg-black/20 p-2 text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white",
                                    "aria-label": "Close support assistant",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$x$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__X$3e$__["X"], {
                                        className: "h-4 w-4"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 356,
                                        columnNumber: 17
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                    lineNumber: 350,
                                    columnNumber: 15
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                            lineNumber: 345,
                            columnNumber: 13
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                        lineNumber: 344,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4",
                        children: messages.map((message)=>message.role === 'user' ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex justify-end",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "max-w-[85%] rounded-2xl bg-cyan-500/15 px-4 py-3 text-sm leading-6 text-cyan-50",
                                    children: message.body
                                }, void 0, false, {
                                    fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                    lineNumber: 365,
                                    columnNumber: 19
                                }, this)
                            }, message.id, false, {
                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                lineNumber: 364,
                                columnNumber: 17
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-center gap-2 text-cyan-300",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__["Sparkles"], {
                                                className: "h-4 w-4"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 372,
                                                columnNumber: 21
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-sm font-medium",
                                                children: message.title
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 373,
                                                columnNumber: 21
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 371,
                                        columnNumber: 19
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                        className: "mt-3 text-sm leading-6 text-gray-200",
                                        children: message.summary
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 375,
                                        columnNumber: 19
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "mt-4 flex flex-wrap gap-2",
                                        children: message.links.map((link)=>link.href.startsWith('mailto:') ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                                href: link.href,
                                                className: "inline-flex items-center gap-2 rounded-xl border border-white/[0.10] px-3 py-2 text-xs text-gray-100 transition-colors hover:bg-white/[0.06]",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$mail$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Mail$3e$__["Mail"], {
                                                        className: "h-3.5 w-3.5"
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                        lineNumber: 384,
                                                        columnNumber: 27
                                                    }, this),
                                                    link.label
                                                ]
                                            }, `${message.id}-${link.href}`, true, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 379,
                                                columnNumber: 25
                                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                                                href: link.href,
                                                className: "inline-flex items-center gap-2 rounded-xl border border-white/[0.10] px-3 py-2 text-xs text-gray-100 transition-colors hover:bg-white/[0.06]",
                                                children: [
                                                    link.label,
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$arrow$2d$right$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__ArrowRight$3e$__["ArrowRight"], {
                                                        className: "h-3.5 w-3.5"
                                                    }, void 0, false, {
                                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                        lineNumber: 394,
                                                        columnNumber: 27
                                                    }, this)
                                                ]
                                            }, `${message.id}-${link.href}`, true, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 388,
                                                columnNumber: 25
                                            }, this))
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 376,
                                        columnNumber: 19
                                    }, this)
                                ]
                            }, message.id, true, {
                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                lineNumber: 370,
                                columnNumber: 17
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                        lineNumber: 361,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "border-t border-white/[0.08] px-4 py-4",
                        children: [
                            !hasUserMessages ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mb-3 flex flex-wrap gap-2",
                                children: quickPrompts.map((prompt)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                        type: "button",
                                        onClick: ()=>sendMessage(prompt),
                                        className: "rounded-full border border-white/[0.10] bg-white/[0.03] px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/[0.06]",
                                        children: prompt
                                    }, prompt, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 408,
                                        columnNumber: 19
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                lineNumber: 406,
                                columnNumber: 15
                            }, this) : null,
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex items-end gap-3",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex-1 rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                htmlFor: "support-assistant-input",
                                                className: "sr-only",
                                                children: "Ask support assistant"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 422,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("textarea", {
                                                id: "support-assistant-input",
                                                rows: 2,
                                                value: input,
                                                onChange: (event)=>setInput(event.target.value),
                                                onKeyDown: (event)=>{
                                                    if (event.key === 'Enter' && !event.shiftKey) {
                                                        event.preventDefault();
                                                        sendMessage(input);
                                                    }
                                                },
                                                placeholder: "Ask about onboarding, garments, store verification, docs, or billing...",
                                                className: "w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-gray-500"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 425,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 421,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                        type: "button",
                                        onClick: ()=>sendMessage(input),
                                        className: "inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 text-white transition-opacity hover:opacity-90",
                                        "aria-label": "Send support question",
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$send$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Send$3e$__["Send"], {
                                            className: "h-4 w-4"
                                        }, void 0, false, {
                                            fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                            lineNumber: 447,
                                            columnNumber: 17
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 441,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                lineNumber: 420,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mt-3 flex items-center justify-between gap-3 text-xs text-gray-400",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-flex min-w-0 items-center gap-2",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$message$2d$square$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__MessageSquare$3e$__["MessageSquare"], {
                                                className: "h-3.5 w-3.5"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 453,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "truncate",
                                                children: "Guided answers from your current Help content"
                                            }, void 0, false, {
                                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                                lineNumber: 454,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 452,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                                        href: "mailto:support@drapixai.com",
                                        className: "shrink-0 text-cyan-300 hover:text-cyan-200",
                                        children: "support@drapixai.com"
                                    }, void 0, false, {
                                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                        lineNumber: 456,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                                lineNumber: 451,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                        lineNumber: 404,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/apps/web/app/components/SupportAssistant.tsx",
                lineNumber: 343,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true);
}
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/dynamic-access-async-storage.external.js [external] (next/dist/server/app-render/dynamic-access-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/dynamic-access-async-storage.external.js", () => require("next/dist/server/app-render/dynamic-access-async-storage.external.js"));

module.exports = mod;
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__c6f03200._.js.map