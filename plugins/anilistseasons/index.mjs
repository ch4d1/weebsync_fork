import { AniListClient } from "./src/anilist-client.mjs";
import { AniListBatchClient } from "./src/anilist-batch-client.mjs";
import { CacheManager } from "./src/cache-manager.mjs";
import { TitleNormalizer } from "./src/title-normalizer.mjs";
import { SeasonParser } from "./src/season-parser.mjs";
import { RateLimiter } from "./src/rate-limiter.mjs";
import { VersionParser } from "./src/version-parser.mjs";
import { ProactiveCacheManager } from "./src/proactive-cache-manager.mjs";

let anilistClient;
let anilistBatchClient;
let cacheManager;
let titleNormalizer;
let seasonParser;
let rateLimiter;
let versionParser;
let proactiveCacheManager;
let debugLoggingEnabled = false;
let batchOptimizationEnabled = true;

// Helper functions for debug logging
function logDebug(api, message) {
  if (debugLoggingEnabled) {
    api.communication.logInfo(`[DEBUG] ${message}`);
  }
}

function logInfo(api, message) {
  api.communication.logInfo(message);
}

async function register(api) {
  api.communication.logInfo("Initializing AniList Seasons plugin");
  
  try {
    // Initialize components with official AniList API limits
    const isAuthenticated = false; // Will be updated in onConfigUpdate based on OAuth config
    rateLimiter = new RateLimiter(isAuthenticated); // Uses official AniList limits: 90/min (unauthenticated) or 120/min (authenticated)
    
    // Get config directory from WeebSync (where other configs are stored)
    const configDir = process.env.WEEB_SYNC_CONFIG_DIR ?? `${process.cwd()}/config`;
    cacheManager = new CacheManager(api.thisPluginDirectory, configDir);
    
    titleNormalizer = new TitleNormalizer();
    seasonParser = new SeasonParser();
    versionParser = new VersionParser();
    
    // Load current configuration to initialize VersionParser with sourceMappings
    try {
      const fs = await import('fs');
      const configPath = `${configDir}/anilist-seasons-config.json`;
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const savedConfig = JSON.parse(configContent);
        if (savedConfig.sourceMappings) {
          logDebug(api, `Loading sourceMappings from saved config: ${JSON.stringify(savedConfig.sourceMappings)}`);
          versionParser.updateSourceMappings(savedConfig.sourceMappings);
          
          // Log loaded providers for verification
          const loadedProviders = Object.keys(versionParser.providers);
          logDebug(api, `Initialized VersionParser with ${loadedProviders.length} providers: ${loadedProviders.join(', ')}`);
        }
      }
    } catch (error) {
      logDebug(api, `Could not load saved config for VersionParser initialization: ${error.message}`);
    }
    
    // Initialize AniListClient with default config (will be updated in onConfigUpdate)
    anilistClient = new AniListClient(rateLimiter, cacheManager, versionParser, {});
    
    // Initialize Batch Client for optimized requests
    anilistBatchClient = new AniListBatchClient(rateLimiter, cacheManager, versionParser, {
      batch: {
        maxBatchSize: 15,
        optimalBatchSize: 10,
        perPage: 5
      }
    });
    
    // Initialize cache
    await cacheManager.initialize();
    
    // Perform cache migration to mapping structure if needed
    try {
      logDebug(api, "Checking for cache migration to mapping structure...");
      const migrationResult = await cacheManager.migrateToMappingStructure(versionParser);
      if (migrationResult.migratedCount > 0 || migrationResult.removedCount > 0) {
        logDebug(api, `Cache migration completed: ${migrationResult.migratedCount} migrated, ${migrationResult.removedCount} removed`);
      } else {
        logDebug(api, "No cache migration needed");
      }
    } catch (error) {
      api.communication.logError(`Cache migration failed: ${error.message}`);
    }
    
    // Initialize proactive cache manager (will be configured in onConfigUpdate)
    proactiveCacheManager = new ProactiveCacheManager(
      anilistClient, 
      cacheManager, 
      seasonParser,
      versionParser, 
      api,
      api.applicationState,
      { enabled: true }, // Enabled by default, can be disabled via config
      anilistBatchClient
    );
    
    // Register enhanced Socket.io event handlers
    await registerSocketHandlers(api);
    
    api.communication.logInfo("AniList Seasons plugin initialized successfully");
  } catch (error) {
    api.communication.logError(`Failed to initialize AniList Seasons plugin: ${error.message}`);
    throw error;
  }
}

