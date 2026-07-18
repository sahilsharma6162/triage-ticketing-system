require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { classifyTicket, CATEGORIES } = require('../services/classifier');
const { routeTicket } = require('../services/router');
const db = require('../config/db');

// Read command line arguments
// Syntax: node scripts/evaluate.js --threshold 0.75 --prompt path/to/prompt.txt --save
const args = process.argv.slice(2);

let thresholdOverride = null;
let promptTemplatePath = null;
let saveToDb = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold' && args[i + 1]) {
    thresholdOverride = parseFloat(args[i + 1]);
    i++;
  } else if (args[i] === '--prompt' && args[i + 1]) {
    promptTemplatePath = args[i + 1];
    i++;
  } else if (args[i] === '--save') {
    saveToDb = true;
  }
}

// Load threshold
const activeThreshold = thresholdOverride !== null 
  ? thresholdOverride 
  : parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7');

// Load custom prompt if specified
let customPromptTemplate = null;
if (promptTemplatePath) {
  try {
    const resolvedPath = path.resolve(process.cwd(), promptTemplatePath);
    console.log(`[*] Loading custom prompt from: ${resolvedPath}`);
    customPromptTemplate = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    console.error(`[-] Error reading prompt file: ${err.message}. Using default instead.`);
  }
}

