export class SeasonParser {
  constructor() {
    // Season directory patterns (YYYY-N Season)
    this.seasonPatterns = [
      /^(\d{4})-(\d{1,2})\s+(\w+)$/,  // 2025-1 Winter
      /^(\d{4})-(\d{1,2})_(\w+)$/,    // 2025-1_Winter
      /^(\d{4})(\d{1,2})\s+(\w+)$/,   // 20251 Winter
      /^Season\s+(\d{4})-(\d{1,2})\s+(\w+)$/i, // Season 2025-1 Winter
    ];

    this.seasonNames = {
      'winter': 1,
      'spring': 2,
      'summer': 3,
      'fall': 4,
    };

    // Cache for TitleNormalizer to avoid re-importing
    this.titleNormalizer = null;
  }

  // Check if a path is a season directory
  isSeasonDirectory(directoryName) {
    for (const pattern of this.seasonPatterns) {
      if (pattern.test(directoryName.trim())) {
        return true;
      }
    }
    return false;
  }

  // Parse season information from directory name
  parseSeasonInfo(directoryName) {
    for (const pattern of this.seasonPatterns) {
      const match = directoryName.trim().match(pattern);
      if (match) {
        const [, year, seasonNum, seasonName] = match;

        return {
          year: parseInt(year),
          seasonNumber: parseInt(seasonNum),
          seasonName: seasonName.toLowerCase(),
          originalName: directoryName,
          isValid: this.validateSeasonInfo(parseInt(year), parseInt(seasonNum), seasonName.toLowerCase())
        };
      }
    }
    return null;
  }

  validateSeasonInfo(year, seasonNum, seasonName) {
    // Validate year (reasonable range)
    if (year < 1960 || year > new Date().getFullYear() + 2) {
      return false;
    }

    // Validate season number (1-4)
    if (seasonNum < 1 || seasonNum > 4) {
      return false;
    }

    // Validate season name matches number
    const expectedSeasonNum = this.seasonNames[seasonName];
    return expectedSeasonNum === seasonNum;
  }

  // Check if we're currently in a season directory context
  isInSeasonContext(currentPath, seasonsRootPath) {
    if (!seasonsRootPath) return false;

    // Check if current path starts with seasons root path
    if (!currentPath.startsWith(seasonsRootPath)) {
      return false;
    }

    // Parse the path to see if we're in a season directory
    const relativePath = currentPath.substring(seasonsRootPath.length);
    const pathParts = relativePath.split('/').filter(part => part.length > 0);

    // Check if any part of the path is a season directory
    for (const part of pathParts) {
      if (this.isSeasonDirectory(part)) {
        return true;
      }
    }

    return false;
  }

  // Get season context from current path
  getSeasonContext(currentPath, seasonsRootPath) {
    if (!this.isInSeasonContext(currentPath, seasonsRootPath)) {
      return null;
    }

    const relativePath = currentPath.substring(seasonsRootPath.length);
    const pathParts = relativePath.split('/').filter(part => part.length > 0);

    // Find the season directory part
    for (const part of pathParts) {
      const seasonInfo = this.parseSeasonInfo(part);
      if (seasonInfo && seasonInfo.isValid) {
        return {
          ...seasonInfo,
          fullPath: currentPath,
          relativePath: relativePath
        };
      }
    }

    return null;
  }

  // Initialize title normalizer if not already done
  async getTitleNormalizer() {
    if (!this.titleNormalizer) {
      const { TitleNormalizer } = await import('./title-normalizer.mjs');
      this.titleNormalizer = new TitleNormalizer();
    }
    return this.titleNormalizer;
  }