async function registerSocketHandlers(api) {
  logDebug(api, "Registering Socket.io handlers for AniList Seasons plugin");
  
  // Register enhanced listDir with anime metadata
  if (api.communication.io) {
    logDebug(api, "Socket.io server found, registering listDirWithAnimeMetadata handler");
    
    api.communication.io.on('connection', (socket) => {
      logDebug(api, "New socket connection, registering listDirWithAnimeMetadata handler");
      
      socket.on('listDirWithAnimeMetadata', async (path, cb) => {
        logDebug(api, `listDirWithAnimeMetadata called with path: ${path}`);
        
        try {
          // First get regular directory listing
          const { listDir } = await import('../../server/src/actions.js');
          const regularListing = await listDir(path, api.applicationState);
          
          // Add full paths to directory items
          if (regularListing) {
            for (const item of regularListing) {
              if (item.type === 2) { // Directory
                item.path = `${path}/${item.name}`.replace(/\/+/g, '/'); // Normalize path
              }
            }
          }
          
          if (!regularListing || regularListing.length === 0) {
            logDebug(api, `No files found in directory: ${path}`);
            return cb(path, []);
          }
          
          logDebug(api, `Found ${regularListing.length} items in directory`);
          
          // Check if this looks like a season directory or additional anime directory
          if (isSeasonDirectory(path)) {
            // Determine the type for better logging
            const pathParts = path.split('/');
            const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
            const seasonInfo = seasonParser.parseSeasonInfo(dirName);
            const isTraditionalSeason = seasonInfo && seasonInfo.isValid;
            
            if (isTraditionalSeason) {
              logDebug(api, `Processing traditional season directory: ${path} (${regularListing.length} items)`);
            } else {
              logDebug(api, `Processing additional anime directory: ${path} (${regularListing.length} items)`);
            }
            
            // Process all items with version info
            const quickEnhanced = await quickEnhanceWithVersionInfo(regularListing, api);
            cb(path, quickEnhanced);
            
            // Then enhance with metadata asynchronously
            enhanceWithAnimeMetadataAsync(regularListing, path, api, socket).catch(error => {
              api.communication.logError(`Async enhancement failed: ${error.message}`);
            });
            
            // ALWAYS scan episodes separately after metadata (never cache episode counts)
            scanEpisodesForAllItems(regularListing, path, api, socket).catch(error => {
              api.communication.logError(`Episode scanning failed: ${error.message}`);
            });
          } else {
            logDebug(api, `Not a season or anime directory: ${path}`);
            // Return regular listing for non-season directories
            cb(path, regularListing);
          }
        } catch (error) {
          api.communication.logError(`Error in listDirWithAnimeMetadata: ${error.message}`);
          cb(path, []); // Fallback to empty listing
        }
      });
      
      // Handler for loading more items in paginated directories
      socket.on('loadMoreItems', async (data, cb) => {
        const { path, currentCount } = data;
        logDebug(api, `loadMoreItems called for path: ${path}, currentCount: ${currentCount}`);
        
        try {
          const paginationData = socket._paginationData?.[path];
          if (!paginationData) {
            return cb({ error: 'No pagination data found for path' });
          }
          
          const { remainingItems, batchSize, totalItems } = paginationData;
          const nextBatch = remainingItems.slice(0, batchSize);
          
          if (nextBatch.length === 0) {
            return cb({ items: [], hasMore: false, loadedItems: totalItems });
          }
          
          // Process next batch with version info
          const processedBatch = await quickEnhanceWithVersionInfo(nextBatch, api, true);
          
          // Add pagination info
          const paginatedBatch = processedBatch.map(item => ({
            ...item,
            isPaginated: true,
            totalItems: totalItems,
            loadedItems: currentCount + nextBatch.length
          }));
          
          // Update remaining items
          paginationData.remainingItems = remainingItems.slice(batchSize);
          const hasMore = paginationData.remainingItems.length > 0;
          
          cb({
            items: paginatedBatch,
            hasMore: hasMore,
            loadedItems: currentCount + nextBatch.length,
            totalItems: totalItems
          });
          
          // Start background metadata enhancement for this batch
          enhanceWithAnimeMetadataAsync(nextBatch, path, api, socket).catch(error => {
            api.communication.logError(`Async enhancement failed for batch: ${error.message}`);
          });
          
        } catch (error) {
          api.communication.logError(`Error in loadMoreItems: ${error.message}`);
          cb({ error: error.message });
        }
      });
      
      // Handler for loading all remaining items at once
      socket.on('loadAllItems', async (data, cb) => {
        const { path } = data;
        logDebug(api, `loadAllItems called for path: ${path}`);
        
        try {
          const paginationData = socket._paginationData?.[path];
          if (!paginationData) {
            return cb({ error: 'No pagination data found for path' });
          }
          
          const { remainingItems, totalItems } = paginationData;
          
          if (remainingItems.length === 0) {
            return cb({ items: [], totalItems: totalItems });
          }
          
          // Process all remaining items at once
          const processedItems = await quickEnhanceWithVersionInfo(remainingItems, api, true);
          
          // Add pagination info
          const paginatedItems = processedItems.map(item => ({
            ...item,
            isPaginated: true,
            totalItems: totalItems,
            loadedItems: totalItems
          }));
          
          // Clear remaining items since we've loaded everything
          paginationData.remainingItems = [];
          
          cb({
            items: paginatedItems,
            totalItems: totalItems
          });
          
          // Start background metadata enhancement for all items
          enhanceWithAnimeMetadataAsync(remainingItems, path, api, socket).catch(error => {
            api.communication.logError(`Async enhancement failed for all items: ${error.message}`);
          });
          
        } catch (error) {
          api.communication.logError(`Error in loadAllItems: ${error.message}`);
          cb({ error: error.message });
        }
      });
    });
  } else {
    api.communication.logError("Socket.io server not found in api.communication.io");
  }
}

// Quick enhancement with just version info (no API calls)
async function quickEnhanceWithVersionInfo(fileList, api, isPaginated = false) {
  try {
    const animeDirectories = fileList.filter(f => f.type === 2);
    const nonDirectories = fileList.filter(f => f.type !== 2);
    
    // Group directories by base title
    const titleGroups = new Map();
    
    for (const dir of animeDirectories) {
      const versionInfo = versionParser.parseVersionInfo(dir.name);
      const searchTitle = versionParser.extractSearchTitle(dir.name);
      
      // Enhanced directory with version info
      const enhancedDir = {
        ...dir,
        versionInfo: versionInfo,
        versionDescription: versionParser.generateVersionDescription(versionInfo),
        searchTitle: searchTitle,
        isProcessing: true // Flag to show loading state in UI
      };
      
      // Group by search title
      if (!titleGroups.has(searchTitle)) {
        titleGroups.set(searchTitle, []);
      }
      titleGroups.get(searchTitle).push(enhancedDir);
    }
    
    // Convert groups to result array
    const grouped = [];
    for (const [title, versions] of titleGroups) {
      // Always create grouped entry (even for single versions) to ensure consistent modal behavior
      grouped.push({
        name: title,
        path: `/GROUPED/${title}`, // Special grouped path - not a real directory
        type: 2, // Directory
        isGrouped: true,
        versions: versions,
        versionCount: versions.length,
        primaryVersion: versions[0],
        isProcessing: true,
        searchTitle: title,
        isSingleVersion: versions.length === 1 // Flag to indicate single version
      });
      logDebug(api, `${versions.length === 1 ? 'Single version' : `Grouped ${versions.length} versions`} of "${title}"`);
    }
    
    const singleVersions = grouped.filter(g => g.isGrouped && g.isSingleVersion).length;
    const multiVersions = grouped.filter(g => g.isGrouped && !g.isSingleVersion).length;
    logDebug(api, `Quick grouping: ${titleGroups.size} unique titles, ${singleVersions} single versions, ${multiVersions} multi-version groups`);
    
    return [...grouped, ...nonDirectories];
  } catch (error) {
    api.communication.logError(`Quick enhance failed: ${error.message}`);
    return fileList;
  }
}

