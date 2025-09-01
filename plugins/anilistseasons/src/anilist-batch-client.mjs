// Batch-optimized AniList Client for maximum API efficiency
import axios from 'axios';

export class AniListBatchClient {
  constructor(rateLimiter, cacheManager, versionParser, config = {}) {
    this.apiUrl = 'https://graphql.anilist.co';
    this.rateLimiter = rateLimiter;
    this.cache = cacheManager;
    this.versionParser = versionParser;
    this.config = config;
    
    // Batch configuration for optimal API usage
    this.batchConfig = {
      maxBatchSize: 15, // Maximum queries per batch request
      optimalBatchSize: 10, // Optimal balance between size and performance
      perPage: 5, // Results per search query
      maxRetries: 3,
      retryDelay: 1000,
      ...config.batch
    };
  }

  /**
   * Search for multiple anime titles in optimized batches
   * This is the main entry point for batch operations
   */
  async searchAnimeBatch(titles, seasonContext = null) {
    if (!Array.isArray(titles) || titles.length === 0) {
      return {};
    }

    const startTime = Date.now();

    // Step 1: Check cache for all titles
    const { cachedResults, uncachedTitles } = await this.checkCacheForBatch(titles, seasonContext);

    // If all results are cached, return immediately
    if (uncachedTitles.length === 0) {
      return cachedResults;
    }

    // Step 2: Create optimized batches for uncached titles
    const batches = this.createOptimalBatches(uncachedTitles, seasonContext);

    // Step 3: Execute batches with intelligent scheduling
    const batchResults = await this.executeBatchesWithScheduling(batches);

    // Step 4: Process and cache results
    const processedResults = await this.processBatchResults(batchResults, seasonContext);

    // Step 5: Merge with cached results
    const finalResults = { ...cachedResults, ...processedResults };

    return finalResults;
  }

  /**
   * Check cache for all titles in batch
   */
  async checkCacheForBatch(titles, seasonContext) {
    const cachedResults = {};
    const uncachedTitles = [];

    for (const title of titles) {
      try {
        const cached = await this.cache.getAnimeByTitleWithMapping(title);
        if (cached && !this.cache.isExpired(cached.cachedAt)) {
          // If we have season context, try to find season-specific match
          if (seasonContext) {
            const seasonMatch = cached.metadata.find(anime => 
              this.matchesSeasonContext(anime, seasonContext)
            );
            if (seasonMatch) {
              cachedResults[title] = [seasonMatch];
              continue;
            }
          } else {
            cachedResults[title] = cached.metadata;
            continue;
          }
        }
      } catch (error) {
        console.warn(`[BATCH] Cache check failed for "${title}":`, error.message);
      }
      
      uncachedTitles.push(title);
    }

    return { cachedResults, uncachedTitles };
  }

  /**
   * Create optimized batches based on query complexity and season context
   */
  createOptimalBatches(titles, seasonContext) {
    const batches = [];
    const { optimalBatchSize } = this.batchConfig;

    // ALWAYS use batching, even for single titles (better consistency and rate limiting)
    if (titles.length === 0) {
      return batches;
    }

    // For season-specific searches, use slightly smaller batches for better accuracy
    const effectiveBatchSize = seasonContext ? 
      Math.min(optimalBatchSize - 1, 8) : 
      optimalBatchSize;

    // Even single titles go through batch processing for consistent handling
    for (let i = 0; i < titles.length; i += effectiveBatchSize) {
      const batchTitles = titles.slice(i, i + effectiveBatchSize);
      batches.push({
        id: `batch_${Math.floor(i / effectiveBatchSize) + 1}`,
        titles: batchTitles,
        seasonContext,
        size: batchTitles.length
      });
    }

    return batches;
  }

