export async function coupleRoutes(app) {
  app.get('/', { onRequest: [app.authenticate] }, async (request) => {
    return { couple: null }
  })

  app.post('/invite', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' })
  })

  app.post('/pair', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' })
  })
}
