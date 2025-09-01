export class VersionParser {
  constructor(config = {}) {
    // Initialize empty providers - will be populated from config
    this.providers = {};

    // Initialize with minimal fallback configuration
    this.updateSourceMappings(config.sourceMappings || []);

    // Language mappings with standardized 3-letter codes
    this.languages = {
      'Jap': { code: 'Jap', full: 'Japanese' },
      'Ger': { code: 'Ger', full: 'German' },
      'Eng': { code: 'Eng', full: 'English' },
      'Kor': { code: 'Kor', full: 'Korean' },
      'Chi': { code: 'Chi', full: 'Chinese' }
    };
  }

  // Update source mappings from configuration (string or array)
  updateSourceMappings(config) {
    // Clear existing providers
    this.providers = {};

    // Default colors for common providers
    const defaultColors = {
      'CR': '#F47521',
      'ADN': '#0099FF',
      'NF': '#E50914',
      'AMZ': '#00A8E1',
      'DSNP': '#113CCF',
      'ANV': '#FF6B6B'
    };

    // Handle empty config
    if (!config || (typeof config === 'string' && config.trim() === '') || (Array.isArray(config) && config.length === 0)) {
      // Minimal fallback - just use tags as names
      const fallbackTags = ['CR', 'ADN', 'NF', 'AMZ', 'DSNP', 'ANV'];
      for (const tag of fallbackTags) {
        this.providers[tag] = {
          name: tag, // Use tag as name if no config
          color: defaultColors[tag] || '#666666'
        };
      }
      return;
    }

    // Convert config to array format
    let mappings;
    if (typeof config === 'string') {
      // Legacy string format: "CR=Crunchyroll|#F47521,ADN=Animation Digital Network,..."
      mappings = config.split(',').map(s => s.trim()).filter(s => s.includes('='));
    } else if (Array.isArray(config)) {
      // New array format: ["CR=Crunchyroll|#F47521", "ADN=Animation Digital Network", ...]
      mappings = config.filter(s => typeof s === 'string' && s.includes('='));
    } else {
      // Invalid config type, use fallback
      mappings = [];
    }

    for (const mapping of mappings) {
      const [tag, nameColorPart] = mapping.split('=').map(s => s.trim());
      if (tag && nameColorPart) {
        let name, color;

        if (nameColorPart.includes('|')) {
          // Format: "Crunchyroll|#F47521"
          const [namePart, colorPart] = nameColorPart.split('|').map(s => s.trim());
          name = namePart;
          color = colorPart && colorPart.match(/^#[0-9A-Fa-f]{6}$/) ? colorPart : (defaultColors[tag] || '#666666');
        } else {
          // Format: "Crunchyroll" (name only)
          name = nameColorPart;
          color = defaultColors[tag] || '#666666';
        }

        this.providers[tag] = {
          name: name,
          color: color
        };
      }
    }
  }

  // Parse combined language codes like "GerJapEng" -> ["Ger", "Jap", "Eng"]
  // Each language code is exactly 3 characters
  parseLanguageCodes(combinedCode) {
    const codes = [];

    // Split into 3-character chunks
    for (let i = 0; i < combinedCode.length; i += 3) {
      const langCode = combinedCode.substring(i, i + 3);
      if (langCode.length === 3 && this.languages[langCode]) {
        codes.push(langCode);
      }
    }

    return codes;
  }

  // Parse directory name to extract all version information
  parseVersionInfo(directoryName) {
    const result = {
      baseTitle: '',
      providers: [],
      audio: [],
      subtitles: [],
      quality: null,
      season: null,
      special: false,
      raw: directoryName
    };

    // Extract content within brackets [...] including incomplete brackets
    const bracketMatches = directoryName.match(/\[([^\]]+)\]/g) || [];

    // Also check for incomplete bracket at the end
    const incompleteBracketMatch = directoryName.match(/\[([^\]]+)$/);
    if (incompleteBracketMatch) {
      bracketMatches.push(incompleteBracketMatch[0]);
    }

    let cleanTitle = directoryName;

    for (const match of bracketMatches) {
      const content = match.replace(/^\[/, '').replace(/\]$/, ''); // Remove brackets if present
      const parts = content.split(',').map(p => p.trim());

      for (const part of parts) {
        // Check for providers - including combinations like CR+ADN+NF
        const providerCodes = part.split('+').map(p => p.trim());
        for (const providerCode of providerCodes) {
          if (this.providers[providerCode]) {
            result.providers.push({
              tag: providerCode,
              name: this.providers[providerCode].name,
              color: this.providers[providerCode].color
            });
          }
        }

        // Check for audio (Dub) - including combined language codes like GerJapEngDub
        const dubMatch = part.match(/^(.+)Dub$/);
        if (dubMatch) {
          const langCodes = this.parseLanguageCodes(dubMatch[1]);
          for (const langCode of langCodes) {
            const language = this.languages[langCode];
            if (language) {
              result.audio.push({
                code: language.code,
                language: language.full,
                type: 'dub'
              });
            }
          }
        }

        // Check for subtitles (Sub) - including combined language codes like GerEngSpaSub
        const subMatch = part.match(/^(.+)Sub$/);
        if (subMatch) {
          const langCodes = this.parseLanguageCodes(subMatch[1]);
          for (const langCode of langCodes) {
            const language = this.languages[langCode];
            if (language) {
              result.subtitles.push({
                code: language.code,
                language: language.full,
                type: 'sub'
              });
            }
          }
        }

        // Check for quality indicators
        if (/1080p|720p|480p|4K|BluRay|BD|WEB-DL/i.test(part)) {
          result.quality = part;
        }
      }

      // Remove bracket content from title
      cleanTitle = cleanTitle.replace(match, '');
    }

    // Extract season information
    const seasonMatch = cleanTitle.match(/\b(?:Season|S)\s*(\d+)/i);
    if (seasonMatch) {
      result.season = parseInt(seasonMatch[1]);
      cleanTitle = cleanTitle.replace(seasonMatch[0], '');
    }

    // Check for special indicators
    if (/\b(?:OVA|Special|Movie|Film)\b/i.test(cleanTitle)) {
      result.special = true;
    }

    // Clean up the base title
    result.baseTitle = cleanTitle
      .replace(/\s+\-\s+.*$/, '') // Remove everything after " - "
      .replace(/\s+/g, ' ')
      .trim();

    return result;
  }

  // Generate structured version information for display
  generateVersionDescription(versionInfo) {
    // Return structured data instead of concatenated string
    const structured = {
      providers: [],
      dubLanguages: [],
      subLanguages: [],
      quality: versionInfo.quality || null,
      season: versionInfo.season || null,
      special: versionInfo.special || false
    };

    // Add providers (remove duplicates)
    if (versionInfo.providers.length > 0) {
      const uniqueProviders = versionInfo.providers.filter((provider, index, self) =>
        index === self.findIndex(p => p.tag === provider.tag)
      );
      structured.providers = uniqueProviders.map(p => ({
        tag: p.tag,
        name: p.name,
        color: p.color
      }));
    }

    // Add audio languages (remove duplicates)
    if (versionInfo.audio.length > 0) {
      const uniqueAudio = versionInfo.audio.filter((audio, index, self) =>
        index === self.findIndex(a => a.code === audio.code)
      );
      structured.dubLanguages = uniqueAudio.map(a => ({
        code: a.code,
        language: a.language
      }));
    }

    // Add subtitle languages (remove duplicates)
    if (versionInfo.subtitles.length > 0) {
      const uniqueSubs = versionInfo.subtitles.filter((sub, index, self) =>
        index === self.findIndex(s => s.code === sub.code)
      );
      structured.subLanguages = uniqueSubs.map(s => ({
        code: s.code,
        language: s.language
      }));
    }

    return structured;
  }

  // Legacy method for backward compatibility - generates simple text description
  generateSimpleVersionDescription(versionInfo) {
    const parts = [];

    // Add providers (remove duplicates)
    if (versionInfo.providers.length > 0) {
      const uniqueProviders = versionInfo.providers.filter((provider, index, self) =>
        index === self.findIndex(p => p.tag === provider.tag)
      );
      const providerNames = uniqueProviders.map(p => p.name);
      parts.push(`Source: ${providerNames.join(', ')}`);
    }

    // Add audio languages (remove duplicates)
    if (versionInfo.audio.length > 0) {
      const uniqueAudio = versionInfo.audio.filter((audio, index, self) =>
        index === self.findIndex(a => a.code === audio.code)
      );
      const audioLangs = uniqueAudio.map(a => `${a.code}`);
      parts.push(`Audio: ${audioLangs.join(', ')}`);
    }

    // Add subtitle languages (remove duplicates)
    if (versionInfo.subtitles.length > 0) {
      const uniqueSubs = versionInfo.subtitles.filter((sub, index, self) =>
        index === self.findIndex(s => s.code === sub.code)
      );
      const subLangs = uniqueSubs.map(s => `${s.code}`);
      parts.push(`Subtitles: ${subLangs.join(', ')}`);
    }

    // Add quality
    if (versionInfo.quality) {
      parts.push(`Quality: ${versionInfo.quality}`);
    }

    // Add season
    if (versionInfo.season) {
      parts.push(`Season ${versionInfo.season}`);
    }

    // Add special indicator
    if (versionInfo.special) {
      parts.push('Special/OVA');
    }

    return parts.join(' | ');
  }

  // Group multiple versions of the same anime
  groupVersions(fileList) {
    const groups = new Map();

    for (const file of fileList) {
      if (file.type === 2) { // Directory
        const versionInfo = this.parseVersionInfo(file.name);
        const baseTitle = versionInfo.baseTitle;

        if (!groups.has(baseTitle)) {
          groups.set(baseTitle, {
            baseTitle: baseTitle,
            versions: [],
            metadata: file.animeMetadata || null
          });
        }

        const group = groups.get(baseTitle);
        group.versions.push({
          ...file,
          versionInfo: versionInfo,
          versionDescription: this.generateVersionDescription(versionInfo),
          simpleVersionDescription: this.generateSimpleVersionDescription(versionInfo)
        });

        // Use the first version's metadata for the group
        if (!group.metadata && file.animeMetadata) {
          group.metadata = file.animeMetadata;
        }
      }
    }

    // Convert groups to array and add non-anime files
    const result = [];

    // Add grouped anime
    for (const [baseTitle, group] of groups) {
      if (group.versions.length > 1) {
        // Multiple versions - create grouped entry
        result.push({
          name: baseTitle,
          type: 2, // Directory
          isGrouped: true,
          versions: group.versions,
          animeMetadata: group.metadata,
          versionCount: group.versions.length,
          primaryVersion: group.versions[0] // Use first version as primary
        });
      } else {
        // Single version - add as-is with version info
        result.push(group.versions[0]);
      }
    }

    // Add non-directory files
    for (const file of fileList) {
      if (file.type !== 2) {
        result.push(file);
      }
    }

    return result;
  }

  // Check if a directory name looks like it has version tags
  hasVersionTags(directoryName) {
    return /\[.*?\]/.test(directoryName) ||
           /\b(?:CR|ADN|NF|AMZ|DSNP|ANV|GJM)\b/.test(directoryName);
  }

  // Extract clean title for AniList search - follows format: <Romanji> (<English>) [<MetaData>]
  extractSearchTitle(directoryName) {
    let title = directoryName;

    // Step 1: Remove metadata brackets first (including incomplete brackets)
    title = title.replace(/\[.*?\]/g, ''); // Complete brackets
    title = title.replace(/\[.*$/g, ''); // Incomplete bracket at end

    // Step 2: Parse format: <Romanji> (<English>) or just (<English>) or just Romanji
    // Special handling for titles starting with parentheses (e.g., "(Only English)")
    let romanji = '';
    let english = '';

    if (title.startsWith('(') && title.includes(')')) {
      // Title starts with parentheses - treat entire content as English
      const parenMatch = title.match(/^\(([^)]+)\)(.*)$/);
      if (parenMatch) {
        english = parenMatch[1]?.trim();
        romanji = parenMatch[2]?.trim();
      }
    } else {
      // Standard format: <Romanji> (<English>)
      const lastParenIndex = title.lastIndexOf('(');
      if (lastParenIndex > 0) {
        romanji = title.substring(0, lastParenIndex).trim();
        const parenContent = title.substring(lastParenIndex).match(/\(([^)]+)\)/);
        if (parenContent) {
          english = parenContent[1]?.trim();
        }
      } else {
        // No parentheses at all
        romanji = title;
      }
    }

    // Step 3: Clean both parts separately BEFORE removing season/special indicators
    let cleanRomanji = romanji || '';
    let cleanEnglish = english || '';

    // Remove season indicators from both parts
    cleanRomanji = cleanRomanji.replace(/\b(?:Season\s*|S\s*)\d+/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\b(?:Season\s*|S\s*)\d+/gi, '').trim();

    // Remove "Part X" from both parts (conservative approach - only remove explicit Part patterns)
    cleanRomanji = cleanRomanji.replace(/\bPart\s+\d+/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\bPart\s+\d+/gi, '').trim();

    // Remove special indicators from both parts
    cleanRomanji = cleanRomanji.replace(/\b(?:OVA|Special|Movie|Film|TV)\b/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\b(?:OVA|Special|Movie|Film|TV)\b/gi, '').trim();

    // Remove provider names
    const providerPattern = new RegExp(`\\b(?:${Object.keys(this.providers).join('|')})\\b`, 'g');
    cleanRomanji = cleanRomanji.replace(providerPattern, '').trim();
    cleanEnglish = cleanEnglish.replace(providerPattern, '').trim();

    // Remove quality indicators
    cleanRomanji = cleanRomanji.replace(/\b(?:1080p|720p|480p|4K|BluRay|BD|WEB-DL)\b/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\b(?:1080p|720p|480p|4K|BluRay|BD|WEB-DL)\b/gi, '').trim();

    // Final cleanup
    cleanRomanji = cleanRomanji
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleanEnglish = cleanEnglish
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Step 4: Return priority - English title preferred if available
    if (cleanEnglish && cleanEnglish.length > 0) {
      return cleanEnglish;
    } else if (cleanRomanji && cleanRomanji.length > 0) {
      return cleanRomanji;
    }

    // Fallback: clean up the whole title
    title = title
      .replace(/[-_]+/g, ' ') // Replace dashes/underscores with spaces
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .trim();

    return title;
  }

  // Extract search title with season information for AniList API
  extractSearchTitleWithSeason(directoryName) {
    let title = directoryName;
    let season = null;

    // Step 1: Remove metadata brackets first (including incomplete brackets)
    title = title.replace(/\[.*?\]/g, ''); // Complete brackets
    title = title.replace(/\[.*$/g, ''); // Incomplete bracket at end

    // Step 2: Extract season information BEFORE removing it
    // ONLY match explicit season markers: S2, Season 2, Part 2
    // NO standalone numbers like "Title 2" or "Kaiju No. 8"
    let seasonMatch = title.match(/\b(?:Season\s*|S\s*)(\d+)/i);
    if (!seasonMatch) {
      // Check for "Part X" pattern
      seasonMatch = title.match(/\bPart\s+(\d+)/i);
    }
    if (seasonMatch) {
      season = parseInt(seasonMatch[1]);
    }

    // Step 3: Parse format and clean title (same logic as extractSearchTitle)
    let romanji = '';
    let english = '';

    if (title.startsWith('(') && title.includes(')')) {
      const parenMatch = title.match(/^\(([^)]+)\)(.*)$/);
      if (parenMatch) {
        english = parenMatch[1]?.trim();
        romanji = parenMatch[2]?.trim();
      }
    } else {
      const lastParenIndex = title.lastIndexOf('(');
      if (lastParenIndex > 0) {
        romanji = title.substring(0, lastParenIndex).trim();
        const parenContent = title.substring(lastParenIndex).match(/\(([^)]+)\)/);
        if (parenContent) {
          english = parenContent[1]?.trim();
        }
      } else {
        romanji = title;
      }
    }

    // Step 4: Clean both parts
    let cleanRomanji = romanji || '';
    let cleanEnglish = english || '';

    // Remove season indicators from both parts
    cleanRomanji = cleanRomanji.replace(/\b(?:Season\s*|S\s*)\d+/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\b(?:Season\s*|S\s*)\d+/gi, '').trim();

    // Remove "Part X" from both parts (since we only detect explicit Part patterns)
    cleanRomanji = cleanRomanji.replace(/\bPart\s+\d+/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\bPart\s+\d+/gi, '').trim();

    // Remove special indicators
    cleanRomanji = cleanRomanji.replace(/\b(?:OVA|Special|Movie|Film|TV)\b/gi, '').trim();
    cleanEnglish = cleanEnglish.replace(/\b(?:OVA|Special|Movie|Film|TV)\b/gi, '').trim();

    // Remove provider names
    const providerPattern = new RegExp(`\\b(?:${Object.keys(this.providers).join('|')})\\b`, 'g');
    cleanRomanji = cleanRomanji.replace(providerPattern, '').trim();
    cleanEnglish = cleanEnglish.replace(providerPattern, '').trim();

    // Final cleanup
    cleanRomanji = cleanRomanji.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    cleanEnglish = cleanEnglish.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Step 5: Choose best title with fallback logic
    let searchTitle = (cleanEnglish && cleanEnglish.length > 0) ? cleanEnglish : cleanRomanji;

    // Step 6: Fallback detection for edge cases
    if (this.isResultInvalid(searchTitle)) {
      searchTitle = this.applyFallbackParsing(directoryName);
    }

    return {
      title: searchTitle,
      season: season,
      originalTitle: directoryName
    };
  }

  // Check if parsing result is invalid and needs fallback
  isResultInvalid(title) {
    if (!title || title.length < 3) return true;

    // Check for problematic patterns
    const problematicPatterns = [
      /^[+\-*]+$/, // Only symbols like "+", "++", "-"
      /^[()]+$/, // Only parentheses
      /^[A-Z]$/, // Single letters like "A"
      /^\d{1,2}$/, // Single or double digits only
      /^[+\-*\s]+$/ // Only symbols and spaces
    ];

    return problematicPatterns.some(pattern => pattern.test(title.trim()));
  }

  // Apply fallback parsing for edge cases
  applyFallbackParsing(originalTitle) {
    // Remove brackets first for clean processing
    let fallbackTitle = originalTitle.replace(/\[.*?\]/g, '').replace(/\[.*$/g, '').trim();

    // Pattern 1: "Title (Season X + Special)" -> extract "Title"
    let match = fallbackTitle.match(/^(.+?)\s*\((?:Season\s*\d+|S\d+)?\s*[+].*?\)(.*)$/i);
    if (match) {
      const beforeParen = match[1].trim();
      const afterParen = match[2].trim();
      return afterParen.length > beforeParen.length ? afterParen : beforeParen;
    }

    // Pattern 2: "Title (+Something)" -> extract "Title"
    match = fallbackTitle.match(/^(.+?)\s*\([+].*?\)(.*)$/);
    if (match) {
      const beforeParen = match[1].trim();
      const afterParen = match[2].trim();
      return afterParen.length > 0 ? afterParen : beforeParen;
    }

    // Pattern 3: "Title(X)Rest" -> extract "Title" + "Rest"
    match = fallbackTitle.match(/^(.+?)\([^)]*\)(.+)$/);
    if (match) {
      return (match[1] + ' ' + match[2]).replace(/\s+/g, ' ').trim();
    }

    // Pattern 4: Extract everything before first parenthesis if it's substantial
    match = fallbackTitle.match(/^([^(]+)/);
    if (match && match[1].trim().length > 3) {
      return match[1].trim();
    }

    // Final fallback: return original title without brackets
    return fallbackTitle;
  }

  // Get alternative search titles for better matching
  getAlternativeSearchTitles(directoryName) {
    let title = directoryName;

    // Remove all bracketed content first
    title = title.replace(/\[.*?\]/g, '');

    // Remove season/special indicators
    title = title.replace(/\b(?:Season|S)\s*\d+/gi, '');
    title = title.replace(/\b(?:OVA|Special|Movie|Film|TV)\b/gi, '');

    // Parse format: <Romanji> (<English>)
    const titleMatch = title.match(/^([^(]+)(?:\s*\(([^)]+)\))?/);

    const alternatives = [];

    if (titleMatch) {
      const romanji = titleMatch[1]?.trim()?.replace(/[-_]+/g, ' ')?.replace(/\s+/g, ' ')?.trim();
      const english = titleMatch[2]?.trim()?.replace(/[-_]+/g, ' ')?.replace(/\s+/g, ' ')?.trim();

      if (romanji && romanji.length > 0) {
        alternatives.push(romanji);
      }
      if (english && english.length > 0) {
        alternatives.push(english);
      }
    }

    // Fallback: full cleaned title
    if (alternatives.length === 0) {
      const fallback = title
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (fallback.length > 0) {
        alternatives.push(fallback);
      }
    }

    return alternatives;
  }
}
