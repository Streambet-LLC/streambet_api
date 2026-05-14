/**
 * Test script to verify RapidAPI key rotation
 * 
 * Run with: npx ts-node -r tsconfig-paths/register src/integrations/ebay/test-key-rotation.ts
 */

import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { EbayKeyManagerService } from './ebay-key-manager.service';
import { EbayService } from './ebay.service';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class TestConfigService {
  get<T = any>(key: string): T | undefined {
    return process.env[key] as T;
  }

  getOrThrow<T = any>(key: string): T {
    const value = process.env[key];
    if (value === undefined) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value as T;
  }
}

async function testKeyRotation() {
  console.log('\n🧪 Starting RapidAPI Key Rotation Test\n');
  console.log('=' .repeat(60));

  // Initialize services
  const configService = new TestConfigService() as any;
  const redisService = new RedisService(configService);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Redis connection

  const keyManager = new EbayKeyManagerService(configService, redisService);
  const ebayService = new EbayService(configService, keyManager);

  try {
    // Step 1: Check available keys
    console.log('\n📋 Step 1: Checking Available Keys');
    console.log('-'.repeat(60));
    const availableKeys = keyManager.getAvailableKeys();
    console.log(`Found ${availableKeys.length} key(s) configured:`);
    availableKeys.forEach(k => {
      const masked = k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4);
      console.log(`  - KEY_${k.index}: ${masked}`);
    });

    if (availableKeys.length === 0) {
      console.error('\n❌ ERROR: No RapidAPI keys found in environment');
      console.log('Please ensure RAPIDAPI_EBAY_COMPLETED_KEY_1, KEY_2, etc. are set');
      process.exit(1);
    }

    // Step 2: Check current key statuses
    console.log('\n📊 Step 2: Checking Key Rate Limit Status');
    console.log('-'.repeat(60));
    const statuses = await keyManager.getAllKeyStatuses();
    for (const status of statuses) {
      const statusText = status.isRateLimited ? '🔴 RATE LIMITED' : '🟢 AVAILABLE';
      let message = `  KEY_${status.keyIndex}: ${statusText}`;
      if (status.isRateLimited && status.rateLimitedUntil) {
        const remainingSeconds = Math.ceil((status.rateLimitedUntil - Date.now()) / 1000);
        message += ` (${remainingSeconds}s remaining)`;
      }
      console.log(message);
    }

    // Step 3: Reset all rate limits for clean test
    console.log('\n🔄 Step 3: Resetting All Rate Limits');
    console.log('-'.repeat(60));
    await keyManager.resetAllRateLimits();
    console.log('  ✅ All rate limits cleared for testing');

    // Step 4: Test actual API call
    console.log('\n🌐 Step 4: Testing Real eBay API Call');
    console.log('-'.repeat(60));
    console.log('  Query: "Pokemon Charizard PSA 10"');
    console.log('  Attempting API call...\n');

    const startTime = Date.now();
    
    try {
      const result = await ebayService.findCompletedItems('Pokemon Charizard PSA 10', 60);
      const duration = Date.now() - startTime;

      console.log(`\n✅ SUCCESS! (${duration}ms)`);
      console.log('-'.repeat(60));
      console.log(`  Source: ${result.source}`);
      console.log(`  Results: ${result.resultCount} items found`);
      console.log(`  Query: ${result.query}`);
      
      if (result.products.length > 0) {
        console.log(`\n  Sample items (first 3):`);
        result.products.slice(0, 3).forEach((item, i) => {
          console.log(`    ${i + 1}. ${item.title}`);
          console.log(`       Price: $${item.salePrice?.toFixed(2) || 'N/A'}`);
        });
      }

      // Check which key was used
      const keyMatch = result.source.match(/rapidapi-key(\d+)/);
      if (keyMatch) {
        console.log(`\n  🔑 Used: KEY_${keyMatch[1]}`);
      }

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      if (error?.response?.status === 429) {
        console.log(`\n⚠️  RATE LIMITED (${duration}ms)`);
        console.log('-'.repeat(60));
        console.log(`  Status: 429 Too Many Requests`);
        console.log(`  Message: ${error.response?.data?.message || error.message}`);
        
        // Check if this triggered rotation
        console.log('\n  📊 Checking if rotation occurred...');
        const newStatuses = await keyManager.getAllKeyStatuses();
        const rateLimitedKeys = newStatuses.filter(s => s.isRateLimited);
        
        console.log(`  Rate-limited keys: ${rateLimitedKeys.length}/${newStatuses.length}`);
        rateLimitedKeys.forEach(s => {
          console.log(`    - KEY_${s.keyIndex}`);
        });

        if (rateLimitedKeys.length < availableKeys.length) {
          console.log('\n  ✅ Good! Other keys are still available for rotation');
        } else {
          console.log('\n  ⚠️  All keys are now rate-limited');
        }
      } else {
        console.log(`\n❌ ERROR (${duration}ms)`);
        console.log('-'.repeat(60));
        console.log(`  Status: ${error?.response?.status || 'unknown'}`);
        console.log(`  Message: ${error.message}`);
        if (error?.response?.data) {
          console.log(`  Response: ${JSON.stringify(error.response.data, null, 2)}`);
        }
      }
    }

    // Step 5: Test rotation by marking key 1 as rate-limited
    console.log('\n🔄 Step 5: Testing Manual Key Rotation');
    console.log('-'.repeat(60));
    console.log('  Marking KEY_1 as rate-limited (60s cooldown)...');
    await keyManager.markKeyRateLimited(1, 60);
    
    console.log('  Getting next available key...');
    const nextKey = await keyManager.getNextAvailableKey();
    
    if (nextKey) {
      console.log(`  ✅ Rotated to KEY_${nextKey.keyIndex}`);
      console.log(`     Key: ${nextKey.key.substring(0, 8)}...${nextKey.key.substring(nextKey.key.length - 4)}`);
    } else {
      console.log('  ❌ No available keys (all rate-limited)');
    }

    // Step 6: Final status check
    console.log('\n📊 Step 6: Final Key Status');
    console.log('-'.repeat(60));
    const finalStatuses = await keyManager.getAllKeyStatuses();
    for (const status of finalStatuses) {
      const statusText = status.isRateLimited ? '🔴 RATE LIMITED' : '🟢 AVAILABLE';
      let message = `  KEY_${status.keyIndex}: ${statusText}`;
      if (status.isRateLimited && status.rateLimitedUntil) {
        const remainingSeconds = Math.ceil((status.rateLimitedUntil - Date.now()) / 1000);
        message += ` (${remainingSeconds}s remaining)`;
      }
      console.log(message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test Complete!\n');

  } catch (error) {
    console.error('\n❌ Test Failed:', error);
    throw error;
  } finally {
    // Cleanup
    await redisService.onModuleDestroy();
    process.exit(0);
  }
}

// Run the test
testKeyRotation().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
