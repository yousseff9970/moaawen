const Joi = require('joi');
const xss = require('xss');

const chatSchema = Joi.object({
  message: Joi.string()
    .trim()
    .max(1000)
    .required(),
  domain: Joi.string()
    .hostname()
    .required(),
  sessionId: Joi.string()
    .alphanum()
    .min(5)
    .max(50)
    .required()
});

// Middleware for chat API validation + sanitization
function validateChatRequest(req, res, next) {
  const { error, value } = chatSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  // Sanitize inputs (clean XSS)
  req.body.message = xss(value.message);
  req.body.domain = xss(value.domain);
  req.body.sessionId = xss(value.sessionId);

  next();
}

module.exports = { validateChatRequest };
