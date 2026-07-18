-- Schema for Smart Ticket Triage System

-- Drop table if exists to ensure clean setup in dev
DROP TABLE IF EXISTS tickets;

CREATE TABLE tickets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50), -- Predefined: 'Technical Support', 'Billing & Payments', 'Account Access & Security', 'Feature Request', 'General Inquiry'
    confidence DOUBLE PRECISION, -- Float score 0.0 to 1.0 from LLM
    routing_decision VARCHAR(50) NOT NULL, -- 'auto_routed' | 'manual_review'
    routed_to VARCHAR(50) NOT NULL, -- Category queue name if auto_routed, or 'manual_queue' for human triage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimize queries searching or fetching tickets by routing decision or category
CREATE INDEX idx_tickets_routing_decision ON tickets(routing_decision);
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC);
