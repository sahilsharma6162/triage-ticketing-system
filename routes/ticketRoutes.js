const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

router.post('/tickets', ticketController.createTicket);
router.get('/tickets', ticketController.getTickets);

module.exports = router;