async function runEvaluation() {
  console.log('========================================================================');
  console.log('                 SUPPORT TICKET TRIAGE EVALUATION HARNESS                ');
  console.log('========================================================================');
  console.log(`[*] Active Confidence Threshold: ${activeThreshold}`);
  console.log(`[*] LLM Model: ${process.env.CLASSIFIER_MODEL || 'gemini-1.5-flash'}`);
  console.log(`[*] Configured Provider: ${process.env.GEMINI_API_KEY ? 'Google Gemini API' : 'Rule-Based Fallback Engine (No API key)'}`);
  console.log(`[*] Save to Database: ${saveToDb ? 'YES' : 'NO'}`);
  
  // Load labeled test tickets
  const testTicketsPath = path.join(__dirname, '../data/test-tickets.json');
  let testTickets = [];
  try {
    testTickets = JSON.parse(fs.readFileSync(testTicketsPath, 'utf8'));
    console.log(`[*] Loaded ${testTickets.length} test tickets from gold-standard set.`);
  } catch (error) {
    console.error('[-] Error reading test tickets dataset:', error.message);
    process.exit(1);
  }

  const results = [];
  let classifiedCount = 0;
  
  console.log('\n[*] Classifying tickets (sequential call execution to respect API rate limits)...');

  for (const ticket of testTickets) {
    classifiedCount++;
    process.stdout.write(`    (${classifiedCount}/${testTickets.length}) Classifying "${ticket.title.substring(0, 30)}..." `);
    
    const startTime = Date.now();
    let classification;
    try {
      classification = await classifyTicket(ticket.title, ticket.description, {
        promptTemplate: customPromptTemplate
      });
      const duration = Date.now() - startTime;
      process.stdout.write(`[OK] (${duration}ms) -> Got: ${classification.category} (${classification.confidence.toFixed(2)})\n`);
    } catch (err) {
      console.log(`[FAIL] -> Error: ${err.message}`);
      classification = {
        category: 'General Inquiry',
        confidence: 0.0,
        reasoning: `Classification failed: ${err.message}`,
        provider: 'error-failure'
      };
    }

    // Determine routing using active threshold
    const routing = routeTicket(classification, { threshold: activeThreshold });

    results.push({
      ticket,
      classification,
      routing
    });

    // Save to Database if flag is set
    if (saveToDb) {
      try {
        const queryText = `
          INSERT INTO tickets (title, description, category, confidence, routing_decision, routed_to)
          VALUES ($1, $2, $3, $4, $5, $6);
        `;
        const params = [
          ticket.title,
          ticket.description,
          classification.category,
          classification.confidence,
          routing.routingDecision,
          routing.routedTo
        ];
        await db.query(queryText, params);
      } catch (dbErr) {
        console.error(`       [!] Failed to save ticket ${ticket.id} to DB:`, dbErr.message);
      }
    }

    // Small delay between calls to respect rate limit parameters
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Calculate Metrics
  console.log('\n========================================================================');
  console.log('                          PER-CATEGORY METRICS                          ');
  console.log('========================================================================');

  // Initialize confusion matrix counts for each category
  const metrics = {};
  for (const category of CATEGORIES) {
    metrics[category] = { tp: 0, fp: 0, fn: 0 };
  }

  let correctClassifications = 0;
  let totalConfidence = 0;
  let autoRoutedCount = 0;
  let autoRoutedAndCorrect = 0;
  let manualReviewCount = 0;
  let fallbackProviderCount = 0;

  for (const res of results) {
    const expected = res.ticket.expectedCategory;
    const predicted = res.classification.category;
    const confidence = res.classification.confidence;
    const routed = res.routing.routingDecision;

    totalConfidence += confidence;
    if (res.classification.provider.startsWith('fallback')) {
      fallbackProviderCount++;
    }

    // Routing counts
    if (routed === 'auto_routed') {
      autoRoutedCount++;
      if (expected === predicted) {
        autoRoutedAndCorrect++;
      }
    } else {
      manualReviewCount++;
    }

    // Core Accuracy counts
    if (expected === predicted) {
      correctClassifications++;
    }

    // Update TP, FP, FN metrics mapping
    if (expected === predicted) {
      // Named category TP
      if (metrics[expected]) metrics[expected].tp++;
    } else {
      // Predicted is FP for predicted category
      if (metrics[predicted]) metrics[predicted].fp++;
      // Expected is FN for expected category
      if (metrics[expected]) metrics[expected].fn++;
    }
  }

  // Build Results Table Data
  const categoriesReport = [];
  for (const category of CATEGORIES) {
    const { tp, fp, fn } = metrics[category];
    
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    categoriesReport.push({
      'Category': category,
      'TP': tp,
      'FP': fp,
      'FN': fn,
      'Precision': precision.toFixed(3),
      'Recall': recall.toFixed(3),
      'F1 Score': f1.toFixed(3)
    });
  }

  console.table(categoriesReport);

  // Overall Statistics
  const overallAccuracy = correctClassifications / results.length;
  const avgConfidence = totalConfidence / results.length;
  const autoRouteRate = autoRoutedCount / results.length;
  const manualReviewRate = manualReviewCount / results.length;
  const autoRoutedAcc = autoRoutedCount > 0 ? autoRoutedAndCorrect / autoRoutedCount : 0;

  console.log('========================================================================');
  console.log('                           OVERALL SYSTEM METRICS                       ');
  console.log('========================================================================');
  console.log(`Total Test Tickets Rated:       ${results.length}`);
  console.log(`Overall Classification Accuracy: ${(overallAccuracy * 100).toFixed(1)}% (${correctClassifications}/${results.length} correct)`);
  console.log(`Average Classifier Confidence:   ${avgConfidence.toFixed(3)}`);
  console.log(`Auto-Routing Rate:               ${(autoRouteRate * 100).toFixed(1)}% (${autoRoutedCount}/${results.length} tickets)`);
  console.log(`Manual Review Rate:              ${(manualReviewRate * 100).toFixed(1)}% (${manualReviewCount}/${results.length} tickets)`);
  console.log(`Auto-Routed Queue Accuracy:      ${(autoRoutedAcc * 100).toFixed(1)}% (${autoRoutedAndCorrect}/${autoRoutedCount} correct classification)`);
  console.log(`Fallback Engine Classifications: ${fallbackProviderCount} / ${results.length}`);
  console.log('========================================================================');
  console.log('Recommendation Guidelines:');
  console.log('1. If "Auto-Routed Queue Accuracy" is too low, INCREASE your --threshold to filter bad classifications.');
  console.log('2. If "Manual Review Rate" is too high, evaluate modifying your prompt via --prompt file (e.g. system instructions upgrades).');
  console.log('========================================================================\n');

  if (saveToDb) {
    console.log('[+] Evaluation runs successfully persisted to the database.');
  }

  // Gracefully terminate pool since database might have been connected
  db.pool.end();
}

runEvaluation().catch(err => {
  console.error('[!] Fatal Exception in Evaluation Run:', err);
  db.pool.end();
});
