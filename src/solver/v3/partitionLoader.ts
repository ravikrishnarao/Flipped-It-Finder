/**
 * Flipit Finder V3 — Asynchronous Partition Loader
 * Handles lazy loading, bounded LRU in-memory caching, in-flight Promise deduplication,
 * eviction notifications for secondary provider indexes, and performance/memory instrumentation
 * for letter-partitioned datasets.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PartitionLoadStats } from './types.ts';

export type PartitionFetcher = (filePath: string) => Promise<string>;
export type PartitionEvictListener = (relativePath: string, fullPath: string) => void;

export interface PartitionLoaderOptions {
  baseDir?: string;
  customFetcher?: PartitionFetcher;
  /** Maximum number of partitions retained simultaneously in LRU cache (default: 64) */
  maxPartitions?: number;
  /** Maximum total raw partition bytes retained in LRU cache (default: 64 MiB) */
  maxCacheBytes?: number;
}

export interface PartitionCacheStats {
  loadedPartitions: string[];
  partitionCount: number;
  cacheSizeBytes: number;
  maxPartitions: number;
  maxCacheBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  evictedBytes: number;
}

export const DEFAULT_MAX_PARTITIONS = 64;
export const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024; // 64 MiB raw JSON budget

export class PartitionLoader {
  private cache = new Map<string, any>();
  private statsCache = new Map<string, PartitionLoadStats>();
  private inFlightLoads = new Map<string, Promise<{ data: any | null; stats: PartitionLoadStats }>>();
  private evictListeners = new Set<PartitionEvictListener>();

  private customFetcher?: PartitionFetcher;
  private baseDir: string;
  private maxPartitions: number;
  private maxCacheBytes: number;

  private currentBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private evictedBytes = 0;

  constructor(
    baseDirOrOptions?: string | PartitionLoaderOptions,
    customFetcher?: PartitionFetcher,
    extraOptions?: Omit<PartitionLoaderOptions, 'baseDir' | 'customFetcher'>
  ) {
    if (typeof baseDirOrOptions === 'object' && baseDirOrOptions !== null) {
      this.baseDir = baseDirOrOptions.baseDir || path.resolve(process.cwd());
      this.customFetcher = baseDirOrOptions.customFetcher ?? customFetcher;
      this.maxPartitions = baseDirOrOptions.maxPartitions ?? DEFAULT_MAX_PARTITIONS;
      this.maxCacheBytes = baseDirOrOptions.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    } else {
      this.baseDir = baseDirOrOptions || path.resolve(process.cwd());
      this.customFetcher = customFetcher;
      this.maxPartitions = extraOptions?.maxPartitions ?? DEFAULT_MAX_PARTITIONS;
      this.maxCacheBytes = extraOptions?.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    }
  }

  public resolvePath(relativePath: string): string {
    return path.isAbsolute(relativePath) ? relativePath : path.join(this.baseDir, relativePath);
  }

  /**
   * Register a callback invoked whenever a cached partition is evicted (or cache is cleared),
   * allowing secondary indexes (e.g., phrase lookup maps) to release memory cleanly.
   */
  public onEvict(listener: PartitionEvictListener): () => void {
    this.evictListeners.add(listener);
    return () => {
      this.evictListeners.delete(listener);
    };
  }

  private touchEntry(fullPath: string): void {
    if (!this.cache.has(fullPath)) return;
    const data = this.cache.get(fullPath);
    const stats = this.statsCache.get(fullPath);
    this.cache.delete(fullPath);
    this.cache.set(fullPath, data);
    if (stats) {
      this.statsCache.delete(fullPath);
      this.statsCache.set(fullPath, stats);
    }
  }

  private evictOldest(): boolean {
    const oldestKey = this.cache.keys().next().value as string | undefined;
    if (!oldestKey) return false;

    const oldStats = this.statsCache.get(oldestKey);
    const oldBytes = oldStats?.sizeBytes ?? 0;

    this.cache.delete(oldestKey);
    this.statsCache.delete(oldestKey);
    this.currentBytes = Math.max(0, this.currentBytes - oldBytes);
    this.evictions++;
    this.evictedBytes += oldBytes;

    for (const listener of this.evictListeners) {
      try {
        listener(oldStats?.filePath ?? oldestKey, oldestKey);
      } catch {
        // Listener errors must never break cache management
      }
    }
    return true;
  }

