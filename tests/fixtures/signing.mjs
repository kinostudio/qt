export function signingBody() {
  const stamp=()=>({enabled:true,assetId:'',assetVersionId:'',assetName:'',sourceDataUrl:'',mimeType:'',originalWidthPx:0,originalHeightPx:0,widthMm:18,heightMm:18,xMm:0,yMm:0,rotationDeg:0,opacity:96,layer:'top',allowOverflow:false,lockAspectRatio:true,cropEnabled:false,crop:null,blendMode:'normal',anchor:'signature-cell-center',schemaVersion:1});
  return {confirmed:true,lifetimeDays:14,snapshot:{rendererVersion:1,printScale:95,printDocument:{html:'<div class="print-pagination-root"><div class="print-page"><table><tbody><tr><td data-pdf-client-field="clientCompany"></td></tr><tr><td data-pdf-client-field="clientContact"></td></tr><tr><td data-pdf-client-field="clientTaxId"></td></tr><tr><td data-pdf-client-field="clientPhone"></td></tr><tr><td><div data-signing-client-signature="true"></div></td></tr></tbody></table></div></div>',css:'.print-page{width:194mm;min-height:281mm}',viewportWidth:1200},quotation:{
    schemaVersion:4,quotationType:'quick',taxMode:'included',
    header:{title:'測試報價單',quotationId:'TEST-ONLY-001',quotationDate:'2026-11-17',validityLabel:'有效期限：',validity:'測試期限'},
    project:[{label:'專案名稱',value:'完全模擬專案'}],
    categories:[{id:'crew',name:'拍攝',summaryQty:'1',summaryUnit:'天'}],
    items:{crew:[{desc:'測試攝影',qty:1,unit:'天',price:1000}]},
    notes:[{id:'note-test',text:'此為測試資料，不是正式契約'}],
    payment:{terms:[{phase:'定金',percent:'100%',condition:'測試',notes:''}]},
    bank:{accountName:'測試戶名',bankName:'測試銀行',accountNumber:'TEST-NOT-A-BANK-ACCOUNT'},
    printSettings:{scaledMode:true,showDetails:false,showSigDate:false},logo:'',
    signature:{clientCompany:'',clientContact:'',clientTaxId:'',clientPhone:'',vendorCompany:'測試公司',vendorContact:'測試窗口',vendorTaxId:'',vendorPhone:'',signatureDate:'',clientSigImg:'',vendorSigImg:'',clientStamp:stamp(),vendorStamp:stamp()}
  }}};
}
