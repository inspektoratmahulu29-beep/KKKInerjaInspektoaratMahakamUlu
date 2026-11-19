export async function onRequestGet({env}) {
  return Response.json({ok:true,service:'kertas-kerja-backend',authConfigured:Boolean(env.ADMIN_USERNAME&&env.ADMIN_PASSWORD&&env.SESSION_SECRET),googleSheetsConfigured:Boolean(env.GOOGLE_SHEETS_SPREADSHEET_ID&&env.GOOGLE_SERVICE_ACCOUNT_JSON),d1Configured:Boolean(env.DB),time:new Date().toISOString()},{headers:{'cache-control':'no-store'}});
}
