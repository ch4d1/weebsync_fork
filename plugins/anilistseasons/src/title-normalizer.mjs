export class TitleNormalizer {
  constructor() {
    // Configurable source mappings (TAG -> Full Name)
    this.sourceMappings = new Map([
      ['CR', 'Crunchyroll'],
      ['ADN', 'Animation Digital Network'],
      ['DSNP', 'Disney+'],
      ['AMZ', 'Amazon Prime Video'],
      ['NF', 'Netflix'],
      ['FLE', 'Funimation'],
      ['GJM', 'GJM-subs']
    ]);

    // Language code mappings (Full Name -> ISO Code)
    this.languageMappings = new Map([
      ['Jap', 'JA'],
      ['Japanese', 'JA'],
      ['Ger', 'DE'],
      ['German', 'DE'],
      ['Eng', 'EN'],
      ['English', 'EN'],
      ['Fra', 'FR'],
      ['French', 'FR'],
      ['Spa', 'ES'],
      ['Spanish', 'ES'],
      ['Ita', 'IT'],
      ['Italian', 'IT'],
      ['Por', 'PT'],
      ['Portuguese', 'PT'],
      ['Rus', 'RU'],
      ['Russian', 'RU'],
      ['Kor', 'KO'],
      ['Korean', 'KO'],
      ['Chi', 'ZH'],
      ['Chinese', 'ZH']
    ]);

    // Common provider tags patterns
    this.providerPatterns = [
      /\[.*?\]/g, // [JapDub,GerEngSub,CR]
      /\(.*?\)/g, // (Alternative Title)
    ];

    // Season/episode patterns
    this.seasonPatterns = [
      /\s+S\d+.*$/i,
      /\s+Season\s*\d+.*$/i,
      /\s+Part\s*\d+.*$/i,
      /\s+Saison\s*\d+.*$/i, // German
    ];

    // Common anime title prefixes/suffixes to clean
    this.cleanupPatterns = [
      /^The\s+/i,
      /\s+\-\s+.*$/,
      /\s+TV$/i,
      /\s+OVA$/i,
      /\s+Movie$/i,
      /\s+Special$/i,
    ];

    // Provider abbreviations
    this.providers = new Set([
      'CR', 'ADN', 'DSNP', 'AMZ', 'NF', 'ANV'
    ]);
  }

  // Extract clean anime title from directory name
  normalizeTitle(rawTitle) {
    let title = rawTitle.trim();

    // Remove provider tags
    for (const pattern of this.providerPatterns) {
      title = title.replace(pattern, ' ');
    }

    // Remove season indicators
    for (const pattern of this.seasonPatterns) {
      title = title.replace(pattern, '');
    }

    // Apply cleanup patterns
    for (const pattern of this.cleanupPatterns) {
      title = title.replace(pattern, '');
    }

    // Clean up whitespace and special characters
    title = title
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .replace(/[-_]+/g, ' ') // Dashes and underscores to spaces
      .trim();


    return title;
  }

  // Extract version information from directory name
  extractVersionInfo(rawTitle) {
    const versions = [];
    const languages = {
      dub: [],
      sub: []
    };

    // Extract provider tags
    const providerMatches = rawTitle.match(/\[([^\]]+)\]/g) || [];

    for (const match of providerMatches) {
      const content = match.slice(1, -1); // Remove brackets
      const parts = content.split(',').map(p => p.trim());

      for (const part of parts) {
        // Check for providers
        if (this.providers.has(part)) {
          versions.push(part);
        }

        // Check for language info
        if (part.includes('Dub')) {
          const langMatch = part.match(/^(\w+)Dub$/);
          if (langMatch) {
            languages.dub.push(langMatch[1]);
          }
        }

        if (part.includes('Sub')) {
          const langMatch = part.match(/^(\w+)Sub$/);
          if (langMatch) {
            languages.sub.push(langMatch[1]);
          }
        }
      }
    }

    // Extract from standalone parts
    const parts = rawTitle.split(/[\s\-_]+/);
    for (const part of parts) {
      if (this.providers.has(part)) {
        if (!versions.includes(part)) {
          versions.push(part);
        }
      }
    }

    return {
      providers: versions,
      dubLanguages: languages.dub,
      subLanguages: languages.sub,
      hasMultipleVersions: versions.length > 1
    };
  }

  // Group anime titles by base name
  groupAnimeVersions(animeList) {
    const groups = new Map();

    for (const anime of animeList) {
      const normalizedTitle = this.normalizeTitle(anime.name);
      const versionInfo = this.extractVersionInfo(anime.name);

      if (!groups.has(normalizedTitle)) {
        groups.set(normalizedTitle, {
          baseTitle: normalizedTitle,
          versions: [],
          metadata: null // Will be populated by AniList data
        });
      }

      const group = groups.get(normalizedTitle);
      group.versions.push({
        originalName: anime.name,
        versionInfo: versionInfo,
        fileInfo: anime
      });
    }

    return Array.from(groups.values());
  }

  // Update source mappings from config string
  updateSourceMappings(configString) {
    if (!configString) return;

    const mappings = configString.split(',').map(s => s.trim());
    this.sourceMappings.clear();

    for (const mapping of mappings) {
      const [key, value] = mapping.split('=').map(s => s.trim());
      if (key && value) {
        this.sourceMappings.set(key, value);
      }
    }
  }

  // Extract structured version information with mapped sources and ISO codes
  extractStructuredVersionInfo(rawTitle) {
    const versionInfo = this.extractVersionInfo(rawTitle);

    // Map providers to full names
    const mappedProviders = versionInfo.providers.map(provider => {
      return {
        tag: provider,
        name: this.sourceMappings.get(provider) || provider
      };
    });

    // Convert language names to ISO codes
    const convertToISOCodes = (languages) => {
      return languages.map(lang => {
        // First try direct mapping
        let isoCode = this.languageMappings.get(lang);
        if (isoCode) return isoCode;

        // Try with first 3 characters + common suffixes
        const shortened = lang.substring(0, 3);
        isoCode = this.languageMappings.get(shortened);
        if (isoCode) return isoCode;

        // Fallback to original if no mapping found
        return lang;
      });
    };

    return {
      providers: mappedProviders,
      dubLanguages: convertToISOCodes(versionInfo.dubLanguages),
      subLanguages: convertToISOCodes(versionInfo.subLanguages),
      hasMultipleVersions: versionInfo.hasMultipleVersions,
      // Legacy format for backward compatibility
      rawProviders: versionInfo.providers,
      rawDubLanguages: versionInfo.dubLanguages,
      rawSubLanguages: versionInfo.subLanguages
    };
  }

  // Check if directory name looks like an anime series
  looksLikeAnime(directoryName) {
    // Skip obviously non-anime directories
    const skipPatterns = [
      /^\./, // Hidden directories
      /^temp/i,
      /^backup/i,
      /^old/i,
      /^\d{4}-\d{2}-\d{2}/i, // Date format
    ];

    for (const pattern of skipPatterns) {
      if (pattern.test(directoryName)) {
        return false;
      }
    }

    // Look for anime-like patterns
    const animePatterns = [
      /\[.*\]/,  // Has provider tags
      /\bS\d+\b/i, // Has season indicator
      /\bSeason\s*\d+/i,
      /\bPart\s*\d+/i,
      /\b(JapDub|GerSub|EngSub)\b/i, // Language indicators
    ];

    return animePatterns.some(pattern => pattern.test(directoryName));
  }

  // Clean title for search (more aggressive)
  cleanForSearch(title) {
    let cleaned = this.normalizeTitle(title);

    // Remove additional noise for better search results
    cleaned = cleaned
      .replace(/[^\w\s-]/g, '') // Remove special characters except dash
      .replace(/\b(the|a|an)\b/gi, '') // Remove articles
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  // Get similarity score between two titles
  calculateSimilarity(title1, title2) {
    const clean1 = this.cleanForSearch(title1).toLowerCase();
    const clean2 = this.cleanForSearch(title2).toLowerCase();

    if (clean1 === clean2) return 100;

    // Check for exact substring matches
    if (clean1.includes(clean2) || clean2.includes(clean1)) {
      const longer = Math.max(clean1.length, clean2.length);
      const shorter = Math.min(clean1.length, clean2.length);
      return Math.round((shorter / longer) * 90);
    }

    // Levenshtein distance
    return this.levenshteinSimilarity(clean1, clean2);
  }

  levenshteinSimilarity(str1, str2) {
    const matrix = Array(str1.length + 1).fill(null).map(() =>
      Array(str2.length + 1).fill(null)
    );

    for (let i = 0; i <= str1.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= str2.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const maxLength = Math.max(str1.length, str2.length);
    const similarity = ((maxLength - matrix[str1.length][str2.length]) / maxLength) * 100;

    return Math.round(similarity);
  }
}
