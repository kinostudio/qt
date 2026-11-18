(() => {
    'use strict';
    const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
    const stampKeys='enabled assetId assetVersionId assetName sourceDataUrl mimeType originalWidthPx originalHeightPx widthMm heightMm xMm yMm rotationDeg opacity layer allowOverflow lockAspectRatio cropEnabled crop blendMode anchor schemaVersion'.split(' ');
    async function pinImage(source) {
        if(!source) return '';
        const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.src=new URL(source,document.baseURI).href;await image.decode();
        if(!image.naturalWidth || !image.naturalHeight || image.naturalWidth>4096 || image.naturalHeight>4096 || image.naturalWidth*image.naturalHeight>4000000) throw new Error('圖片尺寸超過簽署上限。');
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
        return canvas.toDataURL('image/png');
    }
    window.KinoSigningExport={async capture(data,assets,root,printScale) {
        if(!root || !window.KinoPdfExport) throw new Error('列印版型尚未就緒。');
        const q=pick(data,['schemaVersion','quotationType','header','project','categories','items','notes','payment','bank','signature','logo','taxMode','printSettings']);
        q.header=pick(data.header,['title','quotationId','quotationDate','validityLabel','validity']);
        q.project=data.project.map(row=>pick(row,['label','value']));
        q.categories=data.categories.map(row=>pick(row,['id','name','summaryQty','summaryUnit']));
        q.items=Object.fromEntries(q.categories.map(category=>[category.id,(data.items[category.id]||[]).map(row=>({...pick(row,['desc','qty','unit','price']),qty:row.qty===''?0:row.qty,price:row.price===''?0:row.price}))]));
        q.notes=data.notes.map(row=>pick(row,['id','text']));q.payment={terms:data.payment.terms.map(row=>pick(row,['phase','percent','condition','notes']))};
        q.bank=pick(data.bank,['accountName','bankName','accountNumber']);q.printSettings=pick(data.printSettings,['scaledMode','showDetails','showSigDate']);
        q.signature=pick(data.signature,['clientCompany','clientContact','clientTaxId','clientPhone','vendorCompany','vendorContact','vendorTaxId','vendorPhone','signatureDate','clientSigImg','vendorSigImg','clientStamp','vendorStamp']);
        q.logo=await pinImage(q.logo);
        for(const key of ['clientSigImg','vendorSigImg']) q.signature[key]=await pinImage(q.signature[key]);
        for(const key of ['clientStamp','vendorStamp']) {
            const stamp=pick(data.signature[key],stampKeys),asset=assets.find(asset=>asset.id===stamp.assetId);
            const source=stamp.sourceDataUrl||asset?.dataUrl||'';
            if(stamp.enabled && (stamp.assetId||stamp.assetVersionId) && !source) throw new Error('印章圖片尚未載入，無法建立固定版本。');
            stamp.sourceDataUrl=await pinImage(source);if(stamp.sourceDataUrl) stamp.mimeType='image/png';q.signature[key]=stamp;
        }
        const prepared=await window.KinoPdfExport.serialize(root,data.header.quotationId,{rasterizeImages:true});
        return {rendererVersion:1,printScale:Number(printScale),quotation:q,printDocument:pick(prepared,['html','css','viewportWidth'])};
    }};
})();