// Async enhancement with metadata from cache/API
async function enhanceWithAnimeMetadataAsync(fileList, seasonPath, api, socket) {
  try {
    logDebug(api, `Starting async metadata enhancement for ${fileList.length} items`);
    
    // Parse season context from path for better matching
    const seasonContext = getSeasonContextFromPath(seasonPath);
    if (seasonContext) {
      logDebug(api, `Season context: ${seasonContext.year} ${seasonContext.seasonName}`);
    }
    
    // Extract unique search titles from both grouped and single items
    const uniqueTitles = new Set();
    const titleToItems = new Map();
    
    // Process the already grouped/enhanced structure  
    for (const item of fileList) {
      if (item.type === 2) { // Directory
        let searchTitle;
        
        if (item.isGrouped) {
          // Grouped anime - use the searchTitle
          searchTitle = item.searchTitle || item.name;
          titleToItems.set(searchTitle, item);
        } else if (item.searchTitle) {
          // Single anime with searchTitle
          searchTitle = item.searchTitle;
          titleToItems.set(searchTitle, item);
        } else {
          // Fallback: extract search title from name
          searchTitle = versionParser.extractSearchTitle(item.name);
          if (searchTitle) {
            titleToItems.set(searchTitle, item);
          } else {
            // Final fallback: use the item name as search title
            searchTitle = item.name;
            titleToItems.set(searchTitle, item);
          }
        }
        
        if (searchTitle) {
          uniqueTitles.add(searchTitle);
        }
      }
    }
    
    logDebug(api, `Processing ${uniqueTitles.size} unique anime titles`);
    
    const titles = Array.from(uniqueTitles);
    const cachedTitles = [];
    const uncachedTitles = [];
    
    // Phase 1: Separate cached vs uncached titles
    for (const searchTitle of titles) {
      try {
        const metadata = await cacheManager.getAnimeByTitleWithMapping(searchTitle);
        if (metadata && !cacheManager.isExpired(metadata.cachedAt)) {
          cachedTitles.push(searchTitle);
        } else {
          uncachedTitles.push(searchTitle);
        }
      } catch (error) {
        uncachedTitles.push(searchTitle);
      }
    }
    
    logDebug(api, `Found ${cachedTitles.length} cached and ${uncachedTitles.length} uncached titles`);
    
    // Immediate UI feedback: Send initial status update
    if (cachedTitles.length > 0 && socket) {
      socket.emit('animeMetadataStatus', {
        path: seasonPath,
        status: 'loading_cached',
        cachedCount: cachedTitles.length,
        uncachedCount: uncachedTitles.length
      });
    }
    
    // Phase 2: Process cached data immediately in larger batches (Context7 best practice: immediate feedback)
    const cachedBatchSize = 20; // Larger batches for cached data
    for (let i = 0; i < cachedTitles.length; i += cachedBatchSize) {
      const cachedBatch = cachedTitles.slice(i, i + cachedBatchSize);
      const cachedUpdates = [];
      
      for (const searchTitle of cachedBatch) {
        try {
          const metadata = await cacheManager.getAnimeByTitleWithMapping(searchTitle);
          
          // Skip if no metadata found
          if (!metadata || !metadata.metadata || !Array.isArray(metadata.metadata) || metadata.metadata.length === 0) {
            logDebug(api, `No cached metadata found for: ${searchTitle}`);
            continue;
          }
          
          let cachedAnime = metadata.metadata[0];
          
          // If we have season context, try to find better match in cached results
          if (seasonContext && metadata.metadata.length > 1) {
            const seasonMatch = metadata.metadata.find(anime => 
              anilistClient.matchesSeasonContext(anime, seasonContext)
            );
            if (seasonMatch) {
              cachedAnime = seasonMatch;
              logDebug(api, `Found season match in cache for "${searchTitle}": ${seasonMatch.title?.romaji || 'Unknown'} (${seasonMatch.seasonYear} ${seasonMatch.season})`);
            }
          }
          
          // Scan directory for actual episode count if possible
          let actualEpisodes = cachedAnime.episodes;
          try {
            logDebug(api, `Starting episode scan for cached item: ${searchTitle}`);
            // Find the corresponding item in our processed fileList to access versions
            const correspondingItem = titleToItems.get(searchTitle);
            logDebug(api, `Found corresponding item for ${searchTitle}: ${correspondingItem ? 'YES' : 'NO'}`);
            if (correspondingItem) {
              if (correspondingItem.isGrouped && correspondingItem.versions) {
                logDebug(api, `Scanning ${correspondingItem.versions.length} grouped versions for: ${searchTitle}`);
                // For grouped anime, scan all versions and take the maximum episode count
                let maxEpisodes = 0;
                for (const version of correspondingItem.versions) {
                  const episodeCount = await scanEpisodeCount(api, version, seasonPath);
                  if (episodeCount && episodeCount > maxEpisodes) {
                    maxEpisodes = episodeCount;
                  }
                }
                if (maxEpisodes > 0) {
                  actualEpisodes = maxEpisodes;
                  logDebug(api, `Found max ${maxEpisodes} episodes across ${correspondingItem.versions.length} versions: ${searchTitle} (cached)`);
                }
              } else {
                logDebug(api, `Scanning single version for: ${searchTitle}`);
                // For single anime, scan directly
                const episodeCount = await scanEpisodeCount(api, correspondingItem, seasonPath);
                if (episodeCount && episodeCount > 0) {
                  actualEpisodes = episodeCount;
                  logDebug(api, `Found ${episodeCount} episodes in directory: ${searchTitle} (cached)`);
                }
              }
            } else {
              logDebug(api, `No corresponding item found for ${searchTitle} in titleToItems map`);
            }
          } catch (error) {
            logDebug(api, `Failed to scan episodes for ${searchTitle}: ${error.message}`);
          }
          
          // Normalize cached data to match expected format (WITHOUT episode data from cache)
          const normalizedMetadata = {
            title: cachedAnime.title?.english || cachedAnime.title?.romaji || searchTitle,
            coverImage: cachedAnime.coverImage?.extraLarge || cachedAnime.coverImage?.large || cachedAnime.coverImage?.medium || cachedAnime.coverImage,
            coverImageExtraLarge: cachedAnime.coverImage?.extraLarge,
            coverImageLarge: cachedAnime.coverImage?.large || cachedAnime.coverImage?.extraLarge || cachedAnime.coverImage?.medium || cachedAnime.coverImage,
            coverImageMedium: cachedAnime.coverImage?.medium || cachedAnime.coverImage?.large || cachedAnime.coverImage?.extraLarge || cachedAnime.coverImage,
            coverImageSmall: cachedAnime.coverImage?.medium || cachedAnime.coverImage?.large || cachedAnime.coverImage?.extraLarge || cachedAnime.coverImage,
            coverImageColor: cachedAnime.coverImage?.color,
            genres: cachedAnime.genres || [],
            averageScore: cachedAnime.averageScore,
            description: cachedAnime.description,
            episodes: actualEpisodes, // Use live-scanned episodes as primary count
            totalEpisodes: cachedAnime.episodes, // Keep original AniList total episodes
            scannedEpisodes: actualEpisodes !== cachedAnime.episodes ? actualEpisodes : null, // Only set if different from AniList
            status: cachedAnime.status,
            season: cachedAnime.season,
            seasonYear: cachedAnime.seasonYear,
            id: cachedAnime.id,
            subtitle: (cachedAnime.title?.english && cachedAnime.title?.romaji && 
                      cachedAnime.title.english !== cachedAnime.title.romaji) 
                      ? cachedAnime.title.romaji : null
          };
          
          logDebug(api, `Using cached metadata for: ${searchTitle}`);
          cachedUpdates.push({
            searchTitle: searchTitle,
            metadata: normalizedMetadata
          });
        } catch (error) {
          api.communication.logError(`Failed to process cached ${searchTitle}: ${error.message}`);
        }
      }
      
      // Send cached updates immediately (Context7: immediate response for cached data)
      if (cachedUpdates.length > 0) {
        logDebug(api, `Sent metadata update for ${cachedUpdates.length} cached items`);
        socket?.emit('animeMetadataUpdate', {
          path: seasonPath,
          updates: cachedUpdates,
          isCached: true, // Flag to indicate these are instant cached results
          remaining: Math.max(0, cachedTitles.length - (i + cachedBatchSize)) + uncachedTitles.length
        });
      }
      
      // Micro-delay to prevent UI blocking (Context7: chunked processing)
      if (i + cachedBatchSize < cachedTitles.length) {
        await new Promise(resolve => setTimeout(resolve, 10)); // 10ms micro-delay
      }
    }
    
    // Signal transition to API phase
    if (uncachedTitles.length > 0 && socket) {
      socket.emit('animeMetadataStatus', {
        path: seasonPath,
        status: 'loading_api',
        remaining: uncachedTitles.length
      });
    }
    
    // Phase 3: Process uncached data in smaller batches with API calls (Context7: progressive loading)
    const apiBatchSize = 3; // Smaller batches for API calls to respect rate limits
    for (let i = 0; i < uncachedTitles.length; i += apiBatchSize) {
      const apiBatch = uncachedTitles.slice(i, i + apiBatchSize);
      const apiUpdates = [];
      
      for (const searchTitle of apiBatch) {
        try {
          // Fetch from API with season context for better matching
          logDebug(api, `Fetching metadata for: "${searchTitle}"${seasonContext ? ` (${seasonContext.year} ${seasonContext.seasonName})` : ''}`);
          const results = await anilistClient.searchAnimeWithContext(searchTitle, seasonContext);
          let metadata = null;
            
          if (results && results.length > 0) {
            // Find best match considering season context
            const bestMatch = anilistClient.findBestMatch(results, searchTitle, seasonContext);
            const anime = bestMatch || results[0];
            
            // Scan directory for actual episode count if possible
            let actualEpisodes = anime.episodes;
            try {
              // Find the corresponding item in our processed fileList to access versions
              const correspondingItem = titleToItems.get(searchTitle);
              if (correspondingItem) {
                if (correspondingItem.isGrouped && correspondingItem.versions) {
                  // For grouped anime, scan all versions and take the maximum episode count
                  let maxEpisodes = 0;
                  for (const version of correspondingItem.versions) {
                    const episodeCount = await scanEpisodeCount(api, version, seasonPath);
                    if (episodeCount && episodeCount > maxEpisodes) {
                      maxEpisodes = episodeCount;
                    }
                  }
                  if (maxEpisodes > 0) {
                    actualEpisodes = maxEpisodes;
                    logDebug(api, `Found max ${maxEpisodes} episodes across ${correspondingItem.versions.length} versions: ${searchTitle}`);
                  }
                } else {
                  // For single anime, scan directly
                  const episodeCount = await scanEpisodeCount(api, correspondingItem, seasonPath);
                  if (episodeCount && episodeCount > 0) {
                    actualEpisodes = episodeCount;
                    logDebug(api, `Found ${episodeCount} episodes in directory: ${searchTitle}`);
                  }
                }
              }
            } catch (error) {
              logDebug(api, `Failed to scan episodes for ${searchTitle}: ${error.message}`);
            }
            
            metadata = {
              title: anime.title?.english || anime.title?.romaji || searchTitle,
              coverImage: anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium || anime.coverImage,
              coverImageExtraLarge: anime.coverImage?.extraLarge,
              coverImageLarge: anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage?.medium || anime.coverImage,
              coverImageMedium: anime.coverImage?.medium || anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage,
              coverImageSmall: anime.coverImage?.medium || anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage,
              coverImageColor: anime.coverImage?.color,
              genres: anime.genres || [],
              averageScore: anime.averageScore,
              description: anime.description,
              episodes: actualEpisodes, // Use scanned episodes as primary count
              totalEpisodes: anime.episodes, // Keep original AniList total episodes  
              scannedEpisodes: actualEpisodes !== anime.episodes ? actualEpisodes : null, // Only set if different from AniList
              status: anime.status,
              season: anime.season,
              seasonYear: anime.seasonYear,
              id: anime.id,
              // Add subtitle (romaji title) if different from main title
              subtitle: (anime.title?.english && anime.title?.romaji && 
                        anime.title.english !== anime.title.romaji) 
                        ? anime.title.romaji : null
            };
            
            // Save to cache
            await cacheManager.saveAnimeMetadata(searchTitle, [anime]);
            logDebug(api, `Cached metadata for: ${metadata.title}`);
          } else {
            // No results found - this will be sent as null metadata to mark as failed
            logDebug(api, `No metadata found for: "${searchTitle}"`);
            metadata = null;
          }
          
          // Add to API updates
          apiUpdates.push({
            searchTitle: searchTitle,
            metadata: metadata
          });
        } catch (error) {
          api.communication.logError(`Failed to fetch API data for ${searchTitle}: ${error.message}`);
          // Still add as failed update
          apiUpdates.push({
            searchTitle: searchTitle,
            metadata: null
          });
        }
      }
      
      // Send API batch updates with progress information
      if (apiUpdates.length > 0) {
        logDebug(api, `Sent metadata update for ${apiUpdates.length} API items`);
        socket?.emit('animeMetadataUpdate', {
          path: seasonPath,
          updates: apiUpdates,
          isCached: false, // Flag to indicate these required API calls
          remaining: Math.max(0, uncachedTitles.length - (i + apiBatchSize)),
          progress: {
            completed: i + apiUpdates.length,
            total: uncachedTitles.length,
            percentage: Math.round(((i + apiUpdates.length) / uncachedTitles.length) * 100)
          }
        });
      }
      
      // Rate limiting between API batches (more aggressive for API calls)
      if (i + apiBatchSize < uncachedTitles.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between API batches
      }
    }
    
    // Final completion signal (Context7: clear completion state)
    if (socket) {
      socket.emit('animeMetadataStatus', {
        path: seasonPath,
        status: 'completed',
        totalProcessed: cachedTitles.length + uncachedTitles.length,
        cached: cachedTitles.length,
        fromApi: uncachedTitles.length
      });
    }
    
    logDebug(api, `Metadata loading complete: ${cachedTitles.length} cached + ${uncachedTitles.length} from API`);
  } catch (error) {
    api.communication.logError(`Async enhancement error: ${error.message}`);
  }
}

