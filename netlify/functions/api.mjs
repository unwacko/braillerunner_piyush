// Netlify Function serving the same /api/* routes as server.js. Set SARVAM_API_KEY in Netlify's environment variables.
import { routes } from '../../lib/api.js'

export default async (req) => {
  const route = routes[new URL(req.url).pathname]
  if (req.method !== 'POST' || !route) return Response.json({ error: 'not found' }, { status: 404 })
  try {
    return Response.json(await route(await req.json()))
  } catch (e) {
    console.error(e)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export const config = { path: '/api/*' }