  private setCacheEntry(fullPath: string, data: any, stats: PartitionLoadStats): void {
    if (this.maxPartitions <= 0 || this.maxCacheBytes <= 0) {
      return;
    }
    // Never retain an entry larger than the total configured byte cap
    if (stats.sizeBytes > this.maxCacheBytes) {
      return;
    }

    if (this.cache.has(fullPath)) {
      const prevBytes = this.statsCache.get(fullPath)?.sizeBytes ?? 0;
      this.currentBytes = Math.max(0, this.currentBytes - prevBytes);
      this.cache.delete(fullPath);
      this.statsCache.delete(fullPath);
    }

    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxPartitions || this.currentBytes + stats.sizeBytes > this.maxCacheBytes)
    ) {
      if (!this.evictOldest()) break;
    }

    this.cache.set(fullPath, data);
    this.statsCache.set(fullPath, stats);
    this.currentBytes += stats.sizeBytes;
  }

  /**
   * Asynchronously load a letter partition with bounded LRU caching and in-flight Promise deduplication.
   */
  public async loadPartition<T>(relativePath: string): Promise<{ data: T | null; stats: PartitionLoadStats }> {
    const fullPath = this.resolvePath(relativePath);

    // 1. Check bounded LRU in-memory cache
    if (this.cache.has(fullPath)) {
      this.hits++;
      this.touchEntry(fullPath);
      const existingStats = this.statsCache.get(fullPath) || {
        partition: path.basename(fullPath),
        filePath: relativePath,
        sizeBytes: 0,
        loadTimeMs: 0,
        cached: true,
      };
      return {
        data: this.cache.get(fullPath) as T,
        stats: { ...existingStats, cached: true },
      };
    }

    // 2. Check in-flight Promise deduplication (prevents duplicate concurrent loads of the same partition)
    const inFlight = this.inFlightLoads.get(fullPath);
    if (inFlight) {
      this.hits++;
      return inFlight as Promise<{ data: T | null; stats: PartitionLoadStats }>;
    }

    this.misses++;

    // 3. Initiate single fetch/file-read operation
    const loadPromise = (async () => {
      const startTime = performance.now();
      try {
        let content: string;
        let sizeBytes = 0;

        if (this.customFetcher) {
          content = await this.customFetcher(relativePath);
          sizeBytes = Buffer.byteLength(content, 'utf-8');
        } else {
          if (!fs.existsSync(fullPath)) {
            const stats: PartitionLoadStats = {
              partition: path.basename(fullPath),
              filePath: relativePath,
              sizeBytes: 0,
              loadTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
              cached: false,
            };
            return { data: null, stats };
          }
          const stat = await fs.promises.stat(fullPath);
          sizeBytes = stat.size;
          content = await fs.promises.readFile(fullPath, 'utf-8');
        }

        const parsedData = JSON.parse(content) as T;
        const endTime = performance.now();
        const stats: PartitionLoadStats = {
          partition: path.basename(fullPath),
          filePath: relativePath,
          sizeBytes,
          loadTimeMs: Math.round((endTime - startTime) * 100) / 100,
          cached: false,
        };

        this.setCacheEntry(fullPath, parsedData, stats);

        return { data: parsedData, stats };
      } catch (err) {
        const stats: PartitionLoadStats = {
          partition: path.basename(fullPath),
          filePath: relativePath,
          sizeBytes: 0,
          loadTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
          cached: false,
        };
        console.warn(`[PartitionLoader] Failed to load partition ${relativePath}:`, err);
        return { data: null, stats };
      } finally {
        this.inFlightLoads.delete(fullPath);
      }
    })();

    this.inFlightLoads.set(fullPath, loadPromise);
    return loadPromise;
  }

  /**
   * Synchronous load fallback for preloaded or cached partitions.
   */
  public loadPartitionSync<T>(relativePath: string): { data: T | null; stats: PartitionLoadStats } {
    const fullPath = this.resolvePath(relativePath);

    if (this.cache.has(fullPath)) {
      this.hits++;
      this.touchEntry(fullPath);
      const stats = this.statsCache.get(fullPath) || {
        partition: path.basename(fullPath),
        filePath: relativePath,
        sizeBytes: 0,
        loadTimeMs: 0,
        cached: true,
      };
      return { data: this.cache.get(fullPath) as T, stats: { ...stats, cached: true } };
    }

    this.misses++;
    const startTime = performance.now();
    try {
      if (!fs.existsSync(fullPath)) {
        return {
          data: null,
          stats: {
            partition: path.basename(fullPath),
            filePath: relativePath,
            sizeBytes: 0,
            loadTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
            cached: false,
          },
        };
      }

      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsedData = JSON.parse(content) as T;
      const endTime = performance.now();

      const stats: PartitionLoadStats = {
        partition: path.basename(fullPath),
        filePath: relativePath,
        sizeBytes: stat.size,
        loadTimeMs: Math.round((endTime - startTime) * 100) / 100,
        cached: false,
      };

      this.setCacheEntry(fullPath, parsedData, stats);

      return { data: parsedData, stats };
    } catch {
      return {
        data: null,
        stats: {
          partition: path.basename(fullPath),
          filePath: relativePath,
          sizeBytes: 0,
          loadTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
          cached: false,
        },
      };
    }
  }

  public isCached(relativePath: string): boolean {
    return this.cache.has(this.resolvePath(relativePath));
  }

  public getLoadedPartitions(): string[] {
    return Array.from(this.cache.keys()).map((p) => path.basename(p));
  }

  public getCacheSizeBytes(): number {
    return this.currentBytes;
  }

  public getPartitionStats(relativePath: string): PartitionLoadStats | undefined {
    return this.statsCache.get(this.resolvePath(relativePath));
  }

  public getDetailedCacheStats(): PartitionCacheStats {
    return {
      loadedPartitions: this.getLoadedPartitions(),
      partitionCount: this.cache.size,
      cacheSizeBytes: this.currentBytes,
      maxPartitions: this.maxPartitions,
      maxCacheBytes: this.maxCacheBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      evictedBytes: this.evictedBytes,
    };
  }

  public clearCache(): void {
    const entries = Array.from(this.statsCache.entries());
    this.cache.clear();
    this.statsCache.clear();
    this.inFlightLoads.clear();
    this.currentBytes = 0;

    for (const [fullPath, st] of entries) {
      for (const listener of this.evictListeners) {
        try {
          listener(st.filePath, fullPath);
        } catch {
          // ignore
        }
      }
    }
  }
}
