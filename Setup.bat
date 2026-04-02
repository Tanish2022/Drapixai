@echo off
chcp 65001 >nul
echo ========================================
echo   DRAPIXAI LOCAL TESTING SETUP
echo ========================================

:: ============================================
:: STEP 1: CREATE DIRECTORIES
:: ============================================
echo [1/8] Creating directories...

mkdir apps\web\app
mkdir apps\web\components
mkdir apps\web\lib
mkdir apps\web\public\garments

mkdir apps\api\src\routes
mkdir apps\api\src\middleware
mkdir apps\api\src\services
mkdir apps\api\src\utils
mkdir apps\api\prisma
mkdir apps\api\uploads

mkdir packages\sdk\src
mkdir packages\sdk\examples
mkdir packages\sdk\dist

mkdir workers\gpu-worker\src\pipeline
mkdir workers\gpu-worker\src\models
mkdir workers\gpu-worker\src\utils
mkdir workers\gpu-worker\garments

mkdir scripts

echo [2/8] Creating root files...

:: ============================================
:: STEP 2: ROOT FILES
:: ============================================

:: .env
(
echo # Database
echo DATABASE_URL="postgresql://postgres:password@localhost:5432/drapixai"
echo.
echo # Redis
echo REDIS_URL="redis://localhost:6379"
echo.
echo # S3 / MinIO
echo AWS_REGION="us-east-1"
echo AWS_ACCESS_KEY_ID="minioadmin"
echo AWS_SECRET_ACCESS_KEY="minioadmin"
echo S3_ENDPOINT="http://localhost:9000"
echo S3_BUCKET="drapixai"
echo.
echo # JWT
echo JWT_SECRET="your-super-secret-jwt-key-change-in-production"
echo.
echo # Server
echo PORT=8000
echo NODE_ENV=development
echo ALLOWED_ORIGINS="*"
) > .env

:: .gitignore
(
echo node_modules/
echo .env
echo dist/
echo build/
echo *.log
echo .DS_Store
echo uploads/
echo *.pem
) > .gitignore

:: package.json
(
echo {
echo   "name": "drapixai",
echo   "version": "1.0.0",
echo   "private": true,
echo   "scripts": {
echo     "dev": "docker-compose up -d",
echo     "dev:api": "cd apps\\api && npm run dev",
echo     "dev:web": "cd apps\\web && npm run dev",
echo     "dev:worker": "cd workers\\gpu-worker && python src\\worker.py",
echo     "stop": "docker-compose down",
echo     "build": "npm run build --workspaces"
echo   },
echo   "devDependencies": {
echo     "typescript": "^5.3.0"
echo   }
echo }
) > package.json

:: tsconfig.json
(
echo {
echo   "compilerOptions": {
echo     "target": "ES2020",
echo     "lib": ["ES2020"],
echo     "module": "commonjs",
echo     "moduleResolution": "node",
echo     "esModuleInterop": true,
echo     "forceConsistentCasingInFileNames": true,
echo     "strict": true,
echo     "skipLibCheck": true,
echo     "resolveJsonModule": true,
echo     "declaration": true
echo   }
echo }
) > tsconfig.json

:: docker-compose.yml
(
echo version: '3.8'
echo.
echo services:
echo   postgres:
echo     image: postgres:14
echo     container_name: drapixai-postgres
echo     environment:
echo       POSTGRES_USER: postgres
echo       POSTGRES_PASSWORD: password
echo       POSTGRES_DB: drapixai
echo     ports:
echo       - "5432:5432"
echo     volumes:
echo       - postgres_data:/var/lib/postgresql/data
echo     healthcheck:
echo       test: ["CMD-SHELL", "pg_isready -U postgres"]
echo       interval: 10s
echo       timeout: 5s
echo       retries: 5
echo.
echo   redis:
echo     image: redis:alpine
echo     container_name: drapixai-redis
echo     ports:
echo       - "6379:6379"
echo     volumes:
echo       - redis_data:/data
echo.
echo   minio:
echo     image: minio/minio
echo     container_name: drapixai-minio
echo     command: server /data --console-address ":9001"
echo     environment:
echo       MINIO_ROOT_USER: minioadmin
echo       MINIO_ROOT_PASSWORD: minioadmin
echo     ports:
echo       - "9000:9000"
echo       - "9001:9001"
echo     volumes:
echo       - minio_data:/data
echo.
echo volumes:
echo   postgres_data:
echo   redis_data:
echo   minio_data:
) > docker-compose.yml

echo [3/8] Creating API files...

:: ============================================
:: STEP 3: API FILES
:: ============================================