// Separate episode scanning function that ALWAYS scans FTP episodes (never cached)
async function scanEpisodesForAllItems(fileList, seasonPath, api, socket) {
  try {
    logDebug(api, `Starting LIVE episode scanning for ${fileList.length} items`);
    
    const episodeUpdates = [];
    
    for (const item of fileList) {
      if (item.type === 2) { // Directory only
        try {
          let searchTitle = item.searchTitle || item.name;
          logDebug(api, `Scanning episodes for: ${searchTitle}`);
          
          let scannedEpisodes = 0;
          
          if (item.isGrouped && item.versions) {
            // For grouped anime, scan all versions and take maximum episode count
            logDebug(api, `Scanning ${item.versions.length} versions for grouped anime: ${searchTitle}`);
            let maxEpisodes = 0;
            for (const version of item.versions) {
              const episodeCount = await scanEpisodeCount(api, version, seasonPath);
              if (episodeCount && episodeCount > maxEpisodes) {
                maxEpisodes = episodeCount;
              }
            }
            scannedEpisodes = maxEpisodes;
            logDebug(api, `Max episodes found across versions: ${maxEpisodes} for ${searchTitle}`);
          } else {
            // For single anime, scan directly
            const episodeCount = await scanEpisodeCount(api, item, seasonPath);
            scannedEpisodes = episodeCount || 0;
            logDebug(api, `Episodes found: ${scannedEpisodes} for ${searchTitle}`);
          }
          
          if (scannedEpisodes > 0) {
            episodeUpdates.push({
              searchTitle: searchTitle,
              scannedEpisodes: scannedEpisodes
            });
          }
        } catch (error) {
          logDebug(api, `Failed to scan episodes for ${item.name}: ${error.message}`);
        }
      }
    }
    
    // Send episode updates to frontend
    if (episodeUpdates.length > 0 && socket) {
      logDebug(api, `Sending episode updates for ${episodeUpdates.length} items`);
      socket.emit('episodeCountUpdate', {
        path: seasonPath,
        updates: episodeUpdates
      });
    }
    
  } catch (error) {
    api.communication.logError(`Episode scanning error: ${error.message}`);
  }
}

