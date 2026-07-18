const db = require('../config/db');
const { classifyTicket } = require('../services/classifier');
const { routeTicket } = require('../services/router');

/**
 * Handle POST /api/tickets
 * Receives support ticket, runs triage, databases the ticket, routes it.
 */
async function createTicket(req, res, next) {
  try {
    const { title, description } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'Field "title" is required and must be a non-empty string.' });
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: 'Field "description" is required and must be a non-empty string.' });
    }

    // 1. Run classifier
    console.log(`[*] Classifying incoming ticket: "${title.substring(0, 40)}${title.length > 40 ? '...' : ''}"`);
    const classification = await classifyTicket(title, description);

    // 2. Perform Routing Decision
    const routing = routeTicket(classification);

    // 3. Save into Postgres database
    const queryText = `
      INSERT INTO tickets (title, description, category, confidence, routing_decision, routed_to)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const params = [
      title.trim(),
      description.trim(),
      classification.category,
      classification.confidence,
      routing.routingDecision,
      routing.routedTo
    ];

    const result = await db.query(queryText, params);
    const createdTicket = result.rows[0];

    // 4. Respond
    return res.status(201).json({
      message: 'Ticket triaged and recorded successfully.',
      ticket: {
        id: createdTicket.id,
        title: createdTicket.title,
        description: createdTicket.description,
        created_at: createdTicket.created_at
      },
      classification: {
        category: createdTicket.category,
        confidence: createdTicket.confidence,
        reasoning: classification.reasoning,
        provider: classification.provider
      },
      routing: {
        decision: createdTicket.routing_decision,
        routed_to: createdTicket.routed_to
      }
    });

  } catch (error) {
    console.error('[-] Error creating ticket:', error);
    return next(error);
  }
}

/**
 * Handle GET /api/tickets
 * Query filters: category, routing_decision, min_confidence, limit
 */
async function getTickets(req, res, next) {
  try {
    const { category, routing_decision, min_confidence, limit } = req.query;

    let queryTemplate = 'SELECT * FROM tickets WHERE 1=1';
    const params = [];
    let paramCounter = 1;

    if (category) {
      queryTemplate += ` AND category = $${paramCounter++}`;
      params.push(category);
    }

    if (routing_decision) {
      queryTemplate += ` AND routing_decision = $${paramCounter++}`;
      params.push(routing_decision);
    }

    if (min_confidence) {
      queryTemplate += ` AND confidence >= $${paramCounter++}`;
      params.push(parseFloat(min_confidence));
    }

    queryTemplate += ' ORDER BY created_at DESC';

    const limitVal = parseInt(limit || '50', 10);
    queryTemplate += ` LIMIT $${paramCounter++}`;
    params.push(limitVal);

    const result = await db.query(queryTemplate, params);
    
    return res.status(200).json({
      count: result.rows.length,
      tickets: result.rows
    });

  } catch (error) {
    console.error('[-] Error fetching tickets:', error);
    return next(error);
  }
}

module.exports = {
  createTicket,
  getTickets
};
