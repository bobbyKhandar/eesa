/**
 * Node.js Integration Example for AI Pipeline
 * 
 * This file demonstrates how to interact with the Python AI Pipeline from Node.js
 * using Redis as the communication layer for batch processing requests.
 * 
 * Prerequisites:
 * - Redis server running (default: localhost:6379)
 * - Python AI Pipeline server running
 * - npm packages: redis, uuid
 * 
 * Install dependencies:
 * npm install redis uuid
 */

const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

// Redis Configuration
const REDIS_CONFIG = {
    host: 'localhost',
    port: 6379,
    db: 0
};

// Redis Queue Keys (must match Python implementation)
const REDIS_KEYS = {
    QUEUE_MAIN_INTAKE: 'queue:main:intake',
    QUEUE_RESULTS_FINAL: 'queue:results:final'
};

class AIPipelineClient {
    constructor(redisConfig = REDIS_CONFIG) {
        this.redisConfig = redisConfig;
        this.client = null;
        this.subscriber = null;
    }

    /**
     * Initialize Redis connection
     */
    async connect() {
        try {
            // Create Redis client
            this.client = redis.createClient(this.redisConfig);
            this.subscriber = redis.createClient(this.redisConfig);

            // Connect to Redis
            await this.client.connect();
            await this.subscriber.connect();

            console.log('✅ Connected to Redis');
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to Redis:', error);
            throw error;
        }
    }

    /**
     * Submit a batch of PDF files for OCR processing
     * 
     * @param {string[]} filePaths - Array of absolute paths to PDF files
     * @param {Object} options - Processing options
     * @returns {Promise<string>} - Batch ID for tracking
     */
    async submitBatch(filePaths, options = {}) {
        try {
            if (!Array.isArray(filePaths) || filePaths.length === 0) {
                throw new Error('filePaths must be a non-empty array');
            }

            // Generate unique batch ID
            const batchId = uuidv4();
            const timestamp = Date.now() / 1000; // Unix timestamp in seconds

            // Prepare batch metadata
            const batchMetadata = {
                batch_id: batchId,
                file_locations: filePaths,
                status: 'pending',
                total_files: filePaths.length,
                processed_files: 0,
                failed_files: 0,
                created_at: timestamp,
                options: options
            };

            // Store batch metadata in Redis hash
            const metadataKey = `batch:${batchId}`;
            await this.client.hSet(metadataKey, 'metadata', JSON.stringify(batchMetadata));

            // Add batch ID to processing queue
            await this.client.rPush(REDIS_KEYS.QUEUE_MAIN_INTAKE, batchId);

            console.log(`📝 Submitted batch ${batchId} with ${filePaths.length} files`);
            return batchId;
        } catch (error) {
            console.error('❌ Error submitting batch:', error);
            throw error;
        }
    }

    /**
     * Get the current status of a batch
     * 
     * @param {string} batchId - Batch ID to check
     * @returns {Promise<Object>} - Batch status information
     */
    async getBatchStatus(batchId) {
        try {
            const metadataKey = `batch:${batchId}`;
            const metadataJson = await this.client.hGet(metadataKey, 'metadata');

            if (!metadataJson) {
                return null;
            }

            const metadata = JSON.parse(metadataJson);

            // Calculate progress
            const totalFiles = metadata.total_files || 0;
            const processedFiles = metadata.processed_files || 0;
            const progressPercentage = totalFiles > 0 
                ? (processedFiles / totalFiles * 100).toFixed(2)
                : 0;

            return {
                batch_id: batchId,
                status: metadata.status,
                total_files: totalFiles,
                processed_files: processedFiles,
                failed_files: metadata.failed_files || 0,
                progress_percentage: parseFloat(progressPercentage),
                created_at: metadata.created_at,
                processing_time: Date.now() / 1000 - metadata.created_at
            };
        } catch (error) {
            console.error(`❌ Error getting batch status for ${batchId}:`, error);
            throw error;
        }
    }

    /**
     * Get the final results of a completed batch
     * 
     * @param {string} batchId - Batch ID to retrieve
     * @returns {Promise<Object>} - Batch results
     */
    async getBatchResult(batchId) {
        try {
            const metadataKey = `batch:${batchId}`;
            
            // Get metadata
            const metadataJson = await this.client.hGet(metadataKey, 'metadata');
            if (!metadataJson) {
                return null;
            }
            const metadata = JSON.parse(metadataJson);

            // Get results
            const resultsJson = await this.client.hGet(metadataKey, 'results');
            const results = resultsJson ? JSON.parse(resultsJson) : {};

            // Get errors
            const errorsJson = await this.client.hGet(metadataKey, 'errors');
            const errors = errorsJson ? JSON.parse(errorsJson) : [];

            return {
                batch_id: batchId,
                status: metadata.status,
                total_files: metadata.total_files,
                successful_files: metadata.processed_files - metadata.failed_files,
                failed_files: metadata.failed_files,
                processing_time: metadata.processing_time || 0,
                results: results,
                errors: errors,
                completed_at: metadata.completed_at
            };
        } catch (error) {
            console.error(`❌ Error getting batch result for ${batchId}:`, error);
            throw error;
        }
    }