function isSeasonDirectory(path) {
  // Check if path matches season directory pattern
  const seasonPatterns = [
    /\d{4}-\d+\s+(Season|Winter|Spring|Summer|Fall)/i,  // 2025-1 Winter
    /\d{4}-\d+(Winter|Spring|Summer|Fall)/i,            // 2025-1Winter (no space)
    /Season\s+\d+/i,                                    // Season 1, Season 2, etc.
    /(Winter|Spring|Summer|Fall)\s+\d{4}/i,             // Winter 2025, etc.
    /\d{4}\s+(Winter|Spring|Summer|Fall)/i,             // 2025 Winter
  ];
  
  return seasonPatterns.some(pattern => pattern.test(path)) || 
         path.includes('Season') || 
         path.includes('Winter') || 
         path.includes('Spring') || 
         path.includes('Summer') || 
         path.includes('Fall');
}

// Extract season context from path for enhanced matching
function getSeasonContextFromPath(path) {
  const pathParts = path.split('/').filter(part => part.length > 0);
  
  // Check each path component for season info
  for (const part of pathParts) {
    const seasonInfo = seasonParser.parseSeasonInfo(part);
    if (seasonInfo && seasonInfo.isValid) {
      return seasonInfo;
    }
  }
  
  return null;
}


async function onConfigUpdate(api, config) {
  if (!config.enablePlugin) {
    api.communication.logInfo("AniList Seasons plugin disabled");
    return;
  }
  
  try {
    // Update debug logging flag
    debugLoggingEnabled = config.enableDebugLogging || false;
    logDebug(api, `Debug logging ${debugLoggingEnabled ? 'enabled' : 'disabled'}`);
    
    // Update batch optimization settings
    batchOptimizationEnabled = config.enableBatchOptimization !== undefined ? config.enableBatchOptimization : true;
    const batchSize = Math.max(5, Math.min(15, config.batchSize || 10)); // Clamp between 5-15
    
    if (anilistBatchClient) {
      anilistBatchClient.batchConfig.optimalBatchSize = batchSize;
      anilistBatchClient.batchConfig.maxBatchSize = Math.min(15, batchSize + 5);
    }
    
    logDebug(api, `Batch optimization ${batchOptimizationEnabled ? 'enabled' : 'disabled'} (batch size: ${batchSize}`);
    logDebug(api, `Updating configuration with batch optimization: ${batchOptimizationEnabled}, size: ${batchSize}`);
    // Update rate limiter based on authentication status (not user config)
    if (rateLimiter) {
      const isAuthenticated = config.enableOAuth && config.clientId && config.clientSecret;
      const officialLimit = isAuthenticated ? 120 : 90; // Official AniList API limits
      rateLimiter.updateLimit(officialLimit);
      
      logDebug(api, `Rate limit updated to ${officialLimit}/min (${isAuthenticated ? 'authenticated' : 'unauthenticated'})`);
    }
    
    // Update cache settings
    if (cacheManager && config.cacheExpirationDays) {
      cacheManager.updateExpirationDays(config.cacheExpirationDays);
    }
    
    // Update OAuth configuration
    if (anilistClient) {
      anilistClient.updateConfig({
        enableOAuth: config.enableOAuth || false,
        clientId: config.clientId || '',
        clientSecret: config.clientSecret || '',
        redirectUri: config.redirectUri || 'http://localhost:3000/callback'
      });
      
      if (config.enableOAuth) {
        if (config.clientId && config.clientSecret && config.redirectUri) {
          // Generate OAuth URL for user to get authorization code
          try {
            const oauthUrl = anilistClient.getOAuthUrl();
            logDebug(api, `OAuth configured. Authorization URL: ${oauthUrl}`);
            logDebug(api, `After authorization, exchange the code for an access token using AniList API`);
          } catch (error) {
            api.communication.logError(`Failed to generate OAuth URL: ${error.message}`);
          }
        } else {
          api.communication.logError("OAuth enabled but missing Client ID, Client Secret, or Redirect URI");
        }
      }
    }
    
    // Update proactive cache management
    if (proactiveCacheManager) {
      const proactiveConfig = {
        enabled: config.enableProactiveCache !== undefined ? config.enableProactiveCache : true, // Default to enabled
        seasonsRootPath: config.seasonsRootPath || '', // No default path - must be configured
        warmupBatchSize: config.warmupBatchSize || 5,
        warmupDelayMs: config.warmupDelayMs || 2000,
        refreshIntervalHours: config.refreshIntervalHours || 6,
        maxConcurrentRequests: config.maxConcurrentRequests || 3,
        debugLoggingEnabled: debugLoggingEnabled
      };
      
      proactiveCacheManager.updateConfig(proactiveConfig);
      
      // Initialize proactive caching if enabled
      if (proactiveConfig.enabled) {
        await proactiveCacheManager.initialize();
      } else {
        proactiveCacheManager.stop();
      }
    }
    
    // Update source mappings in TitleNormalizer
    if (titleNormalizer && config.sourceMappings) {
      // Convert array to string format for TitleNormalizer if needed
      let titleNormalizerMappings = config.sourceMappings;
      if (Array.isArray(config.sourceMappings)) {
        titleNormalizerMappings = config.sourceMappings.join(',');
      }
      titleNormalizer.updateSourceMappings(titleNormalizerMappings);
    }
    
    // Update source mappings in VersionParser
    if (versionParser && config.sourceMappings) {
      logDebug(api, `Updating VersionParser with sourceMappings type: ${typeof config.sourceMappings}, value: ${JSON.stringify(config.sourceMappings)}`);
      
      // Convert string-based config to array if needed (migration support)
      let sourceMappings = config.sourceMappings;
      if (typeof sourceMappings === 'string' && sourceMappings.trim() !== '') {
        logDebug(api, `Converting string-based sourceMappings to array format`);
        sourceMappings = sourceMappings.split(',').map(s => s.trim()).filter(s => s.includes('='));
      }
      
      versionParser.updateSourceMappings(sourceMappings);
      
      // Debug: Log the loaded providers
      const loadedProviders = Object.keys(versionParser.providers);
      logDebug(api, `Loaded providers in VersionParser: ${loadedProviders.join(', ')}`);
      if (loadedProviders.length > 0) {
        const firstProvider = versionParser.providers[loadedProviders[0]];
        logDebug(api, `Example provider ${loadedProviders[0]}: name="${firstProvider.name}", color="${firstProvider.color}"`);
      }
    }

    // Store config globally for getFtpViewComponents
    if (typeof global !== 'undefined') {
      global.anilistPluginConfig = {
        ...global.anilistPluginConfig,
        sourceMappings: config.sourceMappings || []
      };
    }
    
    logDebug(api, "AniList Seasons plugin configuration updated");
  } catch (error) {
    api.communication.logError(`Failed to update AniList Seasons plugin config: ${error.message}`);
  }
}

