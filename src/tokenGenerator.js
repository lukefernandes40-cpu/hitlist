const { customAlphabet } = require('nanoid');

// Alphanumeric, no ambiguous chars (0, O, I, l)
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generate = customAlphabet(alphabet, 6);

/**
 * Generates a unique short token, checking against existing tokens in DB
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<string>}
 */
async function generateUniqueToken(prisma) {
  let token;
  let exists = true;

  while (exists) {
    token = generate();
    const existing = await prisma.trackingLink.findUnique({ where: { token } });
    exists = !!existing;
  }

  return token;
}

module.exports = { generateUniqueToken };