    /**
     * Listen for completed batch results from the results queue
     * 
     * @param {Function} callback - Function to call when a result is received
     */
    async listenForResults(callback) {
        try {
            console.log('👂 Listening for batch results...');

            // Continuously poll the results queue
            while (true) {
                try {
                    // BLPOP blocks until an item is available (timeout: 5 seconds)
                    const result = await this.client.blPop(REDIS_KEYS.QUEUE_RESULTS_FINAL, 5);

                    if (result) {
                        const resultData = JSON.parse(result.element);
                        console.log(`✅ Received result for batch ${resultData.batch_id}`);
                        
                        if (callback) {
                            await callback(resultData);
                        }
                    }
                } catch (error) {
                    console.error('Error processing result:', error);
                }
            }
        } catch (error) {
            console.error('❌ Error listening for results:', error);
            throw error;
        }
    }

    /**
     * Wait for a specific batch to complete
     * 
     * @param {string} batchId - Batch ID to wait for
     * @param {number} pollInterval - Milliseconds between status checks (default: 2000)
     * @param {number} timeout - Maximum wait time in milliseconds (default: 300000 = 5 min)
     * @returns {Promise<Object>} - Final batch result
     */
    async waitForBatch(batchId, pollInterval = 2000, timeout = 300000) {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                try {
                    // Check if timeout exceeded
                    if (Date.now() - startTime > timeout) {
                        reject(new Error(`Timeout waiting for batch ${batchId}`));
                        return;
                    }

                    // Get current status
                    const status = await this.getBatchStatus(batchId);

                    if (!status) {
                        reject(new Error(`Batch ${batchId} not found`));
                        return;
                    }

                    console.log(`⏳ Batch ${batchId}: ${status.status} (${status.progress_percentage}%)`);

                    // Check if completed or failed
                    if (status.status === 'completed' || status.status === 'failed') {
                        const result = await this.getBatchResult(batchId);
                        resolve(result);
                        return;
                    }

                    // Schedule next check
                    setTimeout(checkStatus, pollInterval);
                } catch (error) {
                    reject(error);
                }
            };

            // Start checking
            checkStatus();
        });
    }

    /**
     * Close Redis connections
     */
    async disconnect() {
        try {
            if (this.client) {
                await this.client.quit();
            }
            if (this.subscriber) {
                await this.subscriber.quit();
            }
            console.log('👋 Disconnected from Redis');
        } catch (error) {
            console.error('❌ Error disconnecting:', error);
        }
    }
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

async function main(pdfFiles) {
    const client = new AIPipelineClient();

    try {
        // Connect to Redis
        await client.connect();

        console.log('\n' + '='.repeat(70));
        console.log('🚀 AI Pipeline Node.js Integration Example');
        console.log('='.repeat(70) + '\n');

        // Example 1: Submit a batch of PDF files
        console.log('📤 Example 1: Submitting a batch of PDF files\n');
        
       

        const options = {
            // Image preprocessing options
            max_width: 2000,
            max_height: 2000,
            enhance_contrast: true,
            denoise: true,
            sharpen: true,
            binarize: true,
            
            // OCR options
            confidence_threshold: 0.5
        };

        const batchId = await client.submitBatch(pdfFiles, options);
        console.log(`✅ Batch submitted successfully: ${batchId}\n`);

        // Example 2: Check batch status
        console.log('📊 Example 2: Checking batch status\n');
        
        const status = await client.getBatchStatus(batchId);
        console.log('Status:', JSON.stringify(status, null, 2));
        console.log();

        // Example 3: Wait for batch completion
        console.log('⏳ Example 3: Waiting for batch to complete\n');
        
        const result = await client.waitForBatch(batchId, 2000, 300000);
        
        console.log('\n✅ Batch completed!');
        console.log('Result Summary:');
        console.log(`  - Status: ${result.status}`);
        console.log(`  - Total Files: ${result.total_files}`);
        console.log(`  - Successful: ${result.successful_files}`);
        console.log(`  - Failed: ${result.failed_files}`);
        console.log(`  - Processing Time: ${result.processing_time.toFixed(2)}s`);
        console.log();

        // Example 4: Access extracted text
        console.log('📄 Example 4: Accessing extracted text\n');
        
        if (result.results) {
            Object.entries(result.results).forEach(([filePath, fileResult]) => {
                console.log(`File: ${filePath}`);
                console.log(`  Pages: ${fileResult.total_pages}`);
                console.log(`  Success: ${fileResult.successful_pages}/${fileResult.total_pages}`);
                console.log(`  Confidence: ${(fileResult.average_confidence * 100).toFixed(1)}%`);
                console.log(`  Text Preview: ${fileResult.combined_text.substring(0, 100)}...`);
                console.log();
            });
        }

        // Example 5: Handle errors
        if (result.errors && result.errors.length > 0) {
            console.log('❌ Errors encountered:');
            result.errors.forEach(error => console.log(`  - ${error}`));
            console.log();
        }

        console.log('='.repeat(70));
        console.log('✅ Examples completed successfully!');
        console.log('='.repeat(70) + '\n');

    } catch (error) {
        console.error('\n❌ Error in main:', error);
    } finally {
        // Clean up
        await client.disconnect();
    }
}

