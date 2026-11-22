// Test harness only. Never deploy: authentication and image decoding are tested elsewhere.
import {createSigningRequest,SigningError} from '../../cloud-sync/src/signing-store.js';
import {readSigningJson,validateSigningCreate} from '../../cloud-sync/src/signing-validation.js';
import {submitSigningRequest,loadSignedPdfForGuest} from '../../cloud-sync/src/signing-submit.js';
import {previewSigningSubmission} from '../../cloud-sync/src/signing-preview.js';

export default {async fetch(request,env) {
  const url=new URL(request.url),token=(request.headers.get('authorization')||'').replace(/^Quote /,'');
  try {
    if(url.pathname==='/create') {
      const {snapshot,lifetimeDays}=validateSigningCreate(await readSigningJson(request));
      return Response.json(await createSigningRequest(env.DB,env.STAMP_BUCKET,'test-runtime-owner',snapshot,lifetimeDays));
    }
    if(url.pathname==='/submit'||url.pathname==='/preview') {
      const services={
        async allowRender(){return true;},async validateImage(){},
        async renderPdf(){if(url.searchParams.has('simulate-failure'))throw new Error('simulated renderer failure');return new TextEncoder().encode('%PDF-1.7\nTEST-BYTES-NOT-A-REAL-DOCUMENT\n%%EOF');}
      };
      if(url.pathname==='/preview') {
        const file=await previewSigningSubmission(env.DB,env.STAMP_BUCKET,token,await readSigningJson(request),services);
        return new Response(file.bytes,{headers:{'x-test-sha256':file.sha256}});
      }
      const receipt=await submitSigningRequest(env.DB,env.STAMP_BUCKET,token,await readSigningJson(request),services);
      return Response.json(receipt,{status:receipt.status==='signed'?200:202});
    }
    if(url.pathname==='/pdf') {
      const file=await loadSignedPdfForGuest(env.DB,env.STAMP_BUCKET,token);
      return new Response(file.bytes,{headers:{'x-test-sha256':file.sha256}});
    }
    return new Response(null,{status:404});
  } catch(error) {return Response.json({error:error instanceof SigningError?error.message:'TEST_ERROR'},{status:error instanceof SigningError?error.status:500});}
}};
