export async function onRequestGet({ env }) {
  return Response.json({ ok: true, service: 'kertas-kerja-backend', sheetsConfigured: Boolean(env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON), time: new Date().toISOString() });
}
