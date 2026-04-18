export async function profileRoutes(app) {
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' })
  })

  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' })
  })
}
