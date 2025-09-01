import path from 'path';

/**
 * ProactiveCacheManager handles automatic season directory discovery and cache warming
 * 
 * Features:
 * - Auto-discover season directories on server start
 * - Background cache warming for discovered seasons
 * - Intelligent refresh scheduling based on usage patterns
 * - Progress reporting and status monitoring
 */
export class ProactiveCacheManager {
  constructor(anilistClient, cacheManager, seasonParser, versionParser, api, applicationState, config = {}, anilistBatchClient = null) {
    this.anilistClient = anilistClient;
    this.anilistBatchClient = anilistBatchClient; // Add batch client support
    this.cache = cacheManager;
    this.seasonParser = seasonParser;
    this.versionParser = versionParser;
    this.api = api;
    this.applicationState = applicationState;
    this.debugLoggingEnabled = false;
    
    this.config = {
      enabled: config.enabled !== undefined ? config.enabled : true, // Default to enabled
      seasonsRootPath: config.seasonsRootPath || '', // No default path - must be configured
      warmupBatchSize: config.warmupBatchSize || 5,
      warmupDelayMs: config.warmupDelayMs || 2000,
      refreshIntervalHours: config.refreshIntervalHours || 6,
      maxConcurrentRequests: config.maxConcurrentRequests || 3,
      useBatchOptimization: config.useBatchOptimization !== undefined ? config.useBatchOptimization : true, // Enable batch by default
      batchCacheSize: config.batchCacheSize || 20, // How many titles to batch together for caching
      ...config
    };
    
    // Internal state
    this.discoveredSeasons = new Map(); // seasonPath -> { directories: [], lastScan: Date, cacheStatus: {} }
    this.warmupQueue = [];
    this.warmupActive = false;
    this.refreshScheduler = null;
    
    // Statistics
    this.stats = {
      totalDirectories: 0,
      cachedDirectories: 0,
      failedDirectories: 0,
      lastWarmupStart: null,
      lastWarmupEnd: null,
      lastRefresh: null
    };
  }

  logDebug(message) {
    if (this.debugLoggingEnabled) {
      this.api.communication.logInfo(`[DEBUG] ${message}`);
    }
  }

  logInfo(message) {
    // Only log important messages when debug is disabled
    if (this.debugLoggingEnabled || message.includes('disabled') || message.includes('failed')) {
      this.api.communication.logInfo(message);
    }
  }

  /**
   * Initialize proactive cache management
   * Called on plugin startup
   */
  async initialize() {
    if (!this.config.enabled) {
      this.logInfo("Proactive cache management disabled");
      return;
    }

    this.logInfo("Initializing proactive cache management...");
    
    try {
      // Start season directory discovery
      await this.discoverSeasonDirectories();
      
      // Start background cache warming
      this.startCacheWarming();
      
      // Schedule periodic refresh
      this.schedulePeriodicRefresh();
      
      this.logInfo(`Proactive cache management initialized: ${this.stats.totalDirectories} directories found`);
    } catch (error) {
      this.api.communication.logError(`Failed to initialize proactive cache management: ${error.message}`);
      throw error;
    }
  }

  /**
   * Discover season directories by scanning the configured root path
   */
  async discoverSeasonDirectories() {
    // Scan season directories (existing functionality)
    if (this.config.seasonsRootPath && this.config.seasonsRootPath.trim() !== '') {
      await this.scanSeasonDirectories();
    } else {
      this.logInfo("No seasons root path configured - skipping season directories");
    }
  }
  
  /**
   * Scan traditional season directories
   */
  async scanSeasonDirectories() {
    this.logInfo(`Scanning for season directories in: ${this.config.seasonsRootPath}`);
    
    try {
      const { checkDir, listDir } = await import('../../../server/src/actions.js');
      
      const rootExists = await checkDir(this.config.seasonsRootPath, this.applicationState);
      if (!rootExists) {
        this.api.communication.logWarning(`Seasons root path not found: ${this.config.seasonsRootPath}`);
        this.logInfo("Please verify the path exists and is accessible from the FTP server");
        return;
      }

      const entries = await listDir(this.config.seasonsRootPath, this.applicationState);
      
      if (!entries || entries.length === 0) {
        this.logInfo("No directories found in seasons root path");
        return;
      }
      
      for (const entry of entries) {
        if (entry.type !== 2) continue;
        
        const fullPath = `${this.config.seasonsRootPath}/${entry.name}`.replace(/\/+/g, '/');
        const seasonInfo = this.seasonParser.parseSeasonInfo(entry.name);
        
        if (seasonInfo && seasonInfo.isValid) {
          await this.scanSeasonDirectory(fullPath, seasonInfo);
        }
      }
      
      this.logInfo(`Season discovery complete: found ${this.discoveredSeasons.size} season directories`);
    } catch (error) {
      this.api.communication.logError(`Failed to discover season directories: ${error.message}`);
    }
  }
  