async function onDispose(api) {
  try {
    // Stop proactive cache management
    if (proactiveCacheManager) {
      proactiveCacheManager.stop();
    }
    
    api.communication.logInfo("AniList Seasons plugin disposed");
  } catch (error) {
    api.communication.logError(`Failed to dispose AniList Seasons plugin: ${error.message}`);
  }
}

// Enhanced metadata function for FTP View Components with Batch Optimization
async function enhanceWithAnimeMetadata(items, path) {
  // Use batch optimization if enabled for ANY number of directories
  const directories = items.filter(item => item.type === 2 || item.isDir);
  
  if (batchOptimizationEnabled && directories.length > 0) {
    return await enhanceWithAnimeMetadataBatch(items, path);
  }
  
  // Fallback to legacy method only when batch is explicitly disabled
  return await enhanceWithAnimeMetadataLegacy(items, path);
}

// New batch-optimized metadata enhancement function
async function enhanceWithAnimeMetadataBatch(items, path) {
  try {
    // Filter directories and non-directories
    const directories = items.filter(item => item.type === 2 || item.isDir);
    const nonDirectories = items.filter(item => item.type !== 2 && !item.isDir);
    
    if (directories.length === 0) {
      return items;
    }
    
    const startTime = Date.now();
    
    // Determine if this is a season directory for context
    const pathParts = path.split('/');
    const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
    const seasonInfo = seasonParser ? seasonParser.parseSeasonInfo(dirName) : null;
    const seasonContext = seasonInfo && seasonInfo.isValid ? seasonInfo : null;
    
    
    // Process directories with version grouping
    const grouped = versionParser.groupByAnimeTitle(directories);
    
    // Extract titles for batch search
    const titlesToSearch = grouped.map(group => group.searchTitle);
    
    // Perform batch search
    const batchResults = await anilistBatchClient.searchAnimeBatch(titlesToSearch, seasonContext);
    
    // Apply results to grouped directories
    const enhancedDirectories = [];
    let metadataFound = 0;
    
    for (const group of grouped) {
      const searchTitle = group.searchTitle;
      const searchResults = batchResults[searchTitle] || [];
      
      if (searchResults.length > 0) {
        // Find best match considering season context
        let bestMatch;
        if (seasonContext) {
          bestMatch = searchResults.find(anime => 
            anilistBatchClient.matchesSeasonContext(anime, seasonContext)
          ) || searchResults[0];
        } else {
          bestMatch = searchResults[0];
        }
        
        if (bestMatch) {
          metadataFound++;
          
          // Apply metadata to all directories in the group
          for (const dir of group.directories) {
            enhancedDirectories.push({
              ...dir,
              animeMetadata: bestMatch,
              searchTitle: searchTitle,
              versionGroup: group.directories.length > 1,
              versionCount: group.directories.length,
              matchScore: bestMatch.matchScore,
              seasonMatch: bestMatch.seasonMatch || false,
              isEnhanced: true
            });
          }
        } else {
          // No good match, add directories without metadata
          for (const dir of group.directories) {
            enhancedDirectories.push({
              ...dir,
              searchTitle: searchTitle,
              versionGroup: group.directories.length > 1,
              versionCount: group.directories.length,
              isEnhanced: false
            });
          }
        }
      } else {
        // No results for this search
        for (const dir of group.directories) {
          enhancedDirectories.push({
            ...dir,
            searchTitle: searchTitle,
            versionGroup: group.directories.length > 1,
            versionCount: group.directories.length,
            isEnhanced: false
          });
        }
      }
    }
    
    const enhancedItems = [...enhancedDirectories, ...nonDirectories];
    const duration = Date.now() - startTime;
    
    // Log batch performance statistics
    const batchStats = rateLimiter.getBatchStats();
    
    return enhancedItems;
  } catch (error) {
    console.error('[BATCH] Batch enhancement error:', error);
    // Fallback to legacy method on error
    return await enhanceWithAnimeMetadataLegacy(items, path);
  }
}