:: apps/api/package.json
(
echo {
echo   "name": "drapixai-api",
echo   "version": "1.0.0",
echo   "main": "dist/server.js",
echo   "scripts": {
echo     "dev": "nodemon --exec ts-node src/server.ts",
echo     "build": "tsc",
echo     "start": "node dist/server.js",
echo     "prisma:generate": "prisma generate",
echo     "prisma:push": "prisma db push"
echo   },
echo   "dependencies": {
echo     "express": "^4.18.0",
echo     "cors": "^2.8.5",
echo     "helmet": "^7.0.0",
echo     "bcryptjs": "^2.4.3",
echo     "jsonwebtoken": "^9.0.0",
echo     "@prisma/client": "^5.0.0",
echo     "redis": "^4.6.0",
echo     "aws-sdk": "^2.0.0",
echo     "@aws-sdk/client-s3": "^3.0.0",
echo     "@aws-sdk/s3-request-presigner": "^3.0.0",
echo     "multer": "^1.4.5-lts.1",
echo     "node-cron": "^3.0.0",
echo     "dotenv": "^16.0.0",
echo     "uuid": "^9.0.0"
echo   },
echo   "devDependencies": {
echo     "typescript": "^5.0.0",
echo     "ts-node": "^10.9.0",
echo     "nodemon": "^3.0.0",
echo     "prisma": "^5.0.0",
echo     "@types/node": "^20.0.0",
echo     "@types/express": "^4.17.0",
echo     "@types/cors": "^2.8.0",
echo     "@types/bcryptjs": "^2.4.0",
echo     "@types/jsonwebtoken": "^9.0.0",
echo     "@types/multer": "^1.4.0",
echo     "@types/uuid": "^9.0.0"
echo   }
echo }
) > apps\api\package.json

:: apps/api/.env
(
echo DATABASE_URL="postgresql://postgres:password@localhost:5432/drapixai"
echo REDIS_URL="redis://localhost:6379"
echo AWS_REGION="us-east-1"
echo AWS_ACCESS_KEY_ID="minioadmin"
echo AWS_SECRET_ACCESS_KEY="minioadmin"
echo S3_ENDPOINT="http://localhost:9000"
echo S3_BUCKET="drapixai"
echo JWT_SECRET="your-super-secret-jwt-key"
echo PORT=8000
echo ALLOWED_ORIGINS="*"
) > apps\api\.env

:: apps/api/tsconfig.json
(
echo {
echo   "compilerOptions": {
echo     "target": "ES2020",
echo     "module": "commonjs",
echo     "lib": ["ES2020"],
echo     "outDir": "./dist",
echo     "rootDir": "./src",
echo     "strict": true,
echo     "esModuleInterop": true,
echo     "skipLibCheck": true,
echo     "forceConsistentCasingInFileNames": true,
echo     "resolveJsonModule": true,
echo     "declaration": true,
echo     "sourceMap": true
echo   },
echo   "include": ["src/**/*"],
echo   "exclude": ["node_modules", "dist"]
echo }
) > apps\api\tsconfig.json

:: apps/api/prisma/schema.prisma
(
echo generator client {
echo   provider = "prisma-client-js"
echo }
echo.
echo datasource db {
echo   provider = "postgresql"
echo   url      = env("DATABASE_URL")
echo }
echo.
echo model User {
echo   id              Int      @id @default(autoincrement())
echo   email           String   @unique
echo   passwordHash    String
echo   companyName     String?
echo   planType        String   @default("trial")
echo   trialExpiresAt  DateTime?
echo   createdAt       DateTime @default(now())
echo   apiKeys         ApiKey[]
echo }
echo.
echo model ApiKey {
echo   id              Int      @id @default(autoincrement())
echo   userId          Int
echo   keyHash         String   @unique
echo   domainWhitelist String
echo   isActive        Boolean  @default(true)
echo   createdAt       DateTime @default(now())
echo   user            User     @relation(fields: [userId], references: [id])
echo   renders         Render[]
echo   usages          Usage[]
echo }
echo.
echo model Usage {
echo   id          Int     @id @default(autoincrement())
echo   apiKeyId    Int
echo   renderCount Int     @default(0)
echo   month       Int
echo   year        Int
echo   apiKey      ApiKey  @relation(fields: [apiKeyId], references: [id])
echo   @@unique([apiKeyId, month, year])
echo }
echo.
echo model Render {
echo   id        Int      @id @default(autoincrement())
echo   apiKeyId  Int
echo   status    String   @default("pending")
echo   progress  Int      @default(0)
echo   inputUrl  String?
echo   outputUrl String?
echo   productId String?
echo   error     String?
echo   createdAt DateTime @default(now())
echo   apiKey    ApiKey   @relation(fields: [apiKeyId], references: [id])
echo }
) > apps\api\prisma\schema.prisma

