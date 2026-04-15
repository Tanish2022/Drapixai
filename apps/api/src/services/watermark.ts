/**
 * Watermark Service
 * 
 * Adds small, noticeable watermark to images in the corner.
 * Currently disabled for the public plan set, but kept for future gated previews.
 */

import {
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';

// Use dynamic import for sharp
let sharp: any = null;

async function getSharp() {
  if (!sharp) {
    sharp = (await import('sharp')).default;
  }
  return sharp;
}

// Initialize S3 client
const s3 = createStorageClient();
const BUCKET = STORAGE_BUCKET;

interface WatermarkOptions {
  text?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  opacity?: number;
  fontSize?: number;
  padding?: number;
  color?: string;
}

/**
 * Default watermark settings - SMALL and NOTICEABLE
 */
const DEFAULT_OPTIONS: WatermarkOptions = {
  text: 'DRAPIXAI',
  position: 'bottom-right',
  opacity: 0.75,
  fontSize: 14,
  padding: 15,
  color: 'white'
};

/**
 * Create watermark SVG
 */
function createWatermarkSVG(
  text: string,
  fontSize: number,
  color: string,
  padding: number
): string {
  const charWidth = Math.ceil(fontSize * 0.6);
  const textWidth = text.length * charWidth;
  const textHeight = Math.ceil(fontSize * 1.4);
  const width = textWidth + (padding * 2);
  const height = textHeight + (padding * 2);
  
  return `
    <svg width="${width}" height="${height}">
      <text
        x="${padding}"
        y="${padding + textHeight - 2}"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="${color}"
      >${text}</text>
    </svg>
  `;
}

/**
 * Add watermark to image
 */
async function addWatermarkWithSharp(
  inputPath: string,
  outputPath: string,
  options: WatermarkOptions
): Promise<void> {
  const sharpModule = await getSharp();
  
  const {
    text,
    position,
    opacity,
    fontSize,
    padding,
    color
  } = { ...DEFAULT_OPTIONS, ...options };
  
  // Get image dimensions
  const image = sharpModule.default(inputPath);
  const metadata = await image.metadata();
  const imgWidth = metadata.width || 512;
  const imgHeight = metadata.height || 512;
  
  // Create watermark SVG
  const svgBuffer = Buffer.from(createWatermarkSVG(
    text || 'DRAPIXAI',
    fontSize || 14,
    color || 'white',
    5
  ));
  
  // Get watermark dimensions (approximate)
  const wmWidth = ((text?.length || 7) * (fontSize || 14) * 0.6) + 20;
  const wmHeight = (fontSize || 14) * 1.4 + 10;
  
  // Calculate position
  const pad = padding || 15;
  let x = 0, y = 0;
  
  switch (position) {
    case 'bottom-left':
      x = pad;
      y = imgHeight - wmHeight - pad;
      break;
    case 'top-right':
      x = imgWidth - wmWidth - pad;
      y = pad;
      break;
    case 'top-left':
      x = pad;
      y = pad;
      break;
    case 'bottom-right':
    default:
      x = imgWidth - wmWidth - pad;
      y = imgHeight - wmHeight - pad;
      break;
  }
  
  // Apply watermark
  await sharpModule.default(inputPath)
    .composite([{
      input: svgBuffer,
      top: Math.max(0, Math.floor(y)),
      left: Math.max(0, Math.floor(x)),
      blend: 'over'
    }])
    .toFile(outputPath);
}

/**
 * Process image with watermark
 */
export async function processWithWatermark(
  inputKey: string,
  userPlan: string
): Promise<string> {
  const tempInput = path.join(os.tmpdir(), `${uuidv4()}-input.jpg`);
  const tempOutput = path.join(os.tmpdir(), `${uuidv4()}-output.jpg`);
  const outputKey = `outputs/${uuidv4()}.jpg`;
  
  const tempFiles: string[] = [];
  
  try {
    // Download image from S3
    console.log(`Downloading ${inputKey} from S3...`);
    
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET,
      Key: inputKey
    });
    
    const response: any = await s3.send(getCommand);
    
    // Write to temp file
    const chunks: Buffer[] = [];
    const stream: any = response.Body;
    
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    
    fs.writeFileSync(tempInput, Buffer.concat(chunks));
    tempFiles.push(tempInput);
    
    if (shouldAddWatermark(userPlan)) {
      console.log(`Adding watermark for ${userPlan} plan...`);
      await addWatermarkWithSharp(tempInput, tempOutput, {
        text: 'DRAPIXAI',
        position: 'bottom-right',
        opacity: 0.75,
        fontSize: 14,
        padding: 15,
        color: 'white'
      });
    } else {
      fs.copyFileSync(tempInput, tempOutput);
    }
    
    tempFiles.push(tempOutput);
    
    // Upload to S3
    console.log(`Uploading to ${outputKey}...`);
    const fileContent = fs.readFileSync(tempOutput);
    
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
      Body: fileContent,
      ContentType: 'image/jpeg'
    });
    
    await s3.send(putCommand);
    
    // Generate signed URL
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET,
      Key: outputKey
    }), { expiresIn: 3600 });
    
    console.log('Watermark processing complete');
    return signedUrl;
    
  } catch (error) {
    console.error('Watermark processing error:', error);
    throw error;
    
  } finally {
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Check if user should have watermark.
 * The current public pricing flow does not watermark paid or trial outputs.
 */
export function shouldAddWatermark(planType: string): boolean {
  return false;
}