  /**
   * Execute batches with intelligent scheduling to maximize API efficiency
   */
  async executeBatchesWithScheduling(batches) {
    const results = [];
    const totalBatches = batches.length;
    

    for (let i = 0; i < totalBatches; i++) {
      const batch = batches[i];
      const batchStartTime = Date.now();
      
      
      try {
        // Wait for rate limiter before each batch - use batch-aware slot
        await this.rateLimiter.waitForBatchSlot(batch.size, batch.id);
        
        const batchResult = await this.executeSingleBatch(batch);
        results.push({
          batchId: batch.id,
          titles: batch.titles,
          results: batchResult,
          executionTime: Date.now() - batchStartTime
        });
        
        
        // Intelligent delay between batches (smaller delay for smaller batches)
        if (i < totalBatches - 1) {
          const delay = this.calculateOptimalDelay(batch.size, i, totalBatches);
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
      } catch (error) {
        console.error(`[BATCH] ${batch.id} failed:`, error.message);
        results.push({
          batchId: batch.id,
          titles: batch.titles,
          results: null,
          error: error.message,
          executionTime: Date.now() - batchStartTime
        });
      }
    }

    return results;
  }

  /**
   * Execute a single batch request with multiple search queries
   */
  async executeSingleBatch(batch) {
    const { titles, seasonContext } = batch;
    
    // Build batch GraphQL query
    const { query, variables } = this.buildBatchQuery(titles, seasonContext);
    
    // Execute with retry logic
    return await this.executeWithRetry(query, variables, batch.id);
  }

  /**
   * Build an optimized batch GraphQL query
   */
  buildBatchQuery(titles, seasonContext = null) {
    const queryParts = [];
    const variables = {};
    
    titles.forEach((title, index) => {
      const aliasName = `search${index}`;
      const searchVar = `search${index}`;
      
      // Add variables
      variables[searchVar] = title;
      
      // Build query part with conditional season filtering
      let mediaArgs = `search: $${searchVar}, type: ANIME`;
      
      if (seasonContext) {
        const seasonVar = `season${index}`;
        const yearVar = `year${index}`;
        
        const seasonMap = {
          'winter': 'WINTER',
          'spring': 'SPRING', 
          'summer': 'SUMMER',
          'fall': 'FALL',
          'autumn': 'FALL'
        };
        
        const expectedSeason = seasonMap[seasonContext.seasonName.toLowerCase()];
        if (expectedSeason) {
          mediaArgs += `, season: $${seasonVar}, seasonYear: $${yearVar}`;
          variables[seasonVar] = expectedSeason;
          variables[yearVar] = seasonContext.year;
        }
      }
      
      queryParts.push(`
        ${aliasName}: Page(page: 1, perPage: ${this.batchConfig.perPage}) {
          pageInfo {
            hasNextPage
          }
          media(${mediaArgs}) {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
              medium
              color
            }
            genres
            description
            averageScore
            episodes
            status
            season
            seasonYear
            format
            startDate {
              year
              month
              day
            }
          }
        }
      `);
    });

    // Build variable definitions
    const variableDefinitions = [];
    titles.forEach((_, index) => {
      variableDefinitions.push(`$search${index}: String!`);
      if (seasonContext) {
        variableDefinitions.push(`$season${index}: MediaSeason`);
        variableDefinitions.push(`$year${index}: Int`);
      }
    });

    const query = `
      query BatchAnimeSearch(${variableDefinitions.join(', ')}) {
        ${queryParts.join('\n')}
      }
    `;

    return { query, variables };
  }

  /**
   * Execute query with intelligent retry logic
   */
  async executeWithRetry(query, variables, batchId, attempt = 1) {
    const { maxRetries, retryDelay } = this.batchConfig;
    
    try {
      const response = await this.makeRequest(query, variables);
      
      if (response.errors && response.errors.length > 0) {
        // Check if errors are rate limiting or temporary
        const hasRateLimitError = response.errors.some(error => 
          error.message.includes('Too Many Requests') || 
          error.status === 429
        );
        
        if (hasRateLimitError && attempt <= maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          console.warn(`[BATCH] ${batchId} rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.executeWithRetry(query, variables, batchId, attempt + 1);
        }
        
        console.warn(`[BATCH] ${batchId} GraphQL errors:`, response.errors.map(e => e.message));
      }
      
      return response.data || {};
    } catch (error) {
      if (error.response?.status === 429 && attempt <= maxRetries) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '30');
        const delay = Math.max(retryAfter * 1000, retryDelay * Math.pow(2, attempt - 1));
        
        console.warn(`[BATCH] ${batchId} HTTP 429, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(query, variables, batchId, attempt + 1);
      }
      
      if (attempt <= maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        console.warn(`[BATCH] ${batchId} failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(query, variables, batchId, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Process batch results and cache them
   */
  async processBatchResults(batchResults, seasonContext) {
    const processedResults = {};
    
    for (const batchResult of batchResults) {
      if (batchResult.error || !batchResult.results) {
        console.warn(`[BATCH] Skipping failed batch ${batchResult.batchId}`);
        continue;
      }
      
      const { titles, results } = batchResult;
      
      // Process each search result
      titles.forEach((title, index) => {
        const aliasName = `search${index}`;
        const searchResult = results[aliasName];
        
        if (searchResult && searchResult.media) {
          const animeList = searchResult.media;
          
          // Apply intelligent matching for better results
          const enhancedResults = this.enhanceSearchResults(animeList, title, seasonContext);
          
          processedResults[title] = enhancedResults;
          
          // Cache the results asynchronously
          this.cacheResultsAsync(title, enhancedResults);
        } else {
          console.warn(`[BATCH] No results for "${title}" in ${batchResult.batchId}`);
          processedResults[title] = [];
        }
      });
    }
    
    return processedResults;
  }

  /**
   * Enhance search results with intelligent matching and ranking
   */
  enhanceSearchResults(animeList, originalTitle, seasonContext) {
    if (!animeList || animeList.length === 0) {
      return [];
    }

    // Apply season context matching with priority
    if (seasonContext) {
      const seasonMatches = animeList.filter(anime => 
        this.matchesSeasonContext(anime, seasonContext)
      );
      
      if (seasonMatches.length > 0) {
        return seasonMatches.map(anime => ({
          ...anime,
          matchScore: this.calculateTitleSimilarity(originalTitle, anime),
          seasonMatch: true
        }));
      }
    }

    // Regular matching with scoring
    return animeList.map(anime => ({
      ...anime,
      matchScore: this.calculateTitleSimilarity(originalTitle, anime)
    })).sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Calculate optimal delay between batches
   */
  calculateOptimalDelay(batchSize, currentIndex, totalBatches) {
    // Base delay scales with batch size
    const baseDelay = batchSize * 50; // 50ms per title
    
    // Reduce delay as we progress (API warms up)
    const progressFactor = Math.max(0.3, 1 - (currentIndex / totalBatches));
    
    // Add small random jitter to avoid thundering herd
    const jitter = Math.random() * 200;
    
    return Math.floor(baseDelay * progressFactor + jitter);
  }

  /**
   * Calculate title similarity (reuse from base client)
   */
  calculateTitleSimilarity(originalTitle, anime) {
    const titles = [
      anime.title.romaji,
      anime.title.english,
      anime.title.native
    ].filter(Boolean);
    
    let bestScore = 0;
    for (const title of titles) {
      const score = this.calculateSimilarity(originalTitle, title);
      bestScore = Math.max(bestScore, score);
    }
    
    return bestScore;
  }

  /**
   * Calculate similarity using Levenshtein distance (reuse from base client)
   */
  calculateSimilarity(title1, title2) {
    const normalize = (str) => {
      return str.toLowerCase()
        .replace(/－/g, '-')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[^\w\d]/g, '')
        .replace(/\s+/g, '');
    };
    
    const norm1 = normalize(title1);
    const norm2 = normalize(title2);
    
    if (norm1 === norm2) return 100;
    
    // Levenshtein distance calculation
    const matrix = Array(norm1.length + 1).fill(null).map(() => Array(norm2.length + 1).fill(null));
    
    for (let i = 0; i <= norm1.length; i++) {
      matrix[i][0] = i;
    }
    
    for (let j = 0; j <= norm2.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= norm1.length; i++) {
      for (let j = 1; j <= norm2.length; j++) {
        const cost = norm1[i - 1] === norm2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    const maxLength = Math.max(norm1.length, norm2.length);
    const similarity = ((maxLength - matrix[norm1.length][norm2.length]) / maxLength) * 100;
    
    return Math.round(similarity);
  }

  /**
   * Check if anime matches season context (reuse from base client)
   */
  matchesSeasonContext(anime, seasonContext) {
    if (!anime.seasonYear || !anime.season || !seasonContext) {
      return false;
    }
    
    const seasonMap = {
      'winter': 'WINTER',
      'spring': 'SPRING', 
      'summer': 'SUMMER',
      'fall': 'FALL',
      'autumn': 'FALL'
    };
    
    const expectedSeason = seasonMap[seasonContext.seasonName.toLowerCase()];
    
    return anime.seasonYear === seasonContext.year && 
           anime.season === expectedSeason;
  }

  /**
   * Make HTTP request (reuse from base client with batch optimizations)
   */
  async makeRequest(query, variables) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    const config = {
      method: 'POST',
      url: this.apiUrl,
      headers: headers,
      data: {
        query: query,
        variables: variables
      },
      timeout: 30000 // Increased timeout for batch requests
    };

    const response = await axios(config);
    
    // Update rate limiter with response headers
    if (response.headers) {
      this.rateLimiter.updateFromHeaders(response.headers);
    }
    
    return response.data;
  }

  /**
   * Cache results asynchronously to not block processing
   */
  async cacheResultsAsync(title, results) {
    try {
      if (results && results.length > 0) {
        await this.cache.saveAnimeMetadata(title, results);
      }
    } catch (error) {
      console.warn(`[BATCH] Failed to cache results for "${title}":`, error.message);
    }
  }

  /**
   * Get batch processing statistics
   */
  getBatchStats() {
    return {
      maxBatchSize: this.batchConfig.maxBatchSize,
      optimalBatchSize: this.batchConfig.optimalBatchSize,
      perPage: this.batchConfig.perPage,
      estimatedRequestReduction: this.calculateEstimatedSavings()
    };
  }

  /**
   * Calculate estimated API request savings
   */
  calculateEstimatedSavings(titleCount = 50) {
    const oldRequests = titleCount; // One request per title
    const newRequests = Math.ceil(titleCount / this.batchConfig.optimalBatchSize);
    const savings = ((oldRequests - newRequests) / oldRequests) * 100;
    
    return {
      oldRequests,
      newRequests,
      savingsPercentage: Math.round(savings),
      estimatedTimeReduction: `${Math.round(savings * 0.8)}%` // Conservative estimate
    };
  }
}