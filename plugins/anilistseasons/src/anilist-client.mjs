// Import axios for HTTP requests (globally installed in Node.js)
import axios from 'axios';

export class AniListClient {
  constructor(rateLimiter, cacheManager, versionParser, config = {}) {
    this.apiUrl = 'https://graphql.anilist.co';
    this.rateLimiter = rateLimiter;
    this.cache = cacheManager;
    this.versionParser = versionParser;
    
    // OAuth configuration
    this.config = {
      enableOAuth: config.enableOAuth || false,
      clientId: config.clientId || '',
      clientSecret: config.clientSecret || '',
      redirectUri: config.redirectUri || 'http://localhost:3000/callback',
      ...config
    };
  }

  // Update OAuth configuration
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }

  // Generate OAuth authorization URL
  getOAuthUrl() {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error('OAuth client ID and redirect URI are required');
    }
    
    const baseUrl = 'https://anilist.co/api/v2/oauth/authorize';
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code'
    });
    
    return `${baseUrl}?${params.toString()}`;
  }

  async searchAnime(title, maxResults = 10) {
    // Check cache first using mapping-aware function
    const cached = await this.cache.getAnimeByTitleWithMapping(title);
    if (cached && !this.cache.isExpired(cached.cachedAt)) {
      return cached.metadata;
    }

    // Rate limit the request
    await this.rateLimiter.waitForSlot();

    // Enhanced query that searches both English and Japanese titles more effectively
    const query = `
      query ($search: String!) {
        Page(page: 1, perPage: ${maxResults}) {
          pageInfo {
            hasNextPage
          }
          media(search: $search, type: ANIME) {
            id
            title {
              romaji
              english
              native
            }
            synonyms
            coverImage {
              extraLarge
              large
              medium
              color
            }
            genres
            description
            averageScore
            meanScore
            episodes
            nextAiringEpisode {
              episode
              airingAt
              timeUntilAiring
            }
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
      }
    `;

    const variables = { search: title };

    try {
      const response = await this.makeRequest(query, variables);
      
      if (response.errors) {
        throw new Error(`AniList API error: ${response.errors.map(e => e.message).join(', ')}`);
      }

      let results = response.data?.Page?.media || [];
      
      // Enhanced title matching with scoring
      if (results.length > 0) {
        results = this.scoreAndSortResults(results, title);
      }
      
      // Cache the results
      if (results.length > 0) {
        await this.cache.saveAnimeMetadata(title, results);
      }

      return results;
    } catch (error) {
      console.error('AniList search failed:', error);
      // Return cached data if available, even if expired
      return cached ? cached.metadata : [];
    }
  }

  // Enhanced result scoring and sorting based on title similarity
  scoreAndSortResults(results, searchTitle) {
    const normalizedSearch = this.normalizeForComparison(searchTitle);
    
    const scoredResults = results.map(anime => {
      let bestScore = 0;
      let matchedTitle = '';
      
      // Check all available titles
      const titlesToCheck = [
        anime.title.english,
        anime.title.romaji,
        anime.title.native,
        ...(anime.synonyms || [])
      ].filter(Boolean);
      
      for (const title of titlesToCheck) {
        const score = this.calculateTitleSimilarity(normalizedSearch, this.normalizeForComparison(title));
        if (score > bestScore) {
          bestScore = score;
          matchedTitle = title;
        }
      }
      
      return {
        ...anime,
        matchScore: bestScore,
        matchedTitle
      };
    });
    
    // Sort by match score (highest first)
    return scoredResults.sort((a, b) => b.matchScore - a.matchScore);
  }

  // Normalize title for better comparison
  normalizeForComparison(title) {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')    // Normalize spaces
      .trim();
  }

  // Calculate title similarity score
  calculateTitleSimilarity(title1, title2) {
    if (title1 === title2) return 100;
    
    // Exact substring match gets high score
    if (title1.includes(title2) || title2.includes(title1)) {
      const longer = Math.max(title1.length, title2.length);
      const shorter = Math.min(title1.length, title2.length);
      return Math.round((shorter / longer) * 95);
    }
    
    // Word-based matching
    const words1 = title1.split(' ').filter(w => w.length > 2);
    const words2 = title2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    let matchingWords = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.includes(word2) || word2.includes(word1)) {
          matchingWords++;
          break;
        }
      }
    }
    
    return Math.round((matchingWords / Math.max(words1.length, words2.length)) * 80);
  }

  // Generate progressively shortened versions of a title
  generateShortenedTitles(title) {
    const shortened = [];
    const words = title.split(' ').filter(w => w.trim().length > 0);
    
    if (words.length <= 2) return []; // Don't shorten very short titles
    
    // Progressive shortening strategies:
    
    // 1. Remove common words from the end (UNDER PRODUCTION, UNDER CONSTRUCTION, etc.)
    const commonSuffixes = ['UNDER', 'WITH', 'AND', 'OF', 'THE', 'FOR', 'TO', 'IN', 'ON', 'AT'];
    let workingWords = [...words];
    
    while (workingWords.length > 2) {
      const lastWord = workingWords[workingWords.length - 1].toUpperCase();
      if (commonSuffixes.includes(lastWord)) {
        workingWords.pop();
        if (workingWords.length >= 2) {
          shortened.push(workingWords.join(' '));
        }
      } else {
        break;
      }
    }
    
    // 2. Remove words from end progressively
    for (let i = words.length - 1; i >= 2; i--) {
      const shortenedTitle = words.slice(0, i).join(' ');
      if (!shortened.includes(shortenedTitle)) {
        shortened.push(shortenedTitle);
      }
    }
    
    // 3. Try just the first word if it's significant
    if (words.length > 0 && words[0].length > 3) {
      const firstWordOnly = words[0];
      if (!shortened.includes(firstWordOnly)) {
        shortened.push(firstWordOnly);
      }
    }
    
    // 4. Try combinations of important words (skip common words)
    const importantWords = words.filter(word => 
      word.length > 3 && 
      !['THE', 'AND', 'WITH', 'UNDER', 'OF', 'FOR', 'TO', 'IN', 'ON', 'AT'].includes(word.toUpperCase())
    );
    
    if (importantWords.length >= 2 && importantWords.length < words.length) {
      const importantOnly = importantWords.join(' ');
      if (!shortened.includes(importantOnly)) {
        shortened.push(importantOnly);
      }
    }
    
    return shortened;
  }

  async getAnimeById(id) {
    // Check cache first
    const cached = await this.cache.getAnimeById(id);
    if (cached && !this.cache.isExpired(cached.cachedAt)) {
      return cached;
    }

    // Rate limit the request
    await this.rateLimiter.waitForSlot();

    const query = `
      query ($id: Int!) {
        Media(id: $id) {
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
          relations {
            edges {
              relationType
              node {
                id
                title {
                  romaji
                }
                type
              }
            }
          }
        }
      }
    `;

    const variables = { id };

    try {
      const response = await this.makeRequest(query, variables);
      
      if (response.errors) {
        throw new Error(`AniList API error: ${response.errors.map(e => e.message).join(', ')}`);
      }

      const result = response.data?.Media;
      
      if (result) {
        // Cache the result
        await this.cache.saveAnimeById(id, result);
      }

      return result;
    } catch (error) {
      console.error('AniList get by ID failed:', error);
      // Return cached data if available, even if expired
      return cached || null;
    }
  }

  async makeRequest(query, variables) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    // AniList API doesn't require authentication for basic queries
    // OAuth would be used for user-specific operations (not implemented yet)
    // For now, we use the public API without authentication
    
    const config = {
      method: 'POST',
      url: this.apiUrl,
      headers: headers,
      data: {
        query: query,
        variables: variables
      },
      timeout: 10000 // 10 second timeout
    };

    try {
      const response = await axios(config);
      
      // Update rate limiter with server response headers
      if (response.headers) {
        this.rateLimiter.updateFromHeaders(response.headers);
      }
      
      return response.data;
    } catch (error) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        // Update rate limiter with server response headers
        if (error.response.headers) {
          this.rateLimiter.updateFromHeaders(error.response.headers);
        }
        
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60');
        console.warn(`Rate limited, waiting ${retryAfter} seconds`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        // Retry the request
        return this.makeRequest(query, variables);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  // Normalize anime title by removing provider tags and formatting
  normalizeTitle(rawTitle) {
    let title = rawTitle;
    
    // Remove provider tags like [JapDub,GerEngSub,CR]
    title = title.replace(/\s*\[.*?\]\s*/g, '');
    
    // Smart parentheses removal - keep important content, remove redundant/descriptive parts
    title = title.replace(/\s*\((English Dub|German Dub|JapDub|GerSub|EngSub|Sub|Dub)\)\s*/gi, ''); // Remove language indicators
    title = title.replace(/\s*\((Season \d+|S\d+)\)\s*/gi, ''); // Remove season indicators in parentheses
    title = title.replace(/\s*\((TV|OVA|ONA|Movie|Special|Music)\)\s*/gi, ''); // Remove format indicators
    
    // Remove season indicators not in parentheses
    title = title.replace(/\s+S\d+.*$/i, ''); // Remove season indicators like "S2", "Season 2"
    title = title.replace(/\s+(Season\s*\d+).*$/i, ''); // Remove "Season X" suffix
    
    // Handle special characters and normalize spacing
    title = title.replace(/－/g, '-'); // Replace em dash with regular dash
    title = title.replace(/[\u2010-\u2015]/g, '-'); // Replace various dashes with regular dash
    title = title.replace(/\s+/g, ' '); // Normalize multiple spaces
    
    // Clean up whitespace and special characters at edges
    title = title.trim();
    
    return title;
  }

  // Calculate title similarity for matching
  calculateSimilarity(title1, title2) {
    const normalize = (str) => {
      return str.toLowerCase()
        .replace(/－/g, '-') // Normalize em dashes
        .replace(/[\u2010-\u2015]/g, '-') // Normalize various dashes
        .replace(/[^\w\d]/g, '') // Keep only word characters and digits
        .replace(/\s+/g, ''); // Remove all spaces
    };
    const norm1 = normalize(title1);
    const norm2 = normalize(title2);
    
    if (norm1 === norm2) return 100;
    
    // Levenshtein distance for similarity
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
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    
    const maxLength = Math.max(norm1.length, norm2.length);
    const similarity = ((maxLength - matrix[norm1.length][norm2.length]) / maxLength) * 100;
    
    return Math.round(similarity);
  }

  // Find best match from search results with season context
  findBestMatch(searchResults, originalTitle, seasonContext = null, threshold = 80) {
    let bestMatch = null;
    let bestScore = 0;
    let bestSeasonMatch = null;
    let bestSeasonScore = 0;
    
    const normalizedOriginal = this.normalizeTitle(originalTitle);
    
    // First pass: find all season matches (these get absolute priority)
    if (seasonContext) {
      for (const anime of searchResults) {
        if (this.matchesSeasonContext(anime, seasonContext)) {
          const titles = [
            anime.title.romaji,
            anime.title.english,
            anime.title.native
          ].filter(Boolean);
          
          for (const title of titles) {
            const score = this.calculateSimilarity(normalizedOriginal, title);
            // Season matches have lower threshold requirement (minimum 40% instead of 80%)
            if (score >= Math.max(threshold - 40, 40) && score > bestSeasonScore) {
              bestSeasonScore = score;
              bestSeasonMatch = { ...anime, matchScore: score, seasonMatch: true };
            }
          }
        }
      }
      
      // If we found any valid season match, return the best one (season match has absolute priority)
      if (bestSeasonMatch) {
        return bestSeasonMatch;
      }
    }
    
    // Second pass: regular title matching
    for (const anime of searchResults) {
      const titles = [
        anime.title.romaji,
        anime.title.english,
        anime.title.native
      ].filter(Boolean);
      
      for (const title of titles) {
        const score = this.calculateSimilarity(normalizedOriginal, title);
        if (score > bestScore && score >= threshold) {
          bestScore = score;
          bestMatch = { ...anime, matchScore: score };
        }
      }
    }
    
    return bestMatch;
  }

  // Check if anime matches the season context (year/season)
  matchesSeasonContext(anime, seasonContext) {
    if (!anime.seasonYear || !anime.season || !seasonContext) {
      return false;
    }
    
    // Convert season names to match AniList format
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

  // Enhanced search with season context
  async searchAnimeWithContext(title, seasonContext = null) {
    // Check cache first
    const cached = await this.cache.getAnimeByTitleWithMapping(title);
    if (cached && !this.cache.isExpired(cached.cachedAt)) {
      // Even with cache, try to find season match
      if (seasonContext) {
        const seasonMatch = cached.metadata.find(anime => 
          this.matchesSeasonContext(anime, seasonContext)
        );
        if (seasonMatch) {
          return [seasonMatch]; // Return only the season match
        }
        // If we have season context but no season match in cache, make a fresh API call
        // Continue to make API call instead of returning cached data
      } else {
        // No season context, return cached data
        return cached.metadata;
      }
    }

    // Rate limit the request
    await this.rateLimiter.waitForSlot();

    // Enhanced query that includes season/year filters when available
    let queryVars = { search: title };
    let seasonFilter = '';
    
    if (seasonContext) {
      const seasonMap = {
        'winter': 'WINTER',
        'spring': 'SPRING', 
        'summer': 'SUMMER',
        'fall': 'FALL',
        'autumn': 'FALL'
      };
      
      const expectedSeason = seasonMap[seasonContext.seasonName.toLowerCase()];
      if (expectedSeason) {
        seasonFilter = `, season: ${expectedSeason}, seasonYear: ${seasonContext.year}`;
        queryVars.season = expectedSeason;
        queryVars.seasonYear = seasonContext.year;
      }
    }

    const query = `
      query ($search: String!, $season: MediaSeason, $seasonYear: Int) {
        Page(page: 1, perPage: 10) {
          pageInfo {
            hasNextPage
          }
          media(search: $search, type: ANIME${seasonContext ? ', season: $season, seasonYear: $seasonYear' : ''}) {
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
            meanScore
            episodes
            nextAiringEpisode {
              episode
              airingAt
              timeUntilAiring
            }
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
      }
    `;

    try {
      const response = await this.makeRequest(query, queryVars);
      
      if (response.errors) {
        throw new Error(`AniList API error: ${response.errors.map(e => e.message).join(', ')}`);
      }

      const results = response.data?.Page?.media || [];
      
      // If season search returns no results, try fallback strategies
      if (results.length === 0 && seasonContext) {
        return await this.searchWithFallbacks(title, seasonContext);
      }
      
      // Cache the results
      if (results.length > 0) {
        await this.cache.saveAnimeMetadata(title, results);
      }

      return results;
    } catch (error) {
      console.error('AniList search failed:', error);
      // Return cached data if available, even if expired
      return cached ? cached.metadata : [];
    }
  }

  // Multiple fallback search strategies for complex titles
  async searchWithFallbacks(originalTitle, seasonContext = null) {
    // First get alternative titles using improved parsing
    const alternativeTitles = this.versionParser.getAlternativeSearchTitles(originalTitle);
    
    const fallbackStrategies = [
      // Strategy 1: Try without season context
      async () => {
        return await this.searchAnime(originalTitle);
      },
      
      // Strategy 2: Try alternative title variants (Romanji/English)
      async () => {
        if (alternativeTitles.length > 1) { // Only if we have actual alternatives
          for (const altTitle of alternativeTitles) {
            if (altTitle !== originalTitle) {
              const results = await this.searchAnime(altTitle);
              if (results.length > 0) {
                return results;
              }
              // Small delay between alternative searches
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
        return [];
      },
      
      // Strategy 3: Try with more aggressive normalization
      async () => {
        const aggressiveTitle = this.aggressiveNormalize(originalTitle);
        return aggressiveTitle !== originalTitle ? await this.searchAnime(aggressiveTitle) : [];
      },
      
      // Strategy 4: Progressive title shortening  
      async () => {
        const shortenedTitles = this.generateShortenedTitles(originalTitle);
        for (const shortenedTitle of shortenedTitles) {
          const results = await this.searchAnime(shortenedTitle);
          if (results.length > 0) {
            return results;
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        return [];
      },
      
      // Strategy 5: Key terms extraction
      async () => {
        const keyTerms = this.extractKeyTerms(originalTitle);
        if (keyTerms && keyTerms !== originalTitle) {
          return await this.searchAnime(keyTerms);
        }
        return [];
      },
      
      // Strategy 6: German title keyword search (for titles like "Mein Schulgeist Hanako")
      async () => {
        const germanKeywords = this.extractGermanKeywords(originalTitle);
        if (germanKeywords.length > 0) {
          for (const keyword of germanKeywords) {
            const results = await this.searchAnime(keyword);
            if (results.length > 0) {
              return results;
            }
            // Small delay between keyword searches
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        return [];
      },
      
      // Strategy 5: Try parentheses content as search term
      async () => {
        const parenthesesMatch = originalTitle.match(/\(([^)]+)\)/);
        if (parenthesesMatch && parenthesesMatch[1]) {
          const parenthesesContent = parenthesesMatch[1];
          // Skip if it's just descriptive text
          if (!/^(English|German|Jap|Sub|Dub|TV|OVA|Movie|Special|Animation Project)$/i.test(parenthesesContent)) {
            return await this.searchAnime(parenthesesContent);
          }
        }
        return [];
      }
    ];

    // Try each fallback strategy
    for (const [index, strategy] of fallbackStrategies.entries()) {
      try {
        const results = await strategy();
        if (results && results.length > 0) {
          return results;
        }
      } catch (error) {
        console.error(`Fallback strategy ${index + 1} failed:`, error);
      }
      
      // Small delay between strategies to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return [];
  }

  // More aggressive title normalization for fallback searches
  aggressiveNormalize(title) {
    let normalized = title;
    
    // Remove everything in parentheses and brackets
    normalized = normalized.replace(/\s*[\[\(].*?[\]\)]\s*/g, '');
    
    // Remove version numbers and special characters
    normalized = normalized.replace(/\d+\.\d+/g, ''); // Remove version numbers like 2.0
    normalized = normalized.replace(/[#＃]/g, ''); // Remove hash symbols
    normalized = normalized.replace(/[－–—-]/g, ' '); // Replace all dashes with spaces
    normalized = normalized.replace(/[^\w\s]/g, ' '); // Replace non-word characters with spaces
    
    // Clean up whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }

  // Extract key identifying terms from complex titles
  extractKeyTerms(title) {
    let keyTerms = title;
    
    // For titles with multiple parts separated by special characters, take the first significant part
    const parts = title.split(/[－–—\-]/);
    if (parts.length > 1) {
      // Take the first part if it's substantial (more than 3 characters)
      const firstPart = parts[0].trim();
      if (firstPart.length > 3) {
        keyTerms = firstPart;
      }
    }
    
    // Clean up the key terms
    keyTerms = keyTerms.replace(/[#＃]/g, '').trim(); // Remove hash symbols
    keyTerms = keyTerms.replace(/^\d+\.\d+\s*/, ''); // Remove version numbers at start
    
    return keyTerms;
  }

  // Extract German keywords and generate search terms for anime titles
  extractGermanKeywords(title) {
    const keywords = [];
    
    // Common German-to-English anime title patterns
    const germanPatterns = [
      // Pattern: "Mein <something> <Name>" -> try just the name
      { pattern: /^Mein\s+\w+\s+(\w+)$/i, extract: (match) => match[1] },
      { pattern: /^Meine\s+\w+\s+(\w+)$/i, extract: (match) => match[1] },
      
      // Pattern: "<German word> <Japanese name>" -> try the Japanese name
      { pattern: /^\w+\s+([\w-]+)$/i, extract: (match) => match[1] },
      
      // Pattern: Extract anything that looks Japanese (contains common Japanese name patterns)
      { pattern: /(\w*(?:ko|kun|chan|san|sama|senpai|sensei)\w*)/gi, extract: (match) => match[0] },
      
      // Pattern: Extract capitalized words that might be names
      { pattern: /\b[A-Z][a-z]+\b/g, extract: (match) => match[0] }
    ];

    // Try each pattern
    for (const { pattern, extract } of germanPatterns) {
      if (pattern.global) {
        // Global patterns can match multiple times
        let match;
        while ((match = pattern.exec(title)) !== null) {
          const extracted = extract(match);
          if (extracted && extracted.length > 2 && !keywords.includes(extracted)) {
            keywords.push(extracted);
          }
        }
      } else {
        // Single match patterns
        const match = title.match(pattern);
        if (match) {
          const extracted = extract(match);
          if (extracted && extracted.length > 2 && !keywords.includes(extracted)) {
            keywords.push(extracted);
          }
        }
      }
    }

    // For "Mein Schulgeist Hanako" specifically, also try "Hanako"
    if (title.toLowerCase().includes('hanako')) {
      keywords.push('Hanako');
      // Also try common variants
      keywords.push('Hanako kun');
      keywords.push('Jibaku Shounen Hanako');
    }

    // Remove duplicates and filter out common German words
    const germanStopwords = ['mein', 'meine', 'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'mit', 'von', 'zu', 'in', 'auf', 'für', 'bei'];
    const filtered = keywords.filter(keyword => 
      keyword.length > 2 && 
      !germanStopwords.includes(keyword.toLowerCase())
    );

    return [...new Set(filtered)]; // Remove duplicates
  }
}