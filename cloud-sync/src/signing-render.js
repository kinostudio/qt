import {preparePrintPage,renderPrintPdf,PRINT_FONT_URL} from './pdf-render.js';

async function fillClientFields(page,submission) {
  await page.evaluate(async submission=>{
    const names=['clientCompany','clientContact','clientTaxId','clientPhone'];
    const cells=[...document.querySelectorAll('[data-pdf-client-field]')];
    const signatures=[...document.querySelectorAll('[data-signing-client-signature]')];
    if(cells.length!==4 || signatures.length!==1 || names.some(name=>cells.filter(cell=>cell.dataset.pdfClientField===name).length!==1)
      || cells.some(cell=>cell.tagName!=='TD' || !cell.closest('.print-page')) || !signatures[0].closest('.print-page')) throw new Error('SIGNING_TEMPLATE_FIELDS');
    if(!submission) return;
    for(const cell of cells) {
      cell.textContent=submission[cell.dataset.pdfClientField]||'\u3000';
      cell.style.whiteSpace='nowrap';
      let size=parseFloat(getComputedStyle(cell).fontSize);
      while(cell.scrollWidth>cell.clientWidth+1 && size>8) {size-=.25;cell.style.fontSize=size+'px';}
      if(cell.scrollWidth>cell.clientWidth+1) throw new Error('SIGNING_CLIENT_TEXT_TOO_LONG');
    }
    const image=new Image();image.alt=submission.signatureKind==='stamp'?'甲方印章':'甲方簽名';image.src=submission.signatureImage;
    await image.decode();
    if(!image.naturalWidth || !image.naturalHeight || image.naturalWidth>4096 || image.naturalHeight>4096 || image.naturalWidth*image.naturalHeight>4000000) throw new Error('SIGNING_IMAGE_DIMENSIONS');
    image.style.cssText='max-width:95%;max-height:27mm;object-fit:contain;position:relative;z-index:4';
    signatures[0].replaceChildren(image);
  },submission||null);
}

export async function prepareSigningPage(page,snapshot,submission,fontSource=PRINT_FONT_URL) {
  if(!snapshot.printDocument) throw new Error('SIGNING_PRINT_DOCUMENT_MISSING');
  await preparePrintPage(page,{...snapshot.printDocument,editableClientFields:false},fontSource);
  await fillClientFields(page,submission);
}

export async function renderSigningPdf(page,snapshot,submission,fontSource=PRINT_FONT_URL) {
  if(!snapshot.printDocument) throw new Error('SIGNING_PRINT_DOCUMENT_MISSING');
  return (await renderPrintPdf(page,{...snapshot.printDocument,editableClientFields:false},fontSource,page=>fillClientFields(page,submission))).bytes;
}
