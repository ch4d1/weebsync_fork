export class RateLimiter {
  constructor(isAuthenticated = false) {
    // Official AniList API rate limits
    this.requestsPerMinute = isAuthenticated ? 120 : 90; // Higher limit for authenticated requests
    this.requests = [];
    this.queue = [];
    this.processing = false;
    
    // Track actual server-reported limits
    this.serverLimit = null;
    this.serverRemaining = null;
    this.serverReset = null;
    
    // Batch optimization settings
    this.batchSettings = {
      reserveCapacity: 10, // Reserve capacity for batch requests
      priorityBatchSize: 15, // Batch sizes above this get priority
      dynamicAdjustment: true // Automatically adjust based on API response
    };
    
    // Priority queue for batch requests
    this.priorityQueue = [];
    this.batchHistory = [];
  }

  async waitForSlot() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  async processQueue() {
    // Use the enhanced version below
    return this.processQueueEnhanced();
  }

  async processQueueLegacy() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Remove requests older than 1 minute
      this.requests = this.requests.filter(timestamp => now - timestamp < 60000);

      if (this.requests.length < this.requestsPerMinute) {
        // We can make a request
        this.requests.push(now);
        const resolve = this.queue.shift();
        resolve();
      } else {
        // We need to wait
        const oldestRequest = Math.min(...this.requests);
        const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.processing = false;
  }

  updateLimit(newLimit) {
    this.requestsPerMinute = newLimit;
  }

  // Update limits based on server response headers
  updateFromHeaders(headers) {
    if (headers['x-ratelimit-limit']) {
      this.serverLimit = parseInt(headers['x-ratelimit-limit']);
      this.requestsPerMinute = this.serverLimit;
    }
    if (headers['x-ratelimit-remaining']) {
      this.serverRemaining = parseInt(headers['x-ratelimit-remaining']);
    }
    if (headers['x-ratelimit-reset']) {
      this.serverReset = parseInt(headers['x-ratelimit-reset']);
    }
  }

  getCurrentUsage() {
    const now = Date.now();
    const recentRequests = this.requests.filter(timestamp => now - timestamp < 60000);
    return {
      used: recentRequests.length,
      limit: this.requestsPerMinute,
      resetTime: recentRequests.length > 0 ? Math.min(...recentRequests) + 60000 : now,
      // Server-reported data if available
      serverLimit: this.serverLimit,
      serverRemaining: this.serverRemaining,
      serverReset: this.serverReset ? new Date(this.serverReset * 1000) : null
    };
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      priorityQueue: this.priorityQueue.length,
      batchHistorySize: this.batchHistory.length
    };
  }

  /**
   * Priority slot for batch requests - gets higher priority in queue
   */
  async waitForBatchSlot(batchSize = 1, batchId = null) {
    return new Promise((resolve) => {
      const request = {
        resolve,
        batchSize,
        batchId,
        timestamp: Date.now(),
        priority: this.calculateBatchPriority(batchSize)
      };
      
      if (request.priority > 0) {
        // Insert into priority queue based on priority score
        const insertIndex = this.priorityQueue.findIndex(item => 
          item.priority < request.priority
        );
        if (insertIndex === -1) {
          this.priorityQueue.push(request);
        } else {
          this.priorityQueue.splice(insertIndex, 0, request);
        }
      } else {
        // Regular queue for smaller batches
        this.queue.push(resolve);
      }
      
      this.processQueue();
    });
  }

  /**
   * Calculate priority score for batch requests
   */
  calculateBatchPriority(batchSize) {
    if (batchSize >= this.batchSettings.priorityBatchSize) {
      return Math.min(10, batchSize); // Cap at 10 for very large batches
    }
    return 0; // No priority for small batches
  }

  /**
   * Enhanced queue processing with priority handling
   */
  async processQueueEnhanced() {
    if (this.processing || (this.queue.length === 0 && this.priorityQueue.length === 0)) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 || this.priorityQueue.length > 0) {
      const now = Date.now();
      
      // Remove requests older than 1 minute
      this.requests = this.requests.filter(timestamp => now - timestamp < 60000);

      // Calculate available capacity
      const usedCapacity = this.requests.length;
      const totalCapacity = this.requestsPerMinute;
      const reservedCapacity = this.batchSettings.reserveCapacity;
      const availableCapacity = totalCapacity - usedCapacity;

      // Process priority queue first
      if (this.priorityQueue.length > 0 && availableCapacity > reservedCapacity) {
        const request = this.priorityQueue.shift();
        this.requests.push(now);
        
        // Track batch performance
        this.recordBatchRequest(request.batchSize, request.batchId);
        
        request.resolve();
        continue;
      }

      // Process regular queue
      if (this.queue.length > 0 && availableCapacity > 0) {
        this.requests.push(now);
        const resolve = this.queue.shift();
        resolve();
        continue;
      }

      // Need to wait - calculate optimal wait time
      if (usedCapacity >= totalCapacity) {
        const oldestRequest = Math.min(...this.requests);
        const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        break; // No more requests to process
      }
    }

    this.processing = false;
  }

  /**
   * Record batch request for performance tracking
   */
  recordBatchRequest(batchSize, batchId) {
    const record = {
      timestamp: Date.now(),
      batchSize,
      batchId,
      requestsSaved: Math.max(0, batchSize - 1) // Requests saved by batching
    };
    
    this.batchHistory.push(record);
    
    // Keep only recent history (last 100 batches)
    if (this.batchHistory.length > 100) {
      this.batchHistory = this.batchHistory.slice(-100);
    }
  }

  /**
   * Get batch optimization statistics
   */
  getBatchStats() {
    if (this.batchHistory.length === 0) {
      return {
        totalBatches: 0,
        totalRequestsSaved: 0,
        averageBatchSize: 0,
        efficiencyGain: 0
      };
    }

    const totalBatches = this.batchHistory.length;
    const totalRequestsSaved = this.batchHistory.reduce((sum, record) => 
      sum + record.requestsSaved, 0);
    const totalTitlesProcessed = this.batchHistory.reduce((sum, record) => 
      sum + record.batchSize, 0);
    const actualRequests = totalBatches;
    const wouldBeRequests = totalTitlesProcessed;
    
    return {
      totalBatches,
      totalRequestsSaved,
      averageBatchSize: Math.round(totalTitlesProcessed / totalBatches),
      actualRequests,
      wouldBeRequests,
      efficiencyGain: Math.round(((wouldBeRequests - actualRequests) / wouldBeRequests) * 100),
      timeWindow: this.getTimeWindow()
    };
  }

  /**
   * Get time window for current statistics
   */
  getTimeWindow() {
    if (this.batchHistory.length === 0) {
      return null;
    }

    const oldest = Math.min(...this.batchHistory.map(r => r.timestamp));
    const newest = Math.max(...this.batchHistory.map(r => r.timestamp));
    
    return {
      start: new Date(oldest),
      end: new Date(newest),
      durationMinutes: Math.round((newest - oldest) / (1000 * 60))
    };
  }

  /**
   * Check if batch request can be immediately processed
   */
  canProcessBatchImmediately() {
    const now = Date.now();
    const recentRequests = this.requests.filter(timestamp => now - timestamp < 60000);
    const availableCapacity = this.requestsPerMinute - recentRequests.length;
    
    return availableCapacity >= (this.batchSettings.reserveCapacity + 1);
  }

  /**
   * Get recommended batch size based on current capacity
   */
  getRecommendedBatchSize(maxBatchSize = 15) {
    const now = Date.now();
    const recentRequests = this.requests.filter(timestamp => now - timestamp < 60000);
    const availableCapacity = this.requestsPerMinute - recentRequests.length;
    
    // Conservative recommendation to avoid hitting limits
    const recommendedSize = Math.min(
      maxBatchSize,
      Math.max(1, availableCapacity - this.batchSettings.reserveCapacity - 5)
    );
    
    return Math.max(1, recommendedSize);
  }
}