/**
 * Decompress gzipped GTFS files for Vercel deployment.
 * Run as buildCommand before the function is bundled.
 */
import { createReadStream, createWriteStream, readdirSync, existsSync } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import path from 'path';

const GTFS_DIR = path.join(process.cwd(), 'data', 'gtfs');

if (!existsSync(GTFS_DIR)) {
  console.error('GTFS directory not found:', GTFS_DIR);
  process.exit(1);
}

const gzFiles = readdirSync(GTFS_DIR).filter(f => f.endsWith('.gz'));

if (gzFiles.length === 0) {
  console.log('No .gz files found — GTFS data may already be decompressed');
  process.exit(0);
}

for (const file of gzFiles) {
  const input = path.join(GTFS_DIR, file);
  const output = path.join(GTFS_DIR, file.replace('.gz', ''));
  if (existsSync(output)) {
    console.log(`Already exists: ${file.replace('.gz', '')}`);
    continue;
  }
  await pipeline(
    createReadStream(input),
    createGunzip(),
    createWriteStream(output)
  );
  console.log(`Decompressed: ${file} → ${file.replace('.gz', '')}`);
}

console.log('GTFS data ready');
