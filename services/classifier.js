const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Supported Predefined Categories
const CATEGORIES = [
  'Technical Support',
  'Billing & Payments',
  'Account Access & Security',
  'Feature Request',
  'General Inquiry'
];

/**
 * Basic Rule-Based keyword fallback classifier.
 * Used when GEMINI_API_KEY is not configured or if the API call fails.
 */
function classifyFallback(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();
  
  let category = 'General Inquiry';
  let confidence = 0.5;
  let reasoning = 'Classification completed via local regex engine.';

  // Check Account Security
  if (
    /password|login|2fa|mfa|auth|reset|sign[- ]?in|block|lockout|locked|account|suspension|verify|hack/i.test(text)
  ) {
    category = 'Account Access & Security';
    confidence = 0.8;
    reasoning = 'Detected authentication / account-related terms in ticket.';
  }
  // Check Billing
  else if (
    /billing|invoice|charge|refund|card|payment|pricing|price|cost|checkout|pay|receipt|subscription/i.test(text)
  ) {
    category = 'Billing & Payments';
    confidence = 0.85;
    reasoning = 'Detected payment, invoice, or charging related vocabulary.';
  }
  // Check Feature Request
  else if (
    /feature|request|suggest|improve|enhance|add support|integration|ability to|want to see/i.test(text)
  ) {
    category = 'Feature Request';
    confidence = 0.75;
    reasoning = 'Indicated product enhancement or new requirement request.';
  }
  // Check Technical Support
  else if (
    /bug|error|crash|fail|broken|null|undefined|blank|slow|latency|down|offline|console|exception|not loading/i.test(text)
  ) {
    category = 'Technical Support';
    confidence = 0.8;
    reasoning = 'Identified software error, exception, or reliability issues.';
  }

  // Refine confidence for short/vague tickets
  if (text.length < 30) {
    confidence = Math.max(0.3, confidence - 0.2);
    reasoning += ' Lower confidence assigned due to short ticket input.';
  }

  return { category, confidence, reasoning };
}

/**
 * Classifies an incoming support ticket using LLM or local keyword matcher.
 * @param {string} title - Ticket title
 * @param {string} description - Ticket details
 * @param {object} options - Custom execution options (e.g., custom prompts)
 * @returns {Promise<{category: string, confidence: number, reasoning: string, provider: string}>}
 */
async function classifyTicket(title, description, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.CLASSIFIER_MODEL || 'gemini-1.5-flash';

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_gemini_api_key_here') {
    // Graceful fallback to rule-based classification
    const result = classifyFallback(title, description);
    return { ...result, provider: 'fallback-rules' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Allow providing custom prompt template for prompting iterations
    const customPromptTemplate = options.promptTemplate || null;
    
    const schema = {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Select the most accurate category matching the ticket."
        },
        confidence: {
          type: "number",
          description: "Confidence code between 0.0 (uncertain) and 1.0 (dead certain). Assign lower (<0.6) for vague or mixed tickets."
        },
        reasoning: {
          type: "string",
          description: "Point-form explanation of why you selected this category and confidence."
        }
      },
      required: ["category", "confidence", "reasoning"]
    };

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1 // Keep temperature low for deterministic classification
      }
    });

    const systemInstruction = `You are an AI support ticket classification engine.
Your sole job is to categorize incoming tickets into exactly one of these categories:
- Technical Support: Bugs, errors, crashes, api failures, page load blockages, and service latency.
- Billing & Payments: Invoices, chargebacks, refund requests, upgrading/downgrading, pricing inquiries.
- Account Access & Security: Passwords, 2FA/MFA, login details, password resets, account locking/unlocking, or suspicious logins.
- Feature Request: Submitting feedback, requested integrations, UI styling requests, product upgrades.
- General Inquiry: General questions, operating schedules, sales inquiries, company office updates.

Assign a confidence rating (float from 0.0 to 1.0) indicating how reliable your prediction is.
- Assign 0.90+ for clear, non-ambiguous cases.
- Assign 0.60-0.85 for tickets with overlapping topics, or vague but likely matches.
- Assign < 0.60 when the text is too short, missing description, completely random, or highly confusing.`;

    const ticketContent = `Ticket Subject: ${title || 'No Title'}
Ticket Description: ${description || 'No Description'}`;

    const promptText = customPromptTemplate 
      ? customPromptTemplate.replace('{{TICKET_CONTENT}}', ticketContent)
      : `${systemInstruction}\n\nAnalyze the following ticket:\n${ticketContent}`;

    const response = await model.generateContent(promptText);
    const responseText = response.response.text();
    
    const parsed = JSON.parse(responseText.trim());
    
    // Validation: make sure the category is one of the allowed categories
    if (!CATEGORIES.includes(parsed.category)) {
      // Fallback if LLM hallucinations happen
      parsed.category = 'General Inquiry';
      parsed.confidence = 0.4;
      parsed.reasoning = `LLM returned invalid category "${parsed.category}". Fallback default applied.`;
    }

    return {
      category: parsed.category,
      confidence: parseFloat(parsed.confidence) || 0.5,
      reasoning: parsed.reasoning || '',
      provider: 'gemini-api'
    };
  } catch (error) {
    console.error('[!] Gemini API classification error:', error.message);
    // Graceful fallback to rule-based classification if network/rate limits failed
    const result = classifyFallback(title, description);
    return { ...result, provider: 'fallback-rules-api-error', error: error.message };
  }
}

module.exports = {
  classifyTicket,
  CATEGORIES
};