  /**
   * Scan a specific season directory for anime folders
   */
  async scanSeasonDirectory(seasonPath, seasonInfo) {
    try {
      // Use WeebSync's FTP functionality to scan season directory
      const { listDir } = await import('../../../server/src/actions.js');
      const entries = await listDir(seasonPath, this.applicationState);
      
      if (!entries || entries.length === 0) {
        this.logDebug(`No entries found in season directory: ${seasonPath}`);
        return;
      }
      
      const animeDirectories = [];
      
      for (const entry of entries) {
        if (entry.type === 2) { // Directory type in WeebSync
          animeDirectories.push({
            name: entry.name,
            fullPath: `${seasonPath}/${entry.name}`.replace(/\/+/g, '/'),
            cached: false,
            lastAttempt: null,
            failed: false
          });
        }
      }
      
      this.discoveredSeasons.set(seasonPath, {
        seasonInfo,
        directories: animeDirectories,
        lastScan: new Date(),
        cacheStatus: {
          total: animeDirectories.length,
          cached: 0,
          failed: 0,
          pending: animeDirectories.length
        }
      });
      
      // Add to warmup queue
      this.warmupQueue.push(...animeDirectories.map(dir => ({
        ...dir,
        seasonPath,
        seasonInfo
      })));
      
      this.stats.totalDirectories += animeDirectories.length;
      
      this.logDebug(`Scanned season ${seasonInfo.year}-${seasonInfo.seasonNumber} ${seasonInfo.seasonName}: ${animeDirectories.length} directories`);
    } catch (error) {
      this.api.communication.logError(`Failed to scan season directory ${seasonPath}: ${error.message}`);
    }
  }

  /**
   * Start background cache warming process with batch optimization
   */
  async startCacheWarming() {
    if (this.warmupActive || this.warmupQueue.length === 0) {
      return;
    }

    this.warmupActive = true;
    this.stats.lastWarmupStart = new Date();
    
    this.logInfo(`Starting cache warmup for ${this.warmupQueue.length} directories`);
    
    // Use batch optimization if available and enabled
    if (this.config.useBatchOptimization && this.anilistBatchClient) {
      await this.batchCacheWarming();
    } else {
      // Fallback to legacy individual processing
      await this.legacyCacheWarming();
    }
    
    this.warmupActive = false;
    this.stats.lastWarmupEnd = new Date();
    
    const duration = Math.round((this.stats.lastWarmupEnd - this.stats.lastWarmupStart) / 1000);
    this.logInfo(`Cache warmup completed in ${duration}s: ${this.stats.cachedDirectories} cached, ${this.stats.failedDirectories} failed`);
  }