// ============================================================================
// ADVANCED USAGE: Real-time result listener
// ============================================================================

async function exampleResultListener() {
    const client = new AIPipelineClient();

    try {
        await client.connect();

        // Start listening for results in the background
        client.listenForResults(async (result) => {
            console.log('\n📨 Received batch result:');
            console.log(`  Batch ID: ${result.batch_id}`);
            console.log(`  Status: ${result.status}`);
            console.log(`  Files: ${result.successful_files}/${result.total_files} successful`);
            console.log(`  Time: ${result.processing_time.toFixed(2)}s`);
            
            // Process the result here
            // e.g., save to database, send notification, etc.
        });

    } catch (error) {
        console.error('❌ Error in listener:', error);
        await client.disconnect();
    }
}

// ============================================================================
// HTTP API INTEGRATION (Alternative approach)
// ============================================================================

/**
 * Alternative: Use HTTP API instead of direct Redis access
 * 
 * If the Python AI Pipeline exposes an HTTP server, you can use this approach:
 */
const axios = require('axios');

class AIPipelineHTTPClient {
    constructor(baseURL = 'http://localhost:5000') {
        this.baseURL = baseURL;
        this.axios = axios.create({ baseURL });
    }

    async submitBatch(filePaths, options = {}) {
        try {
            const response = await this.axios.post('/submit', {
                file_locations: filePaths,
                options: options
            });
            
            if (response.data.success) {
                return response.data.batch_id;
            } else {
                throw new Error(response.data.error || 'Submission failed');
            }
        } catch (error) {
            console.error('❌ Error submitting batch:', error.response?.data || error.message);
            throw error;
        }
    }

    async getBatchStatus(batchId) {
        try {
            const response = await this.axios.get(`/status/${batchId}`);
            
            if (response.data.success) {
                return response.data.status;
            } else {
                throw new Error(response.data.error || 'Status check failed');
            }
        } catch (error) {
            console.error(`❌ Error getting status for ${batchId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getBatchResult(batchId) {
        try {
            const response = await this.axios.get(`/result/${batchId}`);
            
            if (response.data.success) {
                return response.data.result;
            } else {
                throw new Error(response.data.error || 'Result retrieval failed');
            }
        } catch (error) {
            console.error(`❌ Error getting result for ${batchId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async waitForBatch(batchId, pollInterval = 2000, timeout = 300000) {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                try {
                    // Check timeout
                    if (Date.now() - startTime > timeout) {
                        reject(new Error(`Timeout waiting for batch ${batchId}`));
                        return;
                    }

                    // Get status
                    const status = await this.getBatchStatus(batchId);
                    console.log(`⏳ Batch ${batchId}: ${status.status || 'unknown'}`);

                    // Check if completed
                    if (status.status === 'completed') {
                        const result = await this.getBatchResult(batchId);
                        resolve(result);
                        return;
                    } else if (status.status === 'failed') {
                        reject(new Error(`Batch ${batchId} failed`));
                        return;
                    }

                    // Continue polling
                    setTimeout(checkStatus, pollInterval);
                } catch (error) {
                    reject(error);
                }
            };

            checkStatus();
        });
    }
}

// ============================================================================
// Run examples
// ============================================================================

// ============================================================================
// HTTP Client Example
// ============================================================================

async function httpClientExample() {
    console.log('\n🌐 Testing HTTP Client Integration\n');
    
    const httpClient = new AIPipelineHTTPClient('http://localhost:5000');
    
    // Test with some sample PDF paths (update these to real file paths)
    const pdfFiles = [
        'C:/project/miniproject/uploads/16010423807_exp3.docx (1).pdf',
        'C:/project/miniproject/uploads/16010423807_Expt-04.docx (1).pdf'
    ];
    
    const options = {
        max_width: 2000,
        enhance_contrast: true,
        confidence_threshold: 0.7
    };

    try {
        // Test server health first
        console.log('🏥 Testing server health...');
        const healthResponse = await httpClient.axios.get('/health');
        console.log('✅ Server is healthy:', healthResponse.data);
        
        // Submit batch
        console.log('\n📤 Submitting batch...');
        const batchId = await httpClient.submitBatch(pdfFiles, options);
        console.log(`✅ Batch submitted: ${batchId}`);
        
        // Wait for completion
        console.log('\n⏳ Waiting for completion...');
        const result = await httpClient.waitForBatch(batchId);
        console.log('✅ Batch completed:', result);
        
    } catch (error) {
        console.error('❌ HTTP Client Error:', error.message);
        
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
    }
}

if (require.main === module) {
    // Test the HTTP client
    httpClientExample().catch(console.error);
    
    // Or test the Redis client (uncomment to use):
    // const pdfFiles = [
    //     'C:/project/miniproject/ai_pipeline/tests/test_files/document1.pdf'
    // ];
    // main(pdfFiles).catch(console.error);
    
    // Or run the result listener:
    // exampleResultListener().catch(console.error);
}
    
module.exports = { AIPipelineClient, AIPipelineHTTPClient };
