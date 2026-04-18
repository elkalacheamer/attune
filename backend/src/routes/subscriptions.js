export async function subscriptionRoutes(app) {
  app.get('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    return { subscription: null, plan: 'free' }
  })

  app.post('/checkout', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' })
  })
}
