export async function notificationRoutes(app) {
  app.post('/register-token', { onRequest: [app.authenticate] }, async (request, reply) => {
    return { success: true }
  })

  app.get('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    return { notifications: [] }
  })
}
