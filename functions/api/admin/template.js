import {getCookie,json,verifySession} from '../../lib/security.js';
import {SEED_WORKBOOK} from '../../lib/seed.js';
export async function onRequestGet({request,env}){if(!await verifySession(env,getCookie(request,'__Host-kk_session')))return json({ok:false,message:'Unauthorized'},401);return json({ok:true,payload:SEED_WORKBOOK});}