  // IMPORTANT: Create enhanced directory listing while preserving original functionality
  async enhanceDirectoryListing(originalFileInfoList, seasonContext, groupVersions = true) {
    if (!seasonContext || !originalFileInfoList) {
      // Return original list unchanged if not in season context
      return {
        enhanced: false,
        directories: originalFileInfoList,
        animeGroups: [],
        preserveOriginalSelection: true // Critical: ensure sync can select original paths
      };
    }

    const directories = [];
    const animeGroups = [];
    const processedNames = new Set();

    // First pass: identify anime directories and group them
    const titleNormalizer = await this.getTitleNormalizer();
    const animeDirectories = originalFileInfoList.filter(item =>
      item.isDirectory && titleNormalizer.looksLikeAnime(item.name)
    );

    const groupedAnime = titleNormalizer.groupAnimeVersions(animeDirectories);

    // Process grouped anime
    for (const group of groupedAnime) {
      if (groupVersions && group.versions.length > 1) {
        // Create a virtual group entry
        const groupEntry = {
          ...group.versions[0].fileInfo, // Base on first version
          name: group.baseTitle,
          isAnimeGroup: true,
          originalName: group.baseTitle,
          versions: group.versions,
          // CRITICAL: Preserve original file info for each version
          selectableVersions: group.versions.map(v => ({
            displayName: this.createVersionDisplayName(v),
            originalFileInfo: v.fileInfo, // This is what sync logic needs
            versionInfo: v.versionInfo
          }))
        };

        animeGroups.push(groupEntry);

        // Mark all versions as processed
        for (const version of group.versions) {
          processedNames.add(version.originalName);
        }
      } else {
        // Single version or grouping disabled - add as regular directory
        for (const version of group.versions) {
          directories.push({
            ...version.fileInfo,
            isAnimeDirectory: true,
            animeMetadata: null // Will be populated by AniList client
          });
          processedNames.add(version.originalName);
        }
      }
    }

    // Add non-anime directories unchanged
    for (const item of originalFileInfoList) {
      if (!processedNames.has(item.name)) {
        directories.push(item);
      }
    }

    return {
      enhanced: true,
      directories: directories,
      animeGroups: animeGroups,
      seasonContext: seasonContext,
      preserveOriginalSelection: true,
      // CRITICAL: Method to get original FileInfo from any selection
      getOriginalFileInfo: (selectedName) => {
        // Find in anime groups first
        for (const group of animeGroups) {
          if (group.name === selectedName) {
            // Return first version as default, or let user choose
            return group.versions[0].fileInfo;
          }

          // Check if it's a specific version selection
          const version = group.selectableVersions.find(v =>
            v.displayName === selectedName
          );
          if (version) {
            return version.originalFileInfo;
          }
        }

        // Find in regular directories
        const directory = directories.find(d => d.name === selectedName);
        return directory || null;
      }
    };
  }

  // Create readable display name for anime versions
  async createVersionDisplayName(version) {
    const { originalName, versionInfo } = version;
    const { providers, dubLanguages, subLanguages } = versionInfo;

    let displayName = originalName;

    // If we have provider info, create a cleaner display
    if (providers.length > 0) {
      const titleNormalizer = await this.getTitleNormalizer();
      const baseTitle = titleNormalizer.normalizeTitle(originalName);
      const providerTag = providers.join('+');

      let langInfo = '';
      if (dubLanguages.length > 0) {
        langInfo += dubLanguages.join('/') + 'Dub';
      }
      if (subLanguages.length > 0) {
        if (langInfo) langInfo += ',';
        langInfo += subLanguages.join('/') + 'Sub';
      }

      displayName = `${baseTitle} [${providerTag}${langInfo ? ',' + langInfo : ''}]`;
    }

    return displayName;
  }

  // IMPORTANT: Ensure sync compatibility
  // When user selects a grouped anime, they need to choose specific version
  createVersionSelectionPrompt(animeGroup) {
    return {
      title: `Select version for "${animeGroup.baseTitle}"`,
      message: `Multiple versions available. Select which one to sync:`,
      options: animeGroup.selectableVersions.map((version, index) => ({
        id: index,
        label: version.displayName,
        description: this.formatVersionDescription(version.versionInfo),
        originalFileInfo: version.originalFileInfo // This is what sync needs
      }))
    };
  }

  formatVersionDescription(versionInfo) {
    const parts = [];

    if (versionInfo.providers.length > 0) {
      parts.push(`Source: ${versionInfo.providers.join(', ')}`);
    }

    if (versionInfo.dubLanguages.length > 0) {
      parts.push(`Dub: ${versionInfo.dubLanguages.join(', ')}`);
    }

    if (versionInfo.subLanguages.length > 0) {
      parts.push(`Sub: ${versionInfo.subLanguages.join(', ')}`);
    }

    return parts.join(' | ') || 'Standard version';
  }
}