:: apps/api/src/server.ts
(
echo import express from 'express';
echo import cors from 'cors';
echo import helmet from 'helmet';
echo import { PrismaClient } from '@prisma/client';
echo import { createClient } from 'redis';
echo import authRoutes from './routes/auth';
echo import sdkRoutes from './routes/sdk';
echo import analyticsRoutes from './routes/analytics';
echo import cron from 'node-cron';
echo.
echo const app = express();
echo const prisma = new PrismaClient();
echo.
echo // Redis client
echo const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
echo redis.connect();
echo.
echo // Middleware
echo app.use(helmet());
echo app.use(cors({ origin: '*' }));
echo app.use(express.json());
echo.
echo // Routes
echo app.use('/auth', authRoutes);
echo app.use('/sdk', sdkRoutes);
echo app.use('/analytics', analyticsRoutes);
echo.
echo // Health check
echo app.get('/health', (req, res) =^> {
echo   res.json({ status: 'ok', timestamp: new Date().toISOString() });
echo });
echo.
echo // Trial expiration cron (runs daily at midnight)
echo cron.schedule('0 0 * * *', async () =^> {
echo   const expiredUsers = await prisma.user.findMany({
echo     where: {
echo       trialExpiresAt: { lt: new Date() },
echo       planType: 'trial'
echo     }
echo   });
echo   for (const user of expiredUsers) {
echo     await prisma.user.update({
echo       where: { id: user.id },
echo       data: { planType: 'expired' }
echo     });
echo     console.log(`Trial expired for user ${user.email}`);
echo   }
echo });
echo.
echo const PORT = process.env.PORT || 8000;
echo app.listen(PORT, () =^> {
echo   console.log(`DrapixAI API running on http://localhost:${PORT}`);
echo });
echo.
echo export { app, prisma, redis };
) > apps\api\src\server.ts

:: apps/api/src/app.ts
(
echo import express from 'express';
echo import cors from 'cors';
echo import helmet from 'helmet';
echo import multer from 'multer';
echo import { PrismaClient } from '@prisma/client';
echo import { createClient } from 'redis';
echo import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
echo import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
echo import bcrypt from 'bcryptjs';
echo import jwt from 'jsonwebtoken';
echo import { v4 as uuidv4 } from 'uuid';
echo import fs from 'fs';
echo import path from 'path';
echo.
echo const app = express();
echo const prisma = new PrismaClient();
echo.
echo // Redis
echo const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
echo redis.connect();
echo.
echo // S3 (MinIO)
echo const s3 = new S3Client({
echo   region: process.env.AWS_REGION || 'us-east-1',
echo   endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
echo   credentials: {
echo     accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
echo     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
echo   },
echo   forcePathStyle: true,
echo });
echo.
echo const BUCKET = process.env.S3_BUCKET || 'drapixai';
echo.
echo // Middleware
echo app.use(helmet());
echo app.use(cors({ origin: '*' }));
echo app.use(express.json());
echo.
echo const upload = multer({ dest: 'uploads/' });
echo if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
echo.
echo // Auth middleware
echo const authMiddleware = async (req, res, next) =^> {
echo   const apiKey = req.headers.authorization?.replace('Bearer ', '');
echo   if (!apiKey) return res.status(401).json({ error: 'API key required' });
echo.
echo   const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
echo   let validKey = null;
echo   for (const key of keys) {
echo     if (await bcrypt.compare(apiKey, key.keyHash)) {
echo       validKey = key;
echo       break;
echo     }
echo   }
echo   if (!validKey) return res.status(401).json({ error: 'Invalid API key' });
echo   req.apiKey = validKey;
echo   next();
echo };
echo.
echo export { app, prisma, redis, s3, BUCKET, authMiddleware, upload };
) > apps\api\src\app.ts

:: apps/api/src/routes/auth.ts
(
echo import { Router } from 'express';
echo import bcrypt from 'bcryptjs';
echo import jwt from 'jsonwebtoken';
echo import { PrismaClient } from '@prisma/client';
echo import { v4 as uuidv4 } from 'uuid';
echo.
echo const router = Router();
echo const prisma = new PrismaClient();
echo.
echo // Register
echo router.post('/register', async (req, res) =^> {
echo   try {
echo     const { email, password, companyName } = req.body;
echo.
echo     const existing = await prisma.user.findUnique({ where: { email } });
echo     if (existing) return res.status(400).json({ error: 'Email already registered' });
echo.
echo     const passwordHash = await bcrypt.hash(password, 10);
echo     const trialExpiresAt = new Date();
echo     trialExpiresAt.setDate(trialExpiresAt.getDate() + 12);
echo.
echo     const user = await prisma.user.create({
echo       data: { email, passwordHash, companyName: companyName || '', trialExpiresAt, planType: 'trial' }
echo     });
echo.
echo     const apiKey = uuidv4().replace(/-/g, '');
echo     const keyHash = await bcrypt.hash(apiKey, 10);
echo.
echo     await prisma.apiKey.create({
echo       data: { userId: user.id, keyHash, domainWhitelist: '*' }
echo     });
echo.
echo     const now = new Date();
echo     await prisma.usage.create({
echo       data: {
echo         apiKeyId: (await prisma.apiKey.findFirst({ where: { userId: user.id } }))!.id,
echo         renderCount: 0,
echo         month: now.getMonth() + 1,
echo         year: now.getFullYear()
echo       }
echo     });
echo.
echo     const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret');
echo     res.json({ token, apiKey, user: { email: user.email, planType: user.planType } });
echo   } catch (err: any) {
echo     res.status(400).json({ error: err.message });
echo   }
echo });
echo.
echo // Login
echo router.post('/login', async (req, res) =^> {
echo   const { email, password } = req.body;
echo   const user = await prisma.user.findUnique({ where: { email } });
echo.
echo   if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
echo     return res.status(401).json({ error: 'Invalid credentials' });
echo   }
echo.
echo   const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret');
echo   res.json({ token, user: { email: