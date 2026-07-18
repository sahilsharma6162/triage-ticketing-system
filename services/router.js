require('dotenv').config();

const DEFAULT_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7');

/**
 * Evaluates the routing decision based on confidence against the threshold.
 * @param {object} classification - Output from classifier { category, confidence }
 * @param {object} [options] - Optional overrides
 * @param {number} [options.threshold] - Confidence threshold override
 * @returns {{ routingDecision: string, routedTo: string }}
 */
function routeTicket(classification, options = {}) {
  const threshold = options.threshold !== undefined 
    ? parseFloat(options.threshold) 
    : DEFAULT_THRESHOLD;

  const { category, confidence } = classification;

  if (confidence >= threshold) {
    return {
      routingDecision: 'auto_routed',
      routedTo: category
    };
  } else {
    return {
      routingDecision: 'manual_review',
      routedTo: 'manual_queue'
    };
  }
}

module.exports = {
  routeTicket,
  DEFAULT_THRESHOLD
};
