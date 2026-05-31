/**
 * Test script to verify EC2 OCR deployment
 * Run this after deploying to EC2 to ensure everything works
 */

import { ec2OcrClient } from './ec2OcrClient';

async function testEC2Deployment() {
  console.log('🧪 Testing EC2 OCR Deployment');
  console.log('================================\n');

  try {
    // Test 1: Health Check
    console.log('Test 1: Health Check');
    console.log('-------------------');
    try {
      const health = await ec2OcrClient.healthCheck();
      console.log('✅ Health check passed');
      console.log(`   Status: ${health.status}`);
      console.log(`   Pipeline running: ${health.pipeline_running}`);
      console.log(`   Timestamp: ${new Date(health.timestamp * 1000).toISOString()}\n`);
    } catch (error: any) {
      console.error('❌ Health check failed:', error.message);
      console.error('   Make sure EC2_OCR_URL is set in .env');
      console.error('   Check EC2 instance is running and port 5000 is open\n');
      return;
    }

    // Test 2: Get Stats
    console.log('Test 2: Service Statistics');
    console.log('-------------------------');
    try {
      const stats = await ec2OcrClient.getStats();
      console.log('✅ Stats retrieved');
      console.log(`   Stats: ${JSON.stringify(stats, null, 2)}\n`);
    } catch (error: any) {
      console.error('❌ Stats failed:', error.message, '\n');
    }

    // Test 3: Submit Empty Batch (should fail gracefully)
    console.log('Test 3: Error Handling');
    console.log('---------------------');
    try {
      await ec2OcrClient.submitBatch([]);
      console.error('❌ Should have failed with empty batch\n');
    } catch (error: any) {
      console.log('✅ Error handling works correctly');
      console.log(`   Expected error: ${error.message}\n`);
    }

    // Test 4: Submit Test Batch (requires actual PDF file)
    console.log('Test 4: OCR Processing');
    console.log('---------------------');
    console.log('⚠️  Skipping - requires actual PDF file on EC2');
    console.log('   To test with real file:');
    console.log('   1. Upload test PDF to EC2: /opt/ai_pipeline/uploads/test.pdf');
    console.log('   2. Run:');
    console.log('      const result = await ec2OcrClient.processFiles(["/opt/ai_pipeline/uploads/test.pdf"]);');
    console.log('      console.log(result);\n');

    console.log('================================');
    console.log('✅ Basic tests completed!');
    console.log('================================\n');
    console.log('Next steps:');
    console.log('1. Upload a test PDF to EC2');
    console.log('2. Process it with ec2OcrClient.processFiles()');
    console.log('3. Integrate with your exam analysis workflow\n');

  } catch (error: any) {
    console.error('❌ Unexpected error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run if executed directly
if (require.main === module) {
  testEC2Deployment()
    .then(() => {
      console.log('Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testEC2Deployment };