// Legacy metadata enhancement function (original implementation)
async function enhanceWithAnimeMetadataLegacy(items, path) {
  try {
    // Filter directories and non-directories
    const directories = items.filter(item => item.type === 2 || item.isDir);
    const nonDirectories = items.filter(item => item.type !== 2 && !item.isDir);
    
    // Determine if this is a season directory by checking if the directory name matches season pattern
    const pathParts = path.split('/');
    const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2]; // Handle trailing slash
    const seasonInfo = seasonParser ? seasonParser.parseSeasonInfo(dirName) : null;
    const isSeasonDirectory = seasonInfo && seasonInfo.isValid;
    
    
    if (directories.length === 0) {
      return items;
    }
    
    // Group directories by title (same as existing logic)
    const titleGroups = new Map();
    
    for (const dir of directories) {
      const versionInfo = versionParser.parseVersionInfo(dir.name);
      const searchTitle = versionParser.extractSearchTitle(dir.name);
      
      const enhancedDir = {
        ...dir,
        versionInfo: versionInfo,
        versionDescription: versionParser.generateVersionDescription(versionInfo),
        searchTitle: searchTitle,
        isProcessing: true
      };
      
      if (!titleGroups.has(searchTitle)) {
        titleGroups.set(searchTitle, []);
      }
      titleGroups.get(searchTitle).push(enhancedDir);
    }
    
    // Convert groups to result array
    const grouped = [];
    for (const [title, versions] of titleGroups) {
      grouped.push({
        name: title,
        path: `/GROUPED/${title}`,
        type: 2,
        isDir: true,
        isGrouped: true,
        versions: versions,
        versionCount: versions.length,
        primaryVersion: versions[0],
        isProcessing: true,
        searchTitle: title,
        isSingleVersion: versions.length === 1
      });
    }
    
    
    // Background metadata fetching
    setTimeout(async () => {
      try {
        for (const group of grouped) {
          const searchTitle = group.searchTitle;
          
          // Use season context if available, otherwise generic search
          let metadata;
          if (isSeasonDirectory && seasonInfo) {
            metadata = await anilistClient.searchAnimeWithContext(searchTitle, seasonInfo);
          } else {
            metadata = await anilistClient.searchAnime(searchTitle, 1); // Limit to 1 result for generic searches
          }
          
          if (metadata && metadata.length > 0) {
            const anime = metadata[0];
            group.animeMetadata = {
              title: anime.title?.english || anime.title?.romaji || searchTitle,
              coverImage: anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium || anime.coverImage,
              coverImageExtraLarge: anime.coverImage?.extraLarge,
              coverImageLarge: anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage?.medium || anime.coverImage,
              coverImageMedium: anime.coverImage?.medium || anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage,
              coverImageSmall: anime.coverImage?.medium || anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage,
              coverImageColor: anime.coverImage?.color,
              genres: anime.genres || [],
              averageScore: anime.averageScore,
              description: anime.description,
              episodes: anime.episodes,
              status: anime.status,
              season: anime.season,
              seasonYear: anime.seasonYear,
              id: anime.id
            };
            group.isProcessing = false;
            
            // Scan for episode count
            const episodeCount = await scanEpisodeCount({
              applicationState: global.applicationState
            }, group, path);
            
            if (episodeCount) {
              group.episodeCount = episodeCount;
            }
            
          } else {
            group.metadataFailed = true;
            group.isProcessing = false;
          }
        }
      } catch (error) {
        console.error('Background metadata enhancement failed:', error);
      }
    }, 100); // Small delay to return UI quickly
    
    return [...grouped, ...nonDirectories];
    
  } catch (error) {
    console.error('Failed to enhance with anime metadata:', error);
    return items; // Return original items on error
  }
}

// Helper function to scan directory for episode count
async function scanEpisodeCount(api, item, parentPath) {
  try {
    if (!item.isDir) {
      return null;
    }

    const { listDir } = await import('../../server/src/actions.js');
    const fullPath = `${parentPath}/${item.name}`.replace(/\/+/g, '/');
    
    logDebug(api, `Scanning directory for episodes: ${fullPath}`);
    
    // List contents of the anime directory
    const entries = await listDir(fullPath, api.applicationState);
    
    if (!entries || entries.length === 0) {
      return null;
    }
    
    // Common video file extensions for episodes
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv', '.webm', '.m2ts'];
    
    // Count files that look like episode files
    const episodeFiles = entries.filter(entry => {
      if (entry.type !== 1) return false; // Only files (type 1)
      
      const fileName = entry.name.toLowerCase();
      const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
      
      if (!hasVideoExtension) return false;
      
      // Filter out common non-episode files
      const nonEpisodePatterns = [
        /preview/i, /trailer/i, /pv\d*/i, /cm\d*/i, /nc(op|ed)/i,
        /creditless/i, /clean/i, /menu/i, /extras?/i, /special/i,
        /recap/i, /summary/i, /ova/i
      ];
      
      // Check if this looks like an episode file
      const isEpisodeFile = !nonEpisodePatterns.some(pattern => pattern.test(fileName));
      
      return isEpisodeFile;
    });
    
    const episodeCount = episodeFiles.length;
    logDebug(api, `Found ${episodeCount} episode files in: ${item.name}`);
    
    return episodeCount > 0 ? episodeCount : null;
    
  } catch (error) {
    logDebug(api, `Error scanning episodes for ${item.name}: ${error.message}`);
    return null;
  }
}

// Helper function to scan episodes for grouped anime versions (max count across all versions)
async function scanEpisodesForGroupedAnime(api, groupedAnime, parentPath) {
  try {
    if (!groupedAnime.versions || groupedAnime.versions.length === 0) {
      return null;
    }

    logDebug(api, `Scanning episodes for grouped anime "${groupedAnime.name}" with ${groupedAnime.versions.length} versions`);
    
    let maxEpisodes = 0;
    const versionEpisodeCounts = [];

    // Scan each version directory for episode count
    for (const version of groupedAnime.versions) {
      try {
        // For grouped versions, we need to scan the version directory directly
        // The version.name contains the full directory name (e.g., "Zatsu Tabi - That's Journey [JapDub,GerEngSub,CR]")
        const versionItem = {
          name: version.name,
          isDir: true
        };
        
        const episodeCount = await scanEpisodeCount(api, versionItem, parentPath);
        if (episodeCount && episodeCount > 0) {
          versionEpisodeCounts.push({ name: version.name, episodes: episodeCount });
          maxEpisodes = Math.max(maxEpisodes, episodeCount);
          logDebug(api, `Version "${version.name}": ${episodeCount} episodes`);
        }
      } catch (error) {
        logDebug(api, `Failed to scan version "${version.name}": ${error.message}`);
      }
    }

    if (versionEpisodeCounts.length > 0) {
      logDebug(api, `Episode counts across versions: ${versionEpisodeCounts.map(v => `${v.name}: ${v.episodes}`).join(', ')} -> Max: ${maxEpisodes}`);
      return maxEpisodes;
    }

    return null;
  } catch (error) {
    logDebug(api, `Error scanning episodes for grouped anime ${groupedAnime.name}: ${error.message}`);
    return null;
  }
}

// Helper function to scan single version episodes (for Single Version anime)
async function scanEpisodesForSingleVersion(api, item, parentPath) {
  try {
    // For single version anime, directly scan the directory
    const episodeCount = await scanEpisodeCount(api, item, parentPath);
    if (episodeCount && episodeCount > 0) {
      logDebug(api, `Single version "${item.name}": ${episodeCount} episodes`);
      return episodeCount;
    }
    return null;
  } catch (error) {
    logDebug(api, `Failed to scan episodes for single version ${item.name}: ${error.message}`);
    return null;
  }
}

