import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class CacheManager {
  constructor(pluginDirectory, configDirectory = null) {
    this.pluginDirectory = pluginDirectory;
    // Store cache file in config directory alongside other WeebSync configs
    this.configDirectory = configDirectory || join(process.env.HOME || process.env.USERPROFILE || '.', '.weebsync');
    this.cacheFilePath = join(this.configDirectory, 'anilist-seasons-cache.json');
    this.expirationDays = 30;
    
    // In-memory cache for performance
    this.memoryCache = {
      anime: new Map(),
      searches: new Map()
    };
    
  }

  async initialize() {
    try {
      // Ensure config directory exists
      if (!existsSync(this.configDirectory)) {
        mkdirSync(this.configDirectory, { recursive: true });
      }
      
      // Load existing cache from JSON file
      this.loadFromDisk();
      
    } catch (error) {
      console.error('Cache initialization failed:', error);
    }
  }

  loadFromDisk() {
    try {
      if (existsSync(this.cacheFilePath)) {
        const cacheData = JSON.parse(readFileSync(this.cacheFilePath, 'utf-8'));
        
        // Load anime cache
        if (cacheData.anime) {
          for (const [title, data] of Object.entries(cacheData.anime)) {
            this.memoryCache.anime.set(title, data);
          }
        }
        
        // Load search cache
        if (cacheData.searches) {
          for (const [query, data] of Object.entries(cacheData.searches)) {
            this.memoryCache.searches.set(query, data);
          }
        }
        
      }
    } catch (error) {
      console.error('Failed to load cache from disk:', error);
    }
  }

  saveToDisk() {
    try {
      const cacheData = {
        anime: Object.fromEntries(this.memoryCache.anime),
        searches: Object.fromEntries(this.memoryCache.searches),
        lastSaved: Date.now()
      };
      
      writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.error('Failed to save cache to disk:', error);
    }
  }

  updateExpirationDays(days) {
    this.expirationDays = days;
  }

  isExpired(cachedAt, customExpirationDays = null) {
    const expirationMs = (customExpirationDays || this.expirationDays) * 24 * 60 * 60 * 1000;
    return Date.now() - cachedAt > expirationMs;
  }

  // Save anime metadata to cache
  async saveAnimeMetadata(title, animeResults, merge = true) {
    try {
      let finalResults = animeResults;
      
      if (merge) {
        // Get existing cached data
        const existing = this.memoryCache.anime.get(title);
        if (existing && existing.metadata) {
          // Merge results, avoiding duplicates by ID
          const existingIds = new Set(existing.metadata.map(anime => anime.id));
          const newResults = animeResults.filter(anime => !existingIds.has(anime.id));
          
          if (newResults.length > 0) {
            finalResults = [...existing.metadata, ...newResults];
          } else {
            finalResults = existing.metadata;
          }
        }
      }
      
      const cacheEntry = {
        metadata: finalResults,
        cachedAt: Date.now()
      };
      
      this.memoryCache.anime.set(title, cacheEntry);
      
      // Save to disk periodically (not on every write for performance)
      if (Math.random() < 0.1) { // 10% chance to save to disk
        this.saveToDisk();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to save anime metadata:', error);
      return false;
    }
  }

  // Invalidate cache entry for a specific title
  async invalidateCacheEntry(title) {
    try {
      const deleted = this.memoryCache.anime.delete(title);
      if (deleted) {
        // Force save to disk to persist the change
        this.saveToDisk();
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Failed to invalidate cache entry:', error);
      return false;
    }
  }

  // Get anime metadata from cache by title
  async getAnimeByTitle(title) {
    try {
      // First try exact match
      const cached = this.memoryCache.anime.get(title);
      
      if (cached && !this.isExpired(cached.cachedAt)) {
        return cached;
      }
      
      // If no exact match, search through all cached entries for title matches
      const lowerSearchTitle = title.toLowerCase();
      
      for (const [cacheKey, cacheEntry] of this.memoryCache.anime) {
        if (this.isExpired(cacheEntry.cachedAt)) continue;
        
        // Check if any anime in this cache entry matches our search title
        if (cacheEntry.metadata && Array.isArray(cacheEntry.metadata)) {
          for (const anime of cacheEntry.metadata) {
            if (anime.title) {
              // Check all title variants
              const titleVariants = [
                anime.title.romaji,
                anime.title.english,
                anime.title.native
              ].filter(Boolean);
              
              // Check for partial matches with more flexible criteria
              const hasPartialMatch = titleVariants.some(variant => {
                const lowerVariant = variant.toLowerCase();
                const searchWords = lowerSearchTitle.split(/[\s\-_]+/).filter(word => word.length > 2);
                const variantWords = lowerVariant.split(/[\s\-_]+/).filter(word => word.length > 2);
                
                // Special handling for German titles that might reference anime characters/concepts
                if (lowerSearchTitle.includes('hanako') && (lowerVariant.includes('hanako') || lowerVariant.includes('jibaku'))) {
                  return true;
                }
                
                // KAMITSUBAKI case: main distinctive words should match
                if (lowerSearchTitle.includes('kamitsubaki') && lowerVariant.includes('kamitsubaki')) {
                  return true;
                }
                
                // General case: count significant word matches
                const matchingWords = searchWords.filter(searchWord => 
                  variantWords.some(variantWord => {
                    // Exact match
                    if (searchWord === variantWord) return true;
                    // Partial containment 
                    if (searchWord.includes(variantWord) || variantWord.includes(searchWord)) return true;
                    // Similar words (length > 4 and start same)
                    if (searchWord.length > 4 && variantWord.length > 4 && 
                        searchWord.substring(0, 3) === variantWord.substring(0, 3)) return true;
                    return false;
                  })
                ).length;
                
                // Much more restrictive: need at least 3 matching words AND at least 60% of search words
                // This prevents false matches like "The Shiunji Family Children" → "The Brilliant Healer's New Life in the Shadows"
                const minWords = Math.max(3, Math.floor(searchWords.length * 0.6));
                return matchingWords >= minWords && matchingWords >= 3;
              });
              
              if (hasPartialMatch) {
                return cacheEntry;
              }
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get anime by title:', error);
      return null;
    }
  }

  // Save anime by AniList ID
  async saveAnimeById(anilistId, anime) {
    try {
      const cacheEntry = {
        anime: anime,
        cachedAt: Date.now()
      };
      
      this.memoryCache.anime.set(`id:${anilistId}`, cacheEntry);
      
      // Save to disk periodically
      if (Math.random() < 0.1) {
        this.saveToDisk();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to save anime by ID:', error);
      return false;
    }
  }

  // Get anime by AniList ID
  async getAnimeById(anilistId) {
    try {
      const cached = this.memoryCache.anime.get(`id:${anilistId}`);
      
      if (cached && !this.isExpired(cached.cachedAt)) {
        return cached.anime;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get anime by ID:', error);
      return null;
    }
  }

  // Save search result
  async saveSearchResult(query, results) {
    try {
      const cacheEntry = {
        results: results,
        cachedAt: Date.now()
      };
      
      this.memoryCache.searches.set(query, cacheEntry);
      
      // Save to disk periodically
      if (Math.random() < 0.1) {
        this.saveToDisk();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to save search result:', error);
      return false;
    }
  }

  // Get cached search result
  async getSearchResult(query) {
    try {
      const cached = this.memoryCache.searches.get(query);
      
      if (cached && !this.isExpired(cached.cachedAt)) {
        return cached.results;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get search result:', error);
      return null;
    }
  }

  // Get cache statistics
  getStats() {
    return {
      animeCount: this.memoryCache.anime.size,
      searchCount: this.memoryCache.searches.size,
      cacheFilePath: this.cacheFilePath,
      expirationDays: this.expirationDays
    };
  }

  // Clear expired entries
  clearExpired() {
    let removedCount = 0;
    
    // Clear expired anime cache
    for (const [key, entry] of this.memoryCache.anime.entries()) {
      if (this.isExpired(entry.cachedAt)) {
        this.memoryCache.anime.delete(key);
        removedCount++;
      }
    }
    
    // Clear expired search cache
    for (const [key, entry] of this.memoryCache.searches.entries()) {
      if (this.isExpired(entry.cachedAt)) {
        this.memoryCache.searches.delete(key);
        removedCount++;
      }
    }
    
    
    // Save to disk after cleanup
    this.saveToDisk();
    
    return removedCount;
  }

  // Force save to disk
  async forceSave() {
    this.saveToDisk();
  }

  // Enhanced save method with directory mapping support
  async saveAnimeMetadataWithMapping(primaryTitle, alternativeTitles, animeResults, merge = true) {
    try {
      // Save under primary title
      await this.saveAnimeMetadata(primaryTitle, animeResults, merge);
      
      // Create mappings for alternative titles
      for (const altTitle of alternativeTitles) {
        if (altTitle !== primaryTitle) {
          // Create a mapping entry that points to the primary cache
          const mappingEntry = {
            mappingTo: primaryTitle,
            cachedAt: Date.now()
          };
          
          this.memoryCache.anime.set(altTitle, mappingEntry);
        }
      }
      
      // Save to disk
      if (Math.random() < 0.3) { // Higher chance when creating mappings
        this.saveToDisk();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to save anime metadata with mapping:', error);
      return false;
    }
  }

  // Enhanced get method that follows mappings
  async getAnimeByTitleWithMapping(title) {
    try {
      // First try direct lookup
      let cached = this.memoryCache.anime.get(title);
      
      if (cached && !this.isExpired(cached.cachedAt)) {
        // If it's a mapping, follow the mapping
        if (cached.mappingTo) {
          cached = this.memoryCache.anime.get(cached.mappingTo);
          
          if (cached && !this.isExpired(cached.cachedAt)) {
            return cached;
          }
        } else {
          // Direct cache hit
          return cached;
        }
      }
      
      // Fallback to original method for fuzzy matching
      return await this.getAnimeByTitle(title);
      
    } catch (error) {
      console.error('Failed to get anime by title with mapping:', error);
      return null;
    }
  }

  // Get all cached anime titles (for debugging cache issues)
  getAllCachedTitles() {
    const titles = [];
    for (const [key, entry] of this.memoryCache.anime.entries()) {
      if (!this.isExpired(entry.cachedAt)) {
        titles.push({
          key,
          isMapping: !!entry.mappingTo,
          mappingTo: entry.mappingTo || null,
          hasMetadata: !!entry.metadata,
          animeCount: entry.metadata ? (Array.isArray(entry.metadata) ? entry.metadata.length : 1) : 0
        });
      }
    }
    return titles.sort((a, b) => a.key.localeCompare(b.key));
  }

  // Migrate existing cache entries to include mappings
  async migrateToMappingStructure(versionParser) {
    try {
      
      const entries = Array.from(this.memoryCache.anime.entries());
      let migratedCount = 0;
      let removedCount = 0;
      
      for (const [cacheKey, cacheEntry] of entries) {
        // Skip if already a mapping or expired
        if (cacheEntry.mappingTo || this.isExpired(cacheEntry.cachedAt)) {
          continue;
        }
        
        if (cacheEntry.metadata && Array.isArray(cacheEntry.metadata)) {
          // Extract new search title using improved parser
          const result = versionParser.extractSearchTitleWithSeason(cacheKey);
          const newSearchTitle = result.title;
          
          if (newSearchTitle && newSearchTitle !== cacheKey && newSearchTitle.length > 2) {
            // Check if this creates a better mapping
            const existingEntry = this.memoryCache.anime.get(newSearchTitle);
            
            if (!existingEntry || existingEntry.mappingTo) {
              // Create new mapping structure
              await this.saveAnimeMetadataWithMapping(
                newSearchTitle, 
                [cacheKey], 
                cacheEntry.metadata, 
                false
              );
              
              migratedCount++;
            } else {
              // Conflict detected - merge metadata if possible
              if (existingEntry.metadata && Array.isArray(existingEntry.metadata)) {
                const merged = this.mergeAnimeMetadata(existingEntry.metadata, cacheEntry.metadata);
                if (merged.hasChanges) {
                  await this.saveAnimeMetadata(newSearchTitle, merged.metadata, false);
                  // Create mapping for old key
                  this.memoryCache.anime.set(cacheKey, {
                    mappingTo: newSearchTitle,
                    cachedAt: Date.now()
                  });
                  migratedCount++;
                }
              }
            }
          } else if (newSearchTitle && newSearchTitle.length <= 2) {
            // Remove invalid cache entries that parse to very short titles
            this.memoryCache.anime.delete(cacheKey);
            removedCount++;
          }
        }
      }
      
      this.saveToDisk();
      
      return { migratedCount, removedCount };
    } catch (error) {
      console.error('Failed to migrate cache structure:', error);
      return { migratedCount: 0, removedCount: 0 };
    }
  }

  // Merge two anime metadata arrays, avoiding duplicates by ID
  mergeAnimeMetadata(existingMetadata, newMetadata) {
    const existingIds = new Set(existingMetadata.map(anime => anime.id));
    const newEntries = newMetadata.filter(anime => !existingIds.has(anime.id));
    
    if (newEntries.length > 0) {
      return {
        metadata: [...existingMetadata, ...newEntries],
        hasChanges: true
      };
    }
    
    return {
      metadata: existingMetadata,
      hasChanges: false
    };
  }
}