@echo off
chcp 65001 >nul
echo ========================================
echo   DRAPIXAI LOCAL FILE STRUCTURE
echo ========================================
echo.

echo velrix_local/
echo ├── .gitignore
echo ├── docker-compose.yml
echo ├── package-lock.json
echo ├── package.json
echo ├── Setup.bat
echo ├── tsconfig.json
echo │
echo ├── apps/
echo │   ├── api/
echo │   │   ├── package-lock.json
echo │   │   ├── package.json
echo │   │   ├── tsconfig.json
echo │   │   ├── prisma/
echo │   │   │   └── schema.prisma
echo │   │   ├── src/
echo │   │   │   ├── server.ts
echo │   │   │   ├── middleware/
echo │   │   │   ├── routes/
echo │   │   │   │   ├── analytics.ts
echo │   │   │   │   ├── auth.ts
echo │   │   │   │   └── sdk.ts
echo │   │   │   ├── services/
echo │   │   │   │   └── watermark.ts
echo │   │   │   ├── types/
echo │   │   │   │   ├── express.d.ts
echo │   │   │   │   ├── node-cron.d.ts
echo │   │   │   │   └── sharp.d.ts
echo │   │   │   └── utils/
echo │   │   └── uploads/
echo │   │
echo │   └── web/
echo │       ├── next-env.d.ts
echo │       ├── next.config.js
echo │       ├── package-lock.json
echo │       ├── package.json
echo │       ├── postcss.config.js
echo │       ├── tailwind.config.ts
echo │       ├── tsconfig.json
echo │       ├── app/
echo │       │   ├── globals.css
echo │       │   ├── layout.tsx
echo │       │   ├── page.tsx
echo │       │   ├── auth/
echo │       │   │   ├── login/
echo │       │   │   │   └── page.tsx
echo │       │   │   └── register/
echo │       │   │       └── page.tsx
echo │       │   ├── dashboard/
echo │       │   │   └── page.tsx
echo │       │   └── pricing/
echo │       │       └── page.tsx
echo │       ├── components/
echo │       ├── lib/
echo │       └── public/
echo │           └── garments/
echo │
echo ├── packages/
echo │   └── sdk/
echo │       ├── examples/
echo │       └── src/
echo │
echo ├── scripts/
echo │
echo └── workers/
echo     └── gpu-worker/
echo         ├── garments/
echo         └── src/
echo             ├── models/
echo             ├── pipeline/
echo             └── utils/

echo.
echo ========================================
echo   Total: 4 main directories
echo   - apps/ (api, web)
echo   - packages/ (sdk)
echo   - scripts/
echo   - workers/ (gpu-worker)
echo ========================================
pause