// Generate FTP View Components patterns based on current config
function getFtpViewComponents() {
  const patterns = [];
  
  // Season directory patterns (generic season format)
  patterns.push('/\\d{4}-\\d+ \\w+$');
  
  
  return [{
    id: 'anilist-anime-viewer',
    name: 'Anime Metadata Viewer',
    description: 'Enhanced anime directory viewer with AniList metadata',
    supportedPathPatterns: patterns,
    priority: 100,
    component: {
      template: '<anime-season-viewer :items="items" :path="path" :socket="socket" :loading-status="loadingStatus" @item-selected="$emit(\'item-selected\', $event)" @metadata-update="$emit(\'metadata-update\', $event)" @go-back="$emit(\'go-back\')"></anime-season-viewer>',
      props: ['items', 'path', 'socket', 'loadingStatus'],
      emits: ['item-selected', 'metadata-update', 'go-back']
    },
    enrichMetadata: async (items, path) => {
      // This will be called to enhance the directory listing with anime metadata
      return await enhanceWithAnimeMetadata(items, path);
    }
  }];
}

// Global config storage for dynamic pattern generation
if (typeof global !== 'undefined') {
  global.anilistPluginConfig = global.anilistPluginConfig || {};
}

// Plugin metadata and configuration
export default {
  name: "anilist-seasons",
  version: "1.0.0",
  description: `Enhance FTP viewer with anime metadata from AniList API. Automatically detects anime series in season directories and provides detailed information including cover images, genres, and episode counts. Groups multiple versions (CR, ADN, etc.) of the same anime for better organization.
  
Key Features:
• Automatic anime detection in season directories (YYYY-N Season format)
• Rich metadata from AniList including cover art, genres, ratings
• Version grouping for different releases (CR, ADN, etc.)
• Smart caching to minimize API calls
• Configurable UI enhancements`,
  register,
  onConfigUpdate,
  onDispose,
  getFtpViewComponents,
  pluginConfigurationDefinition: [
    // General Settings
    { label: "General Settings", type: "label" },
    { key: "enablePlugin", type: "boolean", default: true },
    { 
      key: "enableDebugLogging", 
      type: "boolean", 
      default: false,
      description: "Enable detailed debug logging for troubleshooting. Shows API requests, cache operations, and processing details. (Default: Disabled)"
    },
    
    // AniList API Settings
    { label: "AniList API Configuration", type: "label" },
    { 
      key: "enableBatchOptimization", 
      type: "boolean", 
      default: true,
      description: "Enable batch API requests for improved performance. Processes multiple anime searches in single requests, reducing API calls by 80-90%. Disable only if experiencing issues. (Default: Enabled)"
    },
    { 
      key: "batchSize", 
      type: "number", 
      default: 15,
      description: "Number of anime titles processed per batch request (5-15). Higher values are more efficient but may hit rate limits. (Default: 15 - Maximum)"
    },
    { 
      key: "cacheExpirationDays", 
      type: "number", 
      default: 30,
      description: "Days after which cached anime metadata expires and gets refreshed (7-90). Lower values = fresher data but more API calls. (Default: 30 days)"
    },
    
    // Proactive Cache Management
    { label: "Proactive Cache Management - Automatic Metadata Preloading", type: "label" },
    { 
      key: "enableProactiveCache", 
      type: "boolean", 
      default: true,
      description: "Automatically scans and preloads anime metadata for all season directories on server start. This dramatically reduces loading times by having anime information ready before it's displayed. (Default: Enabled)"
    },
    { 
      key: "warmupBatchSize", 
      type: "number", 
      default: 5,
      description: "Number of anime processed simultaneously (1-10). Higher values = faster processing but more API load. Recommended: 3-5 for stable operation without hitting rate limits. (Default: 5)"
    },
    { 
      key: "warmupDelayMs", 
      type: "number", 
      default: 2000,
      description: "Delay between processing batches in milliseconds (1000-5000). Higher values protect against API rate limiting. Adjust based on your connection and API limits. (Default: 2000ms = 2 seconds)"
    },
    { 
      key: "refreshIntervalHours", 
      type: "number", 
      default: 6,
      description: "Hours between automatic cache refresh cycles (1-24). System regularly checks for new anime and updates outdated information. Lower values = fresher data but more API usage. (Default: 6 hours)"
    },
    
    
    // OAuth Settings
    { label: "OAuth Authentication (Optional - Higher Rate Limits)", type: "label" },
    { 
      key: "clientId", 
      type: "text", 
      default: "",
      placeholder: "Enter Client ID from AniList Developer Console",
      description: "OAuth Client ID from https://anilist.co/settings/developer"
    },
    { 
      key: "clientSecret", 
      type: "text", 
      default: "",
      placeholder: "Enter Client Secret from AniList Developer Console", 
      description: "OAuth Client Secret (keep private)"
    },
    { 
      key: "redirectUri", 
      type: "text", 
      default: "http://localhost:3000/callback",
      placeholder: "http://localhost:3000/callback",
      description: "Redirect URI configured in your AniList OAuth app"
    },
    { key: "enableOAuth", type: "boolean", default: false },
    
    // Season Directory Settings
    { label: "Season Directory Configuration", type: "label" },
    { key: "seasonDirectoryPattern", type: "text", default: "YYYY-N Season" },
    { 
      key: "seasonsRootPath", 
      type: "directory-picker", 
      default: "",
      placeholder: "/FTP/root/path/Seasons (e.g., /Anime/Seasons)",
      description: "FTP path to directory containing season folders. Leave empty to scan all directories."
    },
    
    
    // Source Mapping Configuration  
    { label: "Source Mappings", type: "label" },
    { 
      key: "sourceMappings", 
      type: "text-array", 
      default: [
        "CR=Crunchyroll|#F47521",
        "ADN=Animation Digital Network|#0099FF", 
        "DSNP=Disney+|#113CCF",
        "AMZ=Amazon Prime Video|#00A8E1",
        "NF=Netflix|#E50914",
        "FLE=Funimation|#5B4E75",
        "GJM=GJM-subs|#FF6B35"
      ],
      placeholder: "CR=Crunchyroll|#F47521",
      description: "Configure source tag mappings with format: 'TAG=Name' or 'TAG=Name|#Color'. Each entry represents one source mapping."
    },

    // Advanced Settings
    { label: "Advanced Configuration", type: "label" },
    { key: "titleMatchingThreshold", type: "number", default: 80 },
    { key: "maxSearchResults", type: "number", default: 5 },
    { key: "fallbackToFuzzySearch", type: "boolean", default: true },
  ],
};