  /**
   * Batch-optimized cache warming - processes multiple titles in single API calls
   */
  async batchCacheWarming() {
    this.logInfo(`[BATCH CACHE] Using batch optimization for ${this.warmupQueue.length} directories`);
    
    // Process in batches for optimal API usage
    const batchSize = this.config.batchCacheSize;
    let processedCount = 0;
    
    while (this.warmupQueue.length > 0 && this.warmupActive) {
      const batch = this.warmupQueue.splice(0, batchSize);
      processedCount += batch.length;
      
      this.logDebug(`[BATCH CACHE] Processing batch ${Math.ceil(processedCount/batchSize)} with ${batch.length} directories`);
      
      try {
        await this.processBatchWarming(batch);
      } catch (error) {
        this.logError(`[BATCH CACHE] Batch processing failed: ${error.message}`);
        // Fallback to individual processing for this batch
        for (const item of batch) {
          await this.warmupDirectory(item);
        }
      }
      
      // Intelligent delay between batches
      if (this.warmupQueue.length > 0) {
        const delay = Math.max(1000, this.config.warmupDelayMs * 0.5); // Shorter delay for batches
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Process a batch of directories for cache warming
   */
  async processBatchWarming(batch) {
    // Group by season context for better batch efficiency
    const seasonGroups = new Map();
    const nonSeasonItems = [];
    
    for (const item of batch) {
      if (item.seasonInfo) {
        const seasonKey = `${item.seasonInfo.year}-${item.seasonInfo.seasonName}`;
        if (!seasonGroups.has(seasonKey)) {
          seasonGroups.set(seasonKey, []);
        }
        seasonGroups.get(seasonKey).push(item);
      } else {
        nonSeasonItems.push(item);
      }
    }
    
    // Process season groups with context
    for (const [seasonKey, items] of seasonGroups) {
      await this.processBatchGroup(items, true);
    }
    
    // Process non-season items
    if (nonSeasonItems.length > 0) {
      await this.processBatchGroup(nonSeasonItems, false);
    }
  }

  /**
   * Process a group of items with same season context
   */
  async processBatchGroup(items, hasSeasonContext) {
    // Check cache for all items first
    const uncachedItems = [];
    let cacheHits = 0;
    
    for (const item of items) {
      const searchTitle = this.versionParser?.extractSearchTitle(item.name) || item.name;
      const existing = await this.cache.getAnimeByTitleWithMapping(searchTitle);
      
      if (existing && !this.cache.isExpired(existing.cachedAt)) {
        item.cached = true;
        this.updateSeasonStats(item.seasonPath, 'cached');
        this.logDebug(`[BATCH CACHE] Cache hit: ${item.name}`);
        cacheHits++;
      } else {
        uncachedItems.push({ ...item, searchTitle });
      }
    }
    
    if (uncachedItems.length === 0) {
      this.logDebug(`[BATCH CACHE] All ${items.length} items were cached`);
      return;
    }
    
    this.logDebug(`[BATCH CACHE] Cache hits: ${cacheHits}, need API calls: ${uncachedItems.length}`);
    
    // Prepare batch search
    const titles = uncachedItems.map(item => item.searchTitle);
    const seasonContext = hasSeasonContext && uncachedItems[0].seasonInfo ? uncachedItems[0].seasonInfo : null;
    
    try {
      // Execute batch search
      const batchResults = await this.anilistBatchClient.searchAnimeBatch(titles, seasonContext);
      
      // Process results
      let successCount = 0;
      for (const item of uncachedItems) {
        const results = batchResults[item.searchTitle];
        
        if (results && results.length > 0) {
          item.cached = true;
          this.stats.cachedDirectories++;
          this.updateSeasonStats(item.seasonPath, 'cached');
          this.logDebug(`[BATCH CACHE] Cached: ${item.name} → ${results[0].title?.romaji}`);
          successCount++;
        } else {
          item.failed = true;
          item.lastAttempt = new Date();
          this.stats.failedDirectories++;
          this.updateSeasonStats(item.seasonPath, 'failed');
          this.logDebug(`[BATCH CACHE] Failed: ${item.name}`);
        }
      }
      
      this.logInfo(`[BATCH CACHE] Batch completed: ${successCount}/${uncachedItems.length} successful (${cacheHits} from cache)`);
      
    } catch (error) {
      this.logError(`[BATCH CACHE] Batch search failed: ${error.message}`);
      // Mark all as failed
      for (const item of uncachedItems) {
        item.failed = true;
        item.lastAttempt = new Date();
        this.stats.failedDirectories++;
        this.updateSeasonStats(item.seasonPath, 'failed');
      }
    }
  }

  /**
   * Legacy cache warming for fallback
   */
  async legacyCacheWarming() {
    this.logInfo(`[LEGACY CACHE] Using individual requests for ${this.warmupQueue.length} directories`);
    
    // Process in small batches to avoid overwhelming the API
    while (this.warmupQueue.length > 0 && this.warmupActive) {
      const batch = this.warmupQueue.splice(0, this.config.warmupBatchSize);
      
      await Promise.all(batch.map(item => this.warmupDirectory(item)));
      
      // Delay between batches to respect rate limits
      if (this.warmupQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.warmupDelayMs));
      }
    }
  }

  /**
   * Warm up cache for a specific directory
   */
  async warmupDirectory(item) {
    try {
      // Extract search title using version parser for efficient caching
      const searchTitle = this.versionParser?.extractSearchTitle(item.name) || item.name;
      
      // Skip if already cached recently (use mapping-aware cache lookup)
      const existing = await this.cache.getAnimeByTitleWithMapping(searchTitle);
      if (existing && !this.cache.isExpired(existing.cachedAt)) {
        item.cached = true;
        this.updateSeasonStats(item.seasonPath, 'cached');
        this.logDebug(`Found cached metadata for: ${item.name} (search: ${searchTitle})`);
        return;
      }

      // Fetch metadata - use season context if available, otherwise generic search
      let results;
      if (item.seasonInfo) {
        results = await this.anilistClient.searchAnimeWithContext(searchTitle, item.seasonInfo);
      } else {
        // Generic search for non-season directories
        results = await this.anilistClient.searchAnime(searchTitle, 1);
      }
      
      if (results && results.length > 0) {
        item.cached = true;
        this.stats.cachedDirectories++;
        this.updateSeasonStats(item.seasonPath, 'cached');
        
        this.logDebug(`Cached metadata for: ${item.name}`);
      } else {
        item.failed = true;
        this.stats.failedDirectories++;
        this.updateSeasonStats(item.seasonPath, 'failed');
        
        this.logDebug(`No metadata found for: ${item.name}`);
      }
      
      item.lastAttempt = new Date();
    } catch (error) {
      item.failed = true;
      item.lastAttempt = new Date();
      this.stats.failedDirectories++;
      this.updateSeasonStats(item.seasonPath, 'failed');
      
      this.api.communication.logError(`Failed to cache metadata for ${item.name}: ${error.message}`);
    }
  }

  /**
   * Update statistics for a season directory
   */
  updateSeasonStats(seasonPath, action) {
    const seasonData = this.discoveredSeasons.get(seasonPath);
    if (!seasonData) return;
    
    if (action === 'cached') {
      seasonData.cacheStatus.cached++;
      seasonData.cacheStatus.pending--;
    } else if (action === 'failed') {
      seasonData.cacheStatus.failed++;
      seasonData.cacheStatus.pending--;
    }
  }

  /**
   * Schedule periodic cache refresh
   */
  schedulePeriodicRefresh() {
    if (this.refreshScheduler) {
      clearInterval(this.refreshScheduler);
    }
    
    const intervalMs = this.config.refreshIntervalHours * 60 * 60 * 1000;
    
    this.refreshScheduler = setInterval(async () => {
      await this.performPeriodicRefresh();
    }, intervalMs);
    
    this.logDebug(`Scheduled cache refresh every ${this.config.refreshIntervalHours} hours`);
  }

  /**
   * Perform periodic refresh of cache data
   */
  async performPeriodicRefresh() {
    if (this.warmupActive) {
      this.logDebug("Skipping periodic refresh: warmup in progress");
      return;
    }

    this.stats.lastRefresh = new Date();
    this.logInfo("Starting periodic cache refresh");
    
    try {
      // Re-discover new directories
      await this.discoverSeasonDirectories();
      
      // Refresh failed entries
      await this.retryFailedEntries();
      
      // Start cache warming for new/failed entries
      await this.startCacheWarming();
      
      this.logInfo("Periodic cache refresh completed");
    } catch (error) {
      this.api.communication.logError(`Periodic refresh failed: ${error.message}`);
    }
  }

  /**
   * Retry failed cache entries
   */
  async retryFailedEntries() {
    const failedEntries = [];
    
    for (const [seasonPath, seasonData] of this.discoveredSeasons) {
      for (const dir of seasonData.directories) {
        if (dir.failed && dir.lastAttempt) {
          // Retry if it's been more than 1 hour since last attempt
          const hoursSinceAttempt = (Date.now() - dir.lastAttempt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceAttempt >= 1) {
            dir.failed = false;
            failedEntries.push({
              ...dir,
              seasonPath,
              seasonInfo: seasonData.seasonInfo
            });
          }
        }
      }
    }
    
    if (failedEntries.length > 0) {
      this.logDebug(`Retrying ${failedEntries.length} failed entries`);
      this.warmupQueue.push(...failedEntries);
    }
  }

  /**
   * Get current status and statistics
   */
  getStatus() {
    const seasonSummary = [];
    for (const [seasonPath, seasonData] of this.discoveredSeasons) {
      seasonSummary.push({
        season: `${seasonData.seasonInfo.year}-${seasonData.seasonInfo.seasonNumber} ${seasonData.seasonInfo.seasonName}`,
        path: seasonPath,
        ...seasonData.cacheStatus,
        lastScan: seasonData.lastScan
      });
    }
    
    return {
      enabled: this.config.enabled,
      stats: this.stats,
      seasons: seasonSummary,
      warmup: {
        active: this.warmupActive,
        queueLength: this.warmupQueue.length
      },
      config: {
        seasonsRootPath: this.config.seasonsRootPath,
        refreshIntervalHours: this.config.refreshIntervalHours,
        warmupBatchSize: this.config.warmupBatchSize
      }
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Update debug logging if provided
    if (newConfig.debugLoggingEnabled !== undefined) {
      this.debugLoggingEnabled = newConfig.debugLoggingEnabled;
    }
    
    if (newConfig.refreshIntervalHours) {
      this.schedulePeriodicRefresh();
    }
    
    if (!newConfig.enabled && this.warmupActive) {
      this.warmupActive = false;
      this.warmupQueue = [];
    }
  }

  /**
   * Stop all proactive activities
   */
  stop() {
    this.warmupActive = false;
    this.warmupQueue = [];
    
    if (this.refreshScheduler) {
      clearInterval(this.refreshScheduler);
      this.refreshScheduler = null;
    }
    
    this.logInfo("Proactive cache management stopped");
  }

